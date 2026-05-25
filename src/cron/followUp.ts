import cron from 'node-cron';
import TelegramBot from 'node-telegram-bot-api';
import { supabase } from '../lib/supabase';
import { markUserInactive } from '../lib/users';

export function startFollowUpJob(bot: TelegramBot): void {
  // Каждый час
  cron.schedule('0 * * * *', async () => {
    const now = new Date().toISOString();

    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('user_id, name, follow_up_topic, users(telegram_id, is_active)')
      .eq('follow_up_needed', true)
      .lte('follow_up_at', now);

    if (!profiles || profiles.length === 0) return;

    for (const profile of profiles) {
      const userRow = profile.users as unknown as { telegram_id: number; is_active: boolean } | null;
      if (!userRow || !userRow.is_active) continue;

      const name = profile.name ?? '';
      const topic = profile.follow_up_topic ?? 'то, о чём ты рассказывал';
      const text = `Привет${name ? `, ${name}` : ''}! Ты рассказывал о "${topic}". Как ты сейчас? 🙏`;

      try {
        await bot.sendMessage(userRow.telegram_id, text);

        await supabase
          .from('user_profiles')
          .update({
            follow_up_needed: false,
            follow_up_at: null,
            follow_up_topic: null,
            last_follow_up_sent_at: new Date().toISOString(),
          })
          .eq('user_id', profile.user_id);
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('403')) {
          await markUserInactive(profile.user_id);
        }
      }
    }
  });
}
