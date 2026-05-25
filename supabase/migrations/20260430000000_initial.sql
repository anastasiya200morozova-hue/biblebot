-- BibleBot: начальная схема БД
-- Запускать в Supabase SQL Editor или через Supabase CLI

-- Расширение для векторного поиска
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── ТАБЛИЦЫ ─────────────────────────────────────────────────────────────────

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT NOT NULL UNIQUE,
  username TEXT,
  first_name TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  is_active BOOLEAN DEFAULT true,
  daily_message_count INTEGER DEFAULT 0,
  daily_reset_at DATE DEFAULT CURRENT_DATE,
  weekly_summary_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT,
  onboarding_step TEXT NOT NULL DEFAULT 'awaiting_name'
    CHECK (onboarding_step IN ('awaiting_name', 'done')),
  spiritual_topics TEXT[] DEFAULT '{}',
  prayer_topics TEXT[] DEFAULT '{}',
  life_context JSONB DEFAULT '{}',
  follow_up_needed BOOLEAN DEFAULT false,
  follow_up_at TIMESTAMPTZ,
  follow_up_topic TEXT,
  last_follow_up_sent_at TIMESTAMPTZ,
  last_interaction_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE user_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('fact', 'situation', 'prayer', 'topic', 'person')),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  confidence FLOAT DEFAULT 1.0,
  mentioned_count INTEGER DEFAULT 1,
  last_mentioned_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  sentiment TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative')),
  sentiment_confidence FLOAT,
  topics TEXT[] DEFAULT '{}',
  bible_references TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  remind_at TIMESTAMPTZ NOT NULL,
  is_sent BOOLEAN DEFAULT false,
  is_cancelled BOOLEAN DEFAULT false,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE bible_verses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  text TEXT NOT NULL,
  translation TEXT NOT NULL DEFAULT 'RST',
  topic_tags TEXT[] DEFAULT '{}',
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sermon_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sermon_title TEXT NOT NULL,
  church_name TEXT,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536),
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE crisis_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  message_content TEXT NOT NULL,
  trigger_keywords TEXT[] NOT NULL,
  bot_response TEXT NOT NULL,
  reviewed_by_admin BOOLEAN DEFAULT false,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE agent_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  session_id UUID,
  model TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd FLOAT,
  latency_ms INTEGER,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── ИНДЕКСЫ ──────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX idx_users_telegram_id ON users(telegram_id);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_active ON users(is_active) WHERE is_active = true;

CREATE UNIQUE INDEX idx_user_profiles_user_id ON user_profiles(user_id);
CREATE INDEX idx_user_profiles_follow_up ON user_profiles(follow_up_needed, follow_up_at)
  WHERE follow_up_needed = true;

CREATE INDEX idx_user_memory_user_id ON user_memory(user_id);
CREATE INDEX idx_user_memory_user_recent ON user_memory(user_id, last_mentioned_at DESC);
CREATE UNIQUE INDEX idx_user_memory_user_key ON user_memory(user_id, key);

CREATE INDEX idx_sessions_user_active ON sessions(user_id, is_active)
  WHERE is_active = true;

CREATE INDEX idx_messages_user_id ON messages(user_id, created_at DESC);
CREATE INDEX idx_messages_session_id ON messages(session_id, created_at ASC);

CREATE INDEX idx_reminders_pending ON reminders(remind_at)
  WHERE is_sent = false AND is_cancelled = false;
CREATE INDEX idx_reminders_user_active ON reminders(user_id)
  WHERE is_sent = false AND is_cancelled = false;

-- Уникальный индекс для bible_verses (защита от дублей при повторном seed)
CREATE UNIQUE INDEX idx_bible_verses_ref ON bible_verses(book, chapter, verse, translation);

-- ivfflat индексы для векторного поиска
-- ВАЖНО: создавать ПОСЛЕ загрузки данных (seedBible.ts) — требует 100+ записей
-- CREATE INDEX idx_bible_verses_embedding ON bible_verses
--   USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
-- CREATE INDEX idx_sermon_chunks_embedding ON sermon_chunks
--   USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

CREATE INDEX idx_crisis_logs_unreviewed ON crisis_logs(created_at DESC)
  WHERE reviewed_by_admin = false;

CREATE INDEX idx_agent_logs_created ON agent_logs(created_at DESC);
CREATE INDEX idx_agent_logs_cost ON agent_logs(created_at DESC, cost_usd);

-- ─── ТРИГГЕРЫ updated_at ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE bible_verses ENABLE ROW LEVEL SECURITY;
ALTER TABLE sermon_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE crisis_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_service_role_all" ON users FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "user_profiles_service_role_all" ON user_profiles FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "user_memory_service_role_all" ON user_memory FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "sessions_service_role_all" ON sessions FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "messages_service_role_all" ON messages FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "reminders_service_role_all" ON reminders FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "bible_verses_service_role_all" ON bible_verses FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "sermon_chunks_service_role_all" ON sermon_chunks FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "crisis_logs_service_role_all" ON crisis_logs FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "agent_logs_service_role_all" ON agent_logs FOR ALL USING (auth.role() = 'service_role');

-- ─── RPC: ВЕКТОРНЫЙ ПОИСК ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION search_bible_verses(
  query_embedding vector(1536),
  match_count int DEFAULT 5,
  similarity_threshold float DEFAULT 0.7
)
RETURNS TABLE (id uuid, book text, chapter int, verse int, text text, similarity float)
LANGUAGE sql STABLE AS $$
  SELECT id, book, chapter, verse, text,
    1 - (embedding <=> query_embedding) AS similarity
  FROM bible_verses
  WHERE 1 - (embedding <=> query_embedding) > similarity_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

CREATE OR REPLACE FUNCTION search_sermon_chunks(
  query_embedding vector(1536),
  match_count int DEFAULT 3,
  similarity_threshold float DEFAULT 0.7
)
RETURNS TABLE (id uuid, sermon_title text, church_name text, content text, similarity float)
LANGUAGE sql STABLE AS $$
  SELECT id, sermon_title, church_name, content,
    1 - (embedding <=> query_embedding) AS similarity
  FROM sermon_chunks
  WHERE 1 - (embedding <=> query_embedding) > similarity_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
