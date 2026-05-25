import cron from 'node-cron';
import TelegramBot from 'node-telegram-bot-api';
import { supabase } from '../lib/supabase';
import { markUserInactive } from '../lib/users';

export function startRemindersJob(bot: TelegramBot): void {
  // Каждую минуту
  cron.schedule('* * * * *', async () => {
    const now = new Date().toISOString();

    const { data: due } = await supabase
      .from('reminders')
      .select('id, user_id, text, users(telegram_id, is_active)')
      .lte('remind_at', now)
      .eq('is_sent', false)
      .eq('is_cancelled', false);

    if (!due || due.length === 0) return;

    for (const reminder of due) {
      const userRow = reminder.users as unknown as { telegram_id: number; is_active: boolean } | null;
      if (!userRow || !userRow.is_active) continue;

      // Получаем имя из профиля
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('name')
        .eq('user_id', reminder.user_id)
        .single();
      const name = profile?.name ?? '';

      try {
        await bot.sendMessage(
          userRow.telegram_id,
          `🔔 ${name ? `${name}, ты` : 'Ты'} просил напомнить: ${reminder.text} 🙏`
        );
        await supabase
          .from('reminders')
          .update({ is_sent: true, sent_at: new Date().toISOString() })
          .eq('id', reminder.id);
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('403')) {
          await markUserInactive(reminder.user_id);
        }
        // При других ошибках оставляем напоминание активным — попробуем на следующей минуте
      }
    }
  });
}
