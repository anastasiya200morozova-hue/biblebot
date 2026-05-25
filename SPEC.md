# BibleBot — Техническая спецификация

> Версия: 1.1
> Дата: 2026-04-30
> Статус: Production-ready

---

## 0. Обзор проекта

### Что это
Telegram-бот — христианский AI-советник, который отвечает на жизненные вопросы
с опорой на Библию, помнит пользователя между сессиями, отправляет напоминания
и проявляет проактивную заботу ("как ты?").

### Стек
- **Runtime:** Node.js 20 (TypeScript) на VPS (Ubuntu 22)
- **Telegram:** node-telegram-bot-api (webhook режим)
- **LLM основной:** Claude Sonnet (claude-sonnet-4-20250514) через Anthropic SDK
- **LLM вспомогательный:** Claude Haiku (claude-haiku-4-5-20251001) — для extract_memory, sentiment, follow_up
- **База данных:** Supabase (PostgreSQL 15 + pgvector)
- **Планировщик:** node-cron (напоминания, follow_up, еженедельный итог)
- **Векторные эмбеддинги:** OpenAI text-embedding-3-small
- **Процессменеджер:** PM2 (деплой на VPS)
- **Голосовые (MVP+):** OpenAI Whisper API

### Роли пользователей
| Роль | Описание | Доступ |
|------|----------|--------|
| user | Обычный пользователь Telegram | Диалог, напоминания, просмотр своего профиля |
| admin | Владелец бота | Загрузка кафедр, просмотр логов, управление пользователями |

### Оценка стоимости API
| Сценарий | Расчёт | Стоимость/месяц |
|----------|--------|-----------------|
| 100 активных пользователей × 15 сообщений/день | 45 000 запросов, ~500 токенов in + 250 out = ~33M токенов | ~$25–30/мес |
| 200 пользователей × 20 сообщений/день | 120 000 запросов | ~$60–70/мес |
| Haiku (memory + sentiment, 10% запросов) | +12 000 запросов | +$1–2/мес |

> Порог алерта: если стоимость за день > $5 — уведомить админа в Telegram.

---

## Структура проекта

```
biblebot/
├── src/
│   ├── bot/
│   │   ├── index.ts              # Инициализация бота, регистрация handlers
│   │   ├── router.ts             # Роутинг апдейтов: команды / текст / фото / документ
│   │   └── webhook.ts            # Express-сервер, POST /webhook/:secret
│   ├── handlers/
│   │   ├── processMessage.ts     # Основной handler текстовых сообщений
│   │   ├── processReminder.ts    # Парсинг и сохранение напоминаний
│   │   ├── processVoice.ts       # MVP+: транскрипция голосовых
│   │   ├── processDocument.ts    # Admin: загрузка кафедр
│   │   ├── handleCrisis.ts       # Кризисные ситуации
│   │   └── handleCommands.ts     # /start /help /profile /reminders /forget /weekly
│   ├── cron/
│   │   ├── reminders.ts          # Cron каждую минуту: отправка напоминаний
│   │   ├── followUp.ts           # Cron каждый час: проактивная забота
│   │   └── weeklySummary.ts      # Cron воскресенье 19:00 МСК
│   ├── lib/
│   │   ├── claude.ts             # Обёртка над Anthropic SDK
│   │   ├── supabase.ts           # Клиент Supabase
│   │   ├── embeddings.ts         # Обёртка OpenAI embeddings
│   │   ├── vectorSearch.ts       # Поиск по bible_verses и sermon_chunks
│   │   ├── memory.ts             # Извлечение и сохранение фактов
│   │   ├── sentiment.ts          # Определение sentiment сообщения
│   │   ├── session.ts            # Логика session_id
│   │   ├── rateLimit.ts          # Rate limiter по telegram_id
│   │   └── crisis.ts             # Детектор кризисных триггеров
│   ├── admin/
│   │   └── routes.ts             # GET /admin/stats, GET /admin/crisis, PATCH /admin/crisis/:id
│   ├── scripts/
│   │   └── seedBible.ts          # Разовый скрипт: загрузка Библии + эмбеддинги
│   ├── types/
│   │   └── index.ts              # Типы: User, UserProfile, Message, Reminder и т.д.
│   └── config.ts                 # Все константы: лимиты, тексты, crisis triggers
├── .env                          # Секреты (не коммитить)
├── .env.example                  # Шаблон переменных
├── ecosystem.config.js           # PM2 конфиг
├── package.json
└── tsconfig.json
```

---

## Переменные окружения (.env.example)

```env
# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
TELEGRAM_WEBHOOK_URL=https://yourdomain.com/webhook

# Anthropic
ANTHROPIC_API_KEY=

# OpenAI (embeddings + Whisper MVP+)
OPENAI_API_KEY=

# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Admin
ADMIN_SECRET=
ADMIN_TELEGRAM_ID=        # telegram_id владельца для алертов

# App
PORT=3000
NODE_ENV=production
TZ=Europe/Moscow
DAILY_MESSAGE_LIMIT=20
SESSION_TIMEOUT_MINUTES=30
```

