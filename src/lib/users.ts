import { supabase } from './supabase';
import { config } from '../config';
import type { User, UserProfile } from '../types';

export async function getOrCreateUser(
  telegramId: number,
  username: string | null,
  firstName: string | null
): Promise<{ user: User; profile: UserProfile; isNew: boolean }> {
  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', telegramId)
    .single();

  if (existing) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', existing.id)
      .single();
    return { user: existing as User, profile: profile as UserProfile, isNew: false };
  }

  const { data: newUser } = await supabase
    .from('users')
    .insert({ telegram_id: telegramId, username, first_name: firstName })
    .select('*')
    .single();

  const { data: newProfile } = await supabase
    .from('user_profiles')
    .insert({ user_id: newUser!.id })
    .select('*')
    .single();

  return { user: newUser as User, profile: newProfile as UserProfile, isNew: true };
}

// Возвращает true если лимит исчерпан
export async function checkAndIncrementLimit(userId: string): Promise<boolean> {
  const nowMoscow = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const todayMoscow = nowMoscow.toISOString().split('T')[0];

  const { data: user } = await supabase
    .from('users')
    .select('daily_message_count, daily_reset_at')
    .eq('id', userId)
    .single();

  if (!user) return false;

  if (user.daily_reset_at !== todayMoscow) {
    await supabase
      .from('users')
      .update({ daily_message_count: 1, daily_reset_at: todayMoscow })
      .eq('id', userId);
    return false;
  }

  if (user.daily_message_count >= config.app.dailyMessageLimit) return true;

  await supabase
    .from('users')
    .update({ daily_message_count: user.daily_message_count + 1 })
    .eq('id', userId);
  return false;
}

export async function markUserInactive(userId: string): Promise<void> {
  await supabase.from('users').update({ is_active: false }).eq('id', userId);
  // Отменяем все будущие follow_up
  await supabase
    .from('user_profiles')
    .update({ follow_up_needed: false })
    .eq('user_id', userId);
}

export async function updateLastInteraction(userId: string): Promise<void> {
  await supabase
    .from('user_profiles')
    .update({ last_interaction_at: new Date().toISOString() })
    .eq('user_id', userId);
}

export async function saveMessages(
  userId: string,
  sessionId: string,
  userText: string,
  botText: string,
  bibleReferences: string[] = []
): Promise<void> {
  await supabase.from('messages').insert([
    { user_id: userId, session_id: sessionId, role: 'user', content: userText },
    {
      user_id: userId,
      session_id: sessionId,
      role: 'assistant',
      content: botText,
      bible_references: bibleReferences,
    },
  ]);
}

export async function isAdmin(telegramId: number): Promise<boolean> {
  const { data } = await supabase
    .from('users')
    .select('role')
    .eq('telegram_id', telegramId)
    .single();
  return data?.role === 'admin';
}
