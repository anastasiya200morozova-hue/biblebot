import { supabase } from './supabase';
import { config } from '../config';

const SESSION_TIMEOUT_MS = config.app.sessionTimeoutMinutes * 60 * 1000;

export async function getOrCreateSession(userId: string): Promise<string> {
  const { data: active } = await supabase
    .from('sessions')
    .select('id, last_message_at')
    .eq('user_id', userId)
    .eq('is_active', true)
    .single();

  if (active) {
    const elapsed = Date.now() - new Date(active.last_message_at).getTime();
    if (elapsed < SESSION_TIMEOUT_MS) {
      await supabase
        .from('sessions')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', active.id);
      return active.id;
    }
    // Сессия устарела — закрываем
    await supabase.from('sessions').update({ is_active: false }).eq('id', active.id);
  }

  const { data: newSession } = await supabase
    .from('sessions')
    .insert({ user_id: userId })
    .select('id')
    .single();

  return newSession!.id;
}