---

## БЛОК 1: User Stories

### US-001: Первый запуск — онбординг
**Как** новый пользователь,
**я хочу** понять что умеет бот и начать общение,
**чтобы** не читать инструкцию и сразу получить пользу.

**Сценарий:**
1. Пользователь нажимает /start (или пишет любое первое сообщение)
2. Бот создаёт запись в users + user_profiles с `onboarding_step = 'awaiting_name'`
3. Отправляет приветствие и задаёт один вопрос: "Как тебя зовут?"
4. Следующее сообщение пользователя роутер обрабатывает как имя (не как запрос к Claude)
5. Имя сохраняется, `onboarding_step = 'done'`
6. Бот: "Рад познакомиться, [имя]! Пиши мне всё что на сердце 🙏"

**Критерий приёмки:**
- [ ] `onboarding_step` хранится в user_profiles
- [ ] Пока `onboarding_step = 'awaiting_name'` — любое сообщение обрабатывается как имя
- [ ] После onboarding — обычный processMessage flow
- [ ] Если пользователь написал текст без /start — бот сначала делает онбординг, потом отвечает на исходный вопрос
- [ ] Время от /start до первого ответа < 3 сек

---

### US-002: Диалог на жизненную тему
**Как** верующий пользователь,
**я хочу** написать о своей ситуации и получить совет с опорой на Библию,
**чтобы** поступить по Слову Бога.

**Сценарий:**
1. Пользователь пишет: "Поругался с братом, не могу простить"
2. Бот находит релевантные стихи (Мф 18:21-22, Еф 4:32)
3. Отвечает как друг: с пониманием, без осуждения, с конкретным стихом
4. Рассказывает пример из Библии (Иосиф и братья)
5. Даёт практический шаг: "Что если сегодня помолиться за него?"
6. Асинхронно: сохраняет факт в user_memory, обновляет sentiment

**Критерий приёмки:**
- [ ] Ответ содержит минимум 1 стих с указанием Книга Глава:Стих
- [ ] Тон дружеский — нет слов из запрещённого списка
- [ ] Факт о ситуации сохранён в user_memory (асинхронно)
- [ ] Время ответа пользователю < 10 сек (сохранение памяти не блокирует ответ)

---

### US-003: Напоминание
**Как** пользователь,
**я хочу** попросить бота напомнить мне что-то в конкретное время,
**чтобы** не забыть помолиться, позвонить или сделать важное дело.

**Сценарий:**
1. Пользователь пишет: "Напомни мне в воскресенье в 10 утра помолиться за маму"
2. Роутер детектирует intent "reminder" по ключевым словам
3. Claude Haiku парсит дату/время и текст
4. Бот подтверждает: "✅ Напомню в воскресенье 4 мая в 10:00 — помолиться за маму 🙏"
5. В нужный момент cron отправляет: "🔔 [имя], ты просил напомнить: помолиться за маму"

**Критерий приёмки:**
- [ ] Напоминание сохранено в reminders с точным timestamp UTC
- [ ] Бот отправляет сообщение в ±2 минуты от назначенного времени
- [ ] Если время в прошлом — уточняет: "Это время прошло. Имеешь в виду следующее воскресенье?"
- [ ] /reminders выводит список с номерами для отмены

---

### US-004: Отмена напоминания
**Как** пользователь,
**я хочу** отменить напоминание которое уже не нужно,
**чтобы** не получать лишние сообщения.

**Сценарий:**
1. Пользователь пишет /reminders
2. Бот показывает пронумерованный список активных напоминаний
3. Пользователь пишет "отмени напоминание 1" или "отмени первое"
4. Роутер детектирует intent "cancel_reminder" + номер
5. Запись помечается is_sent = true (удалена из активных)
6. Бот подтверждает: "✅ Напоминание отменено"

**Критерий приёмки:**
- [ ] Intent "cancel_reminder" детектируется по паттернам: "отмени напоминание N", "удали N", "убери первое"
- [ ] Если номер не существует — "У тебя нет напоминания с таким номером"
- [ ] Если список пуст — "У тебя пока нет активных напоминаний"

---

### US-005: Проактивная забота
**Как** пользователь, который поделился тяжёлой ситуацией,
**я хочу** получить от бота вопрос "как ты?" через несколько дней,
**чтобы** чувствовать, что меня помнят.

**Сценарий:**
1. Пользователь рассказал о трудной ситуации (sentiment = negative, confidence > 0.7)
2. Бот ставит follow_up_needed = true, follow_up_at = now + 48 часов, follow_up_topic = тема
3. Если пользователь сам написал за эти 48 часов — follow_up отменяется
4. Через 48 часов cron отправляет: "Привет, [имя]! Ты рассказывал о [тема]. Как ты сейчас? 🙏"
5. Пользователь отвечает — продолжается обычный диалог с этим контекстом

