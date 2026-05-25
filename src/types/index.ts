export type UserRole = 'user' | 'admin';
export type OnboardingStep = 'awaiting_name' | 'done';
export type MemoryCategory = 'fact' | 'situation' | 'prayer' | 'topic' | 'person';
export type Sentiment = 'positive' | 'neutral' | 'negative';
export type MessageRole = 'user' | 'assistant';

export interface User {
  id: string;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  role: UserRole;
  is_active: boolean;
  daily_message_count: number;
  daily_reset_at: string;
  weekly_summary_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  user_id: string;
  name: string | null;
  onboarding_step: OnboardingStep;
  spiritual_topics: string[];
  prayer_topics: string[];
  life_context: Record<string, unknown>;
  follow_up_needed: boolean;
  follow_up_at: string | null;
  follow_up_topic: string | null;
  last_follow_up_sent_at: string | null;
  last_interaction_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserMemory {
  id: string;
  user_id: string;
  category: MemoryCategory;
  key: string;
  value: string;
  confidence: number;
  mentioned_count: number;
  last_mentioned_at: string;
  created_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  started_at: string;
  last_message_at: string;
  is_active: boolean;
}

export interface Message {
  id: string;
  user_id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  sentiment: Sentiment | null;
  sentiment_confidence: number | null;
  topics: string[];
  bible_references: string[];
  created_at: string;
}

export interface Reminder {
  id: string;
  user_id: string;
  text: string;
  remind_at: string;
  is_sent: boolean;
  is_cancelled: boolean;
  sent_at: string | null;
  created_at: string;
}

export interface BibleVerse {
  id: string;
  book: string;
  chapter: number;
  verse: number;
  text: string;
  translation: string;
  similarity?: number;
}

export interface SermonChunk {
  id: string;
  sermon_title: string;
  church_name: string | null;
  content: string;
  similarity?: number;
}

export interface CrisisLog {
  id: string;
  user_id: string;
  message_content: string;
  trigger_keywords: string[];
  bot_response: string;
  reviewed_by_admin: boolean;
  reviewed_at: string | null;
  created_at: string;
}

export interface UserContext {
  user: User;
  profile: UserProfile;
  memory: UserMemory[];
  recentMessages: Message[];
}

export interface SentimentResult {
  sentiment: Sentiment;
  confidence: number;
}

export interface MemoryFact {
  category: MemoryCategory;
  key: string;
  value: string;
}

export interface ReminderParseResult {
  reminder_text: string;
  remind_at_iso: string;
  parsed_successfully: boolean;
}
