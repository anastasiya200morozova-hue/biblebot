import TelegramBot from 'node-telegram-bot-api';
import { supabase } from '../lib/supabase';
import { sendAdminAlert } from '../lib/alerts';
import { UI } from '../config';

export async function handleCrisis(
  bot: TelegramBot,
  chatId: number,
  userId: string,
  messageText: string,
  triggerKeywords: string[],
  userName: string | null
): Promise<void> {
  const name = userName ?? 'Друг';
  const responseText = UI.crisis(name);

  // Отправляем статичный ответ — без Claude, мгновенно
  try {
    await bot.sendMessage(chatId, responseText, { parse_mode: 'Markdown' });
  } catch {
    await bot.sendMessage(chatId, responseText);
  }

  // Записываем в crisis_logs
  await supabase.from('crisis_logs').insert({
    user_id: userId,
    message_content: messageText,
    trigger_keywords: triggerKeywords,
    bot_response: responseText,
  });

  // Алерт администратору
  await sendAdminAlert(
    `🚨 Кризисная ситуация!\nuser_id: ${userId}\nТриггеры: ${triggerKeywords.join(', ')}\nСообщение: "${messageText.slice(0, 200)}"`
  );
}