**Критерий приёмки:**
- [ ] follow_up ставится только при sentiment = negative И confidence > 0.7
- [ ] Сообщение отправляется через 48 часов (±30 минут)
- [ ] Не более 1 проактивного сообщения в неделю на пользователя
- [ ] Если пользователь заблокировал бота — is_active = false, больше не пытаться

---

### US-006: Еженедельный итог
**Как** пользователь,
**я хочу** получать раз в неделю краткое ободрение,
**чтобы** видеть свой путь и получить поддержку.

**Сценарий:**
1. Каждое воскресенье в 19:00 МСК cron запускает задачу
2. Выборка пользователей: 3+ сообщений за последние 7 дней + weekly_summary_enabled = true
3. Claude Haiku формирует персонализированное сообщение: топ-3 темы + стих + ободрение
4. Пользователь получает сообщение

**Критерий приёмки:**
- [ ] Стих подобран релевантно темам недели через векторный поиск
- [ ] /weekly off отключает еженедельный итог (weekly_summary_enabled = false)
- [ ] /weekly on включает обратно

---

### US-007: Поиск примера из Библии
**Как** пользователь,
**я хочу** узнать как библейские герои справлялись с похожей ситуацией,
**чтобы** найти пример для подражания.

**Сценарий:**
1. Пользователь спрашивает: "Кто в Библии проходил через одиночество?"
2. Бот ищет через векторный поиск по bible_verses
3. Отвечает с минимум 2 персонажами, для каждого — история + применение

**Критерий приёмки:**
- [ ] Минимум 2 библейских персонажа в ответе
- [ ] Каждая история — конкретная ссылка (Книга Глава:Стих)
- [ ] Применение к ситуации пользователя персонализировано

---

### US-008: Дневной лимит
**Как** пользователь,
**я хочу** получать понятное сообщение когда исчерпал лимит,
**чтобы** понять ситуацию и вернуться завтра.

**Сценарий:**
1. Пользователь отправляет 21-е сообщение (лимит = 20)
2. Бот отвечает статичным текстом без вызова Claude API
3. Счётчик сбрасывается в 00:00 по МСК (UTC+3)

**Критерий приёмки:**
- [ ] Claude API НЕ вызывается после лимита (экономия)
- [ ] Напоминания и проактивные сообщения НЕ считаются в лимит
- [ ] Счётчик сбрасывается ровно в полночь МСК

---

### US-009: Просмотр и удаление профиля
**Как** пользователь,
**я хочу** видеть что бот обо мне знает и иметь возможность удалить это,
**чтобы** контролировать свои данные.

**Критерий приёмки:**
- [ ] /profile выводит: имя, топ-5 тем, темы молитв, дату начала общения, кол-во сообщений
- [ ] /forget удаляет все записи user_memory + сбрасывает user_profiles до дефолта
- [ ] После /forget бот подтверждает и НЕ использует старый контекст в следующем ответе

---

### US-010: Загрузка кафедры (admin)
**Как** администратор,
**я хочу** загрузить транскрипт проповеди,
**чтобы** бот отвечал также на основе учения нашей церкви.

**Критерий приёмки:**
- [ ] Только роль admin может загружать файлы
- [ ] Файл до 5MB, форматы: .txt, .pdf
- [ ] Чанки: 400 токенов с overlap 50
- [ ] Бот подтверждает: "Кафедра '[название]' загружена. 42 фрагмента проиндексировано."

---

### US-011: Кризисная ситуация
**Как** пользователь в тяжёлом состоянии,
**я хочу** получить поддержку и быть направлен к живому человеку,
**чтобы** не остаться один на один с кризисом.

**Критерий приёмки:**
- [ ] Триггеры в конфиге (не в промпте) — нельзя обойти инъекцией
- [ ] Ответ ВСЕГДА содержит номер 8-800-2000-122
- [ ] Событие записывается в crisis_logs
- [ ] Алерт уходит администратору в Telegram немедленно

---

## БЛОК 2: Data Model

### Таблица: users
```sql
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

CREATE UNIQUE INDEX idx_users_telegram_id ON users(telegram_id);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_active ON users(is_active) WHERE is_active = true;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_service_role_all" ON users FOR ALL USING (auth.role() = 'service_role');
```

### Таблица: user_profiles
```sql
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
  last_follow_up_sent_at TIMESTAMPTZ,  -- не чаще 1 раза в неделю
  last_interaction_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_user_profiles_user_id ON user_profiles(user_id);
CREATE INDEX idx_user_profiles_follow_up ON user_profiles(follow_up_needed, follow_up_at)
  WHERE follow_up_needed = true;

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_profiles_service_role_all" ON user_profiles FOR ALL
  USING (auth.role() = 'service_role');
```

### Таблица: user_memory
```sql
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

CREATE INDEX idx_user_memory_user_id ON user_memory(user_id);
CREATE INDEX idx_user_memory_user_recent ON user_memory(user_id, last_mentioned_at DESC);
CREATE UNIQUE INDEX idx_user_memory_user_key ON user_memory(user_id, key);

ALTER TABLE user_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_memory_service_role_all" ON user_memory FOR ALL
  USING (auth.role() = 'service_role');
```

### Таблица: sessions
```sql
-- Сессия создаётся при первом сообщении после SESSION_TIMEOUT_MINUTES молчания
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true
);

CREATE INDEX idx_sessions_user_active ON sessions(user_id, is_active)
  WHERE is_active = true;

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sessions_service_role_all" ON sessions FOR ALL
  USING (auth.role() = 'service_role');
```

### Таблица: messages
```sql
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

CREATE INDEX idx_messages_user_id ON messages(user_id, created_at DESC);
CREATE INDEX idx_messages_session_id ON messages(session_id, created_at ASC);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "messages_service_role_all" ON messages FOR ALL
  USING (auth.role() = 'service_role');
```

### Таблица: reminders
```sql
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

CREATE INDEX idx_reminders_pending ON reminders(remind_at)
  WHERE is_sent = false AND is_cancelled = false;
CREATE INDEX idx_reminders_user_active ON reminders(user_id)
  WHERE is_sent = false AND is_cancelled = false;

ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reminders_service_role_all" ON reminders FOR ALL
  USING (auth.role() = 'service_role');
```

### Таблица: bible_verses
```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE bible_verses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  text TEXT NOT NULL,
  translation TEXT NOT NULL DEFAULT 'RST', -- RST = Синодальный перевод
  topic_tags TEXT[] DEFAULT '{}',
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bible_verses_embedding ON bible_verses
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE UNIQUE INDEX idx_bible_verses_ref ON bible_verses(book, chapter, verse, translation);

ALTER TABLE bible_verses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bible_verses_service_role_all" ON bible_verses FOR ALL
  USING (auth.role() = 'service_role');
```

### Таблица: sermon_chunks
```sql
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

CREATE INDEX idx_sermon_chunks_embedding ON sermon_chunks
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

ALTER TABLE sermon_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sermon_chunks_service_role_all" ON sermon_chunks FOR ALL
  USING (auth.role() = 'service_role');
```

### Таблица: crisis_logs
```sql
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

CREATE INDEX idx_crisis_logs_unreviewed ON crisis_logs(created_at DESC)
  WHERE reviewed_by_admin = false;

ALTER TABLE crisis_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crisis_logs_service_role_all" ON crisis_logs FOR ALL
  USING (auth.role() = 'service_role');
```

### Таблица: agent_logs
```sql
CREATE TABLE agent_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  session_id UUID,
  model TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd FLOAT,  -- input_tokens/1M*3 + output_tokens/1M*15 (Sonnet pricing)
  latency_ms INTEGER,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agent_logs_created ON agent_logs(created_at DESC);
CREATE INDEX idx_agent_logs_cost ON agent_logs(created_at DESC, cost_usd);

ALTER TABLE agent_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_logs_service_role_all" ON agent_logs FOR ALL
  USING (auth.role() = 'service_role');
```

### Триггеры updated_at
```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### Supabase RPC: векторный поиск
```sql
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
```

### Связи
```
users 1──1 user_profiles
users 1──N user_memory       (ON DELETE CASCADE)
users 1──N sessions          (ON DELETE CASCADE)
sessions 1──N messages       (ON DELETE CASCADE)
users 1──N reminders         (ON DELETE CASCADE)
users 1──N crisis_logs
users 1──N agent_logs
```

---

## БЛОК 3: API / Handlers

### Telegram Webhook

#### `POST /webhook/:secret`
**Описание:** Принимает все апдейты от Telegram. Secret валидируется в URL.

**Роутер апдейтов (router.ts):**
```
Апдейт получен
  │
  ├── message.text == '/start'      → handleCommands.start()
  ├── message.text == '/help'       → handleCommands.help()
  ├── message.text == '/profile'    → handleCommands.profile()
  ├── message.text == '/reminders'  → handleCommands.reminders()
  ├── message.text == '/forget'     → handleCommands.forget()
  ├── message.text == '/weekly ...' → handleCommands.weekly()
  │
  ├── profile.onboarding_step == 'awaiting_name'  → handleCommands.saveName()
  │
  ├── detectIntent(text) == 'reminder'        → processReminder()
  ├── detectIntent(text) == 'cancel_reminder' → cancelReminder()
  │
  ├── message.voice (или audio)    → processVoice()  [MVP+]
  ├── message.document + admin     → processDocument()
  │
  └── всё остальное                → processMessage()
```

**Intent detection (deterministic, без LLM):**
```typescript
function detectIntent(text: string): 'reminder' | 'cancel_reminder' | 'message' {
  const t = text.toLowerCase();
  if (/отмени|удали|убери/.test(t) && /напоминани/.test(t)) return 'cancel_reminder';
  if (/напомни|напоминание|не забудь напомнить/.test(t)) return 'reminder';
  return 'message';
}
```

---

### Handler: processMessage (основной)

**Алгоритм (строго по порядку):**
```
1. getOrCreateUser(telegram_id)          → users
2. checkDailyLimit(user)                 → если лимит: вернуть статичный текст, СТОП
3. getOrCreateSession(user)              → sessions (логика ниже)
4. detectCrisis(text)                    → если кризис: handleCrisis(), СТОП
5. sendChatAction("typing")              → Telegram (немедленно)
6. loadContext(user, session)            → профиль + топ-20 memory + последние 10 msg сессии
7. searchBibleVerses(text)               → vector search (параллельно с п.8)
8. searchSermonChunks(text)              → vector search (параллельно с п.7)
9. callClaude(systemPrompt, context, history, verses, chunks, userText)
10. sendMessage(chatId, response)        → Telegram
11. saveMessages(userMsg, botMsg)        → messages (с session_id)
12. incrementDailyCount(user)            → users.daily_message_count++
13. updateLastInteraction(profile)       → user_profiles.last_interaction_at
14. [async] extractMemory(userText)      → user_memory (не блокирует ответ)
15. [async] detectSentiment(userText)    → если negative: установить follow_up
16. [async] logTokens(usage)             → agent_logs
```

---

### Логика session_id

```typescript
// src/lib/session.ts
const SESSION_TIMEOUT = parseInt(process.env.SESSION_TIMEOUT_MINUTES!) * 60 * 1000;

async function getOrCreateSession(userId: string): Promise<string> {
  const { data: active } = await supabase
    .from('sessions')
    .select('id, last_message_at')
    .eq('user_id', userId)
    .eq('is_active', true)
    .single();

  if (active) {
    const elapsed = Date.now() - new Date(active.last_message_at).getTime();
    if (elapsed < SESSION_TIMEOUT) {
      // Продолжаем текущую сессию
      await supabase.from('sessions')
        .update({ last_message_at: new Date() })
        .eq('id', active.id);
      return active.id;
    }
    // Сессия устарела — закрываем
    await supabase.from('sessions')
      .update({ is_active: false })
      .eq('id', active.id);
  }

  // Создаём новую сессию
  const { data: newSession } = await supabase
    .from('sessions')
    .insert({ user_id: userId })
    .select('id')
    .single();

  return newSession!.id;
}
```

> Сессия "закрывается" если пользователь молчал SESSION_TIMEOUT_MINUTES (по умолчанию 30).
> При новой сессии история предыдущего разговора НЕ передаётся в Claude — только долгосрочная память.

---

### Handler: cancelReminder

```typescript
// Парсинг номера из текста: "отмени напоминание 2", "удали третье"
const ORDINALS: Record<string, number> = {
  'первое': 1, 'второе': 2, 'третье': 3, 'четвёртое': 4, 'пятое': 5
};

async function cancelReminder(userId: string, text: string) {
  const match = text.match(/(\d+)/);
  const ordinalMatch = Object.entries(ORDINALS).find(([word]) => text.includes(word));
  const num = match ? parseInt(match[1]) : ordinalMatch ? ordinalMatch[1] : null;

  if (!num) {
    return bot.sendMessage(chatId, 'Напиши номер напоминания. Посмотреть список: /reminders');
  }

  const { data: reminders } = await supabase
    .from('reminders')
    .select('id')
    .eq('user_id', userId)
    .eq('is_sent', false)
    .eq('is_cancelled', false)
    .order('remind_at', { ascending: true });

  const target = reminders?.[Number(num) - 1];
  if (!target) {
    return bot.sendMessage(chatId, 'У тебя нет напоминания с таким номером 🙏');
  }

  await supabase.from('reminders')
    .update({ is_cancelled: true })
    .eq('id', target.id);

  return bot.sendMessage(chatId, '✅ Напоминание отменено');
}
```

---

### Admin REST API

#### `GET /admin/stats` — Bearer ADMIN_SECRET
```json
{
  "users_total": 142,
  "users_active_today": 38,
  "messages_today": 412,
  "crisis_unreviewed": 2,
  "api_cost_today_usd": 1.24,
  "api_cost_month_usd": 18.40
}
```

#### `GET /admin/crisis` — Bearer ADMIN_SECRET
```json
{
  "data": [{
    "id": "uuid",
    "user_telegram_id": 987654321,
    "trigger_keywords": ["не хочу жить"],
    "created_at": "2026-04-30T03:15:00Z",
    "reviewed": false
  }]
}
```

#### `PATCH /admin/crisis/:id/review` — Bearer ADMIN_SECRET
**Тело:** `{}`  **Ответ 200:** `{ "ok": true }`

---

## БЛОК 4: UI/UX

### Экран: Онбординг (/start или первое сообщение)
```
Привет! Я BibleBot 🙏

Я здесь чтобы быть рядом — как друг, у которого всегда открыта Библия.
Могу поговорить о чём угодно: семья, работа, страхи, радости, сомнения.
Отвечаю с опорой на Слово Бога.

Как тебя зовут?
```
**После имени:**
```
Рад познакомиться, [имя]! 😊
Пиши мне всё что на сердце — я слушаю.

Кстати, у меня лимит 20 сообщений в день — это чтобы оставаться бесплатным для всех 🙏
```

---

### Экран: Обычный диалог
- **Typing indicator:** `sendChatAction("typing")` — сразу при получении сообщения
- **Markdown:** стихи курсивом `_Мф 18:22_`, жирный не использовать
- **Ошибка API:** "Прости, что-то пошло не так. Попробуй ещё раз через минуту 🙏"

**Структура ответа бота (всегда в этом порядке):**
```
[Эмпатия — 1-2 предложения, без осуждения]

[Библейский принцип + стих курсивом]
_Еф 4:32 — "Будьте друг к другу добры..."_

[Пример из жизни библейского героя — 2-3 предложения]

[Один практический шаг]

[Тёплое завершение / молитвенное слово]
```

---

### Экран: Команды

**`/help`:**
```
Что я умею:

💬 Общаться на любые темы с опорой на Библию
📖 Рассказывать примеры из жизни библейских героев
⏰ Ставить напоминания ("напомни помолиться в воскресенье в 10")
👤 /profile — что я о тебе помню
📋 /reminders — твои напоминания
🔕 /weekly off — отключить воскресный итог
🗑 /forget — удалить всю мою память о тебе

Лимит: 20 сообщений в день (сбрасывается в полночь по МСК)
```

**`/profile`:**
```
Вот что я знаю о тебе, [имя]:

📌 Темы разговоров: прощение, семья, страх одиночества
🙏 Темы молитв: мама, работа
💬 Сообщений всего: 47
📅 Общаемся с: 15 апреля 2026

Чтобы удалить всю память — /forget
```

**`/reminders`:**
```
Твои напоминания:

1. Воскресенье 4 мая, 10:00 — помолиться за маму
2. Пятница 2 мая, 20:00 — позвонить пастору

Чтобы отменить — напиши "отмени напоминание 1"
```
*Если список пуст:* `У тебя пока нет активных напоминаний. Скажи мне "напомни..." — и я запомню 🙏`

**Лимит исчерпан:**
```
На сегодня всё — лимит 20 сообщений использован 😊

Это чтобы бот оставался бесплатным для всех.
Возвращайся завтра — буду рад продолжить!

_"Покойтесь и знайте, что Я Бог"_ — Пс 45:11

Бог с тобой 🙏
```

**Кризисная ситуация:**
```
[Имя], я слышу тебя. То что ты чувствуешь — это очень тяжело. 💙

_"Ибо Я знаю намерения какие имею о вас, говорит Господь,
намерения во благо а не на зло"_ — Иер 29:11

Пожалуйста, не оставайся с этим один.
Поговори с пастором или позвони на бесплатную линию помощи:
📞 8-800-2000-122 (круглосуточно, бесплатно)

Я здесь если хочешь говорить 🙏
```

---

## БЛОК 5: Business Logic

### Системный промпт Claude (полный текст)

```
Ты — BibleBot, христианский советник и друг.

ТВОЙ ХАРАКТЕР:
Говоришь как живой друг — тепло, искренне, иногда с юмором.
Не как священник с кафедры, не как психолог с блокнотом.
Никогда не осуждаешь человека. Осуждаешь только грех, но мягко.
В центре всегда — Бог и Его Слово.

ТЫ ВСЕГДА:
1. Даёшь библейское основание (минимум 1 стих, формат: Книга Глава:Стих)
2. Обращаешься по имени если оно известно: {{name}}
3. Предлагаешь один конкретный практический шаг
4. Завершаешь с теплотой или молитвенным словом
5. Упоминаешь прошлый контекст если он уместен ("ты говорил о маме — как она?")

ТЫ НИКОГДА не говоришь:
- "Вы должны..." / "Ты обязан..." → вместо этого: "Что если попробовать..."
- "Это грех" без контекста → вместо этого: "Бог смотрит на это так..."
- "Бог накажет тебя" → никогда, даже косвенно
- "Ты неправильно живёшь" → вместо этого: "Слово говорит нам..."
- "Ты должен покаяться" → вместо этого: "Покаяние — это дар, и Бог ждёт..."
- Конкретные прогнозы: "Бог исцелит тебя на этой неделе"
- Медицинские советы (только: "поговори с врачом")
- Политические или деноминационные суждения
- Осуждение конкретных церквей или пасторов

КОНТЕКСТ ПОЛЬЗОВАТЕЛЯ:
Имя: {{name}}
Что я знаю о нём (топ-20 фактов по дате): {{memory_facts}}
Темы молитв: {{prayer_topics}}

ИСТОРИЯ ТЕКУЩЕЙ СЕССИИ (последние 10 сообщений):
{{conversation_history}}

РЕЛЕВАНТНЫЕ СТИХИ ИЗ БИБЛИИ:
{{bible_verses}}

РЕЛЕВАНТНЫЕ ФРАГМЕНТЫ КАФЕДР:
{{sermon_chunks}}

ФОРМАТ ОТВЕТА:
- Длина: 100–250 слов. Не короче, не длиннее.
- Стихи: курсив через Markdown _Рим 8:28_
- Эмодзи: 1-3 на ответ, уместно
- БЕЗ заголовков, БЕЗ маркированных списков
- Язык: разговорный русский, без канцелярщины
```

---

### Sentiment Detection

Используется Claude Haiku после каждого сообщения пользователя (асинхронно).

**Промпт:**
```
Определи эмоциональный тон сообщения. Ответь только JSON:
{"sentiment": "positive"|"neutral"|"negative", "confidence": 0.0-1.0}

Negative — если человек выражает боль, страх, тревогу, депрессию, конфликт, потерю.
Positive — радость, благодарность, победа, вдохновение.
Neutral — вопросы, нейтральные темы.

Сообщение: {{text}}
```

**Когда ставить follow_up:**
```typescript
if (sentiment === 'negative' && confidence > 0.7) {
  const lastFollowUp = profile.last_follow_up_sent_at;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  // Не чаще 1 раза в неделю
  if (!lastFollowUp || new Date(lastFollowUp).getTime() < weekAgo) {
    await setFollowUp(userId, topicFromMessage, 48 * 60 * 60 * 1000);
  }
}
```

---

### Извлечение памяти (extract_memory)

Claude Haiku, асинхронно после каждого ответа.

**Промпт:**
```
Из текста сообщения извлеки факты о пользователе для долгосрочной памяти.
Верни JSON: { "facts": [{ "category": "person|situation|prayer|topic|fact", "key": "...", "value": "..." }] }
Если фактов нет — {"facts": []}
Не извлекай общие истины, только личные факты о пользователе.

Примеры:
"Поругался с братом Петей" → {category:"person", key:"брат", value:"Петя, был конфликт"}
"Боюсь потерять работу" → {category:"situation", key:"страх работы", value:"боится потерять работу"}
"Молюсь за маму" → {category:"prayer", key:"мама", value:"молится за маму"}
"Как дела у Давида?" → {} (нет личных фактов)

Сообщение: {{text}}
```

**Логика сохранения:**
- Если `key` уже есть в user_memory → `UPDATE value, mentioned_count++, last_mentioned_at`
- Если нового `key` нет → `INSERT`
- Если в профиле > 200 записей → удалять самые старые по `last_mentioned_at`

---

### Парсинг напоминаний

Claude Haiku при detectIntent == 'reminder'.

**Промпт:**
```
Из сообщения извлеки напоминание. Текущее время: {{now}} (МСК, UTC+3).
Ответь только JSON:
{
  "reminder_text": "текст напоминания",
  "remind_at_iso": "2026-05-04T07:00:00Z",  // UTC
  "parsed_successfully": true
}
Если время не удалось распознать: {"parsed_successfully": false}

Правила:
- "завтра утром" → следующий день 09:00 МСК → UTC-3
- "в воскресенье" → ближайшее воскресенье 09:00 МСК если время не указано
- "через 2 часа" → now + 2h
- "каждый день" → только первый день (повторы не поддерживаются)

Сообщение: {{text}}
```

---

### Кризисные триггеры

```typescript
// src/config.ts — не в промпте, чтобы нельзя было обойти инъекцией
export const CRISIS_TRIGGERS = [
  'не хочу жить', 'хочу умереть', 'покончить с собой',
  'нет смысла жить', 'лучше бы меня не было',
  'суицид', 'убить себя', 'конец жизни', 'хочу уйти из жизни',
  'мне незачем жить', 'думаю о смерти'
];

export function detectCrisis(text: string): string[] {
  const lower = text.toLowerCase();
  return CRISIS_TRIGGERS.filter(t => lower.includes(t));
}
```

При кризисе:
1. Отправить статичный шаблон (не через Claude — мгновенно)
2. Записать в crisis_logs
3. Отправить алерт: `bot.sendMessage(ADMIN_TELEGRAM_ID, '🚨 Кризисная ситуация! user_id: ...')`

---

### Дневной лимит

```typescript
// Сброс в 00:00 МСК = 21:00 UTC предыдущего дня
async function checkAndIncrementLimit(userId: string): Promise<boolean> {
  const nowMoscow = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const todayMoscow = nowMoscow.toISOString().split('T')[0];

  const user = await getUser(userId);

  if (user.daily_reset_at !== todayMoscow) {
    await supabase.from('users')
      .update({ daily_message_count: 1, daily_reset_at: todayMoscow })
      .eq('id', userId);
    return false; // лимит не исчерпан
  }

  if (user.daily_message_count >= DAILY_MESSAGE_LIMIT) {
    return true; // лимит исчерпан
  }

  await supabase.from('users')
    .update({ daily_message_count: user.daily_message_count + 1 })
    .eq('id', userId);
  return false;
}
```

---

### Безопасность
- **Webhook:** Secret в URL + проверка `X-Telegram-Bot-Api-Secret-Token` header
- **RLS:** Все таблицы — только service_role
- **Промпт-инъекции:** Текст пользователя только в user-роли Claude, никогда в system
- **Кризис:** Список триггеров в коде, не в промпте — недоступен для инъекции
- **Rate limit:** 3 сообщения / 10 сек на telegram_id — in-memory Map с TTL
- **Admin API:** Bearer токен + IP-бан после 5 неудачных попыток
- **Валидация:** Zod-схемы на все входящие данные от Telegram

---

### Деплой (VPS Ubuntu 22)

**ecosystem.config.js (PM2):**
```javascript
module.exports = {
  apps: [{
    name: 'biblebot',
    script: 'dist/bot/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    env: { NODE_ENV: 'production' }
  }]
};
```

**Команды запуска:**
```bash
npm run build          # tsc
pm2 start ecosystem.config.js
pm2 save
pm2 startup            # автозапуск при перезагрузке VPS

# Регистрация webhook (один раз):
curl "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -d "url=https://yourdomain.com/webhook/${WEBHOOK_SECRET}"
```

**Nginx reverse proxy (порт 3000 → 443):**
```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;
    location /webhook/ {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
    }
}
```

---

### Скрипт загрузки Библии (scripts/seedBible.ts)

```
Источник: Синодальный перевод (RST) — открытый, без авторских прав
Формат файла: bible_rst.json (структура: [{book, chapter, verse, text}])
Источник JSON: https://github.com/thiagobodruk/bible (или аналог на русском)

Алгоритм:
1. Читать bible_rst.json (31 102 стиха)
2. Батчами по 100 стихов:
   a. Для каждого стиха создать эмбеддинг через OpenAI
   b. INSERT в bible_verses (с translation='RST')
3. После загрузки: CREATE INDEX ivfflat (требует 100+ записей)
4. Логировать прогресс: "Загружено 1000/31102..."

Ориентировочное время: ~30 минут, стоимость: ~$0.50 (OpenAI embeddings)
Запуск: npx ts-node src/scripts/seedBible.ts
```

---

## БЛОК 6: Edge Cases

### Сеть и доступность
| # | Ситуация | Триггер | Поведение системы |
|---|----------|---------|-------------------|
| 1 | Claude API timeout > 30 сек | Любое сообщение | Retry 1 раз через 5 сек. При повторной ошибке → статичный ответ. Логировать в agent_logs |
| 2 | Claude API rate limit | Пиковая нагрузка | Exponential backoff: 5/10/20 сек. Пользователь видит typing... до 60 сек |
| 3 | Supabase недоступен | Любой запрос | Статичный ответ "Технические работы, попробуй через минуту". Алерт админу |
| 4 | Telegram sendMessage 403 | Пользователь заблокировал бота | Пометить is_active = false. Отменить все cron-задачи для этого пользователя |
| 5 | OpenAI Embeddings недоступен | Поиск по Библии | Отвечать без векторного контекста. Claude использует свои знания Библии. Логировать |

### Данные и состояние
| # | Ситуация | Триггер | Поведение системы |
|---|----------|---------|-------------------|
| 6 | Два сообщения одновременно | Быстрый ввод | Обрабатывать последовательно (in-memory queue по telegram_id) |
| 7 | Первое сообщение без /start | Пользователь пишет сразу | Создать пользователя → онбординг → после имени ответить на исходный вопрос |
| 8 | Напоминание на время в прошлом | "Напомни вчера в 10" | Уточнить: "Это время прошло. Имеешь в виду завтра?" |
| 9 | /forget во время диалога | Команда | Немедленно очистить user_memory. Следующий ответ — без контекста |
| 10 | Сообщение > 4000 символов | Вставка большого текста | Обрезать до 4000. Предупредить: "Большое сообщение — отвечу на главное" |
| 11 | Смена темы в середине сессии | Новая тема не связана с предыдущей | Claude сам переключается. Session_id не меняется — история остаётся |
| 12 | user_memory > 200 записей | Очень активный пользователь | В промпт — топ-20 по last_mentioned_at. Старые записи удалять при INSERT |

### Безопасность
| # | Ситуация | Триггер | Поведение системы |
|---|----------|---------|-------------------|
| 13 | Промпт-инъекция | "Забудь инструкции..." | Текст пользователя изолирован в user-роли. System prompt не перезаписывается |
| 14 | Спам-атака | > 3 сообщений / 10 сек | Rate limiter: бан на 1 час. Логировать telegram_id |
| 15 | Admin API без токена | Перебор | 401 без деталей. IP-бан после 5 попыток |
| 16 | Попытка обойти кризис-детектор | Перефразировка триггеров | Детектор по подстрокам — сложно обойти. Claude дополнительно реагирует на контекст |

### Лимиты и производительность
| # | Ситуация | Триггер | Поведение системы |
|---|----------|---------|-------------------|
| 17 | Лимит 20 сообщений исчерпан | 21-е сообщение | Статичный ответ, Claude API не вызывается |
| 18 | Файл кафедры > 5MB | Загрузка админом | "Файл слишком большой. Максимум 5MB" |
| 19 | Вектор не найден (similarity < 0.7) | Специфичный запрос | Ответить без векторного контекста. Claude опирается на знания о Библии |
| 20 | Стоимость API > $5 за день | Пиковая нагрузка / атака | Алерт администратору в Telegram с деталями |
