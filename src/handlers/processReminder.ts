import TelegramBot from 'node-telegram-bot-api';
import { callClaude } from '../lib/claude';
import { supabase } from '../lib/supabase';
import { config } from '../config';
import type { ReminderParseResult } from '../types';

const ORDINALS: Record<string, number> = {
  первое: 1, второе: 2, третье: 3, четвёртое: 4, пятое: 5,
};

export async function processReminder(
  bot: TelegramBot,
  chatId: number,
  userId: string,
  text: string
): Promise<void> {
  const nowMoscow = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

  const prompt = `Из сообщения извлеки напоминание. Текущее время: ${nowMoscow} (МСК, UTC+3).
Ответь только JSON:
{
  "reminder_text": "текст напоминания",
  "remind_at_iso": "2026-05-04T07:00:00Z",
  "parsed_successfully": true
}
Если время не удалось распознать: {"reminder_text":"","remind_at_iso":"","parsed_successfully":false}

Правила:
- "завтра утром" → следующий день 09:00 МСК → UTC (минус 3 часа)
- "в воскресенье" → ближайшее воскресенье 09:00 МСК если время не указано
- "через 2 часа" → now + 2h
- "каждый день" → только первый раз (повторы не поддерживаются)
- Время в прошлом → parsed_successfully: false

Сообщение: ${text}`;

  let raw: string;
  try {
    raw = await callClaude({
      system: 'Ты — система парсинга напоминаний. Отвечай только валидным JSON.',
      messages: [{ role: 'user', content: prompt }],
      model: config.anthropic.modelAux,
      maxTokens: 256,
      userId,
    });
  } catch {
    await bot.sendMessage(chatId, 'Не смог распознать напоминание. Попробуй ещё раз 🙏');
    return;
  }

  let parsed: ReminderParseResult;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw.trim()) as ReminderParseResult;
  } catch {
    await bot.sendMessage(chatId, 'Не смог распознать напоминание. Попробуй ещё раз 🙏');
    return;
  }

  if (!parsed.parsed_successfully) {
    await bot.sendMessage(
      chatId,
      'Это время уже прошло или я не смог его распознать. Уточни, пожалуйста: например "напомни в воскресенье в 10 утра" 🙏'
    );
    return;
  }

  await supabase.from('reminders').insert({
    user_id: userId,
    text: parsed.reminder_text,
    remind_at: parsed.remind_at_iso,
  });

  const dt = new Date(parsed.remind_at_iso).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });

  await bot.sendMessage(chatId, `✅ Напомню ${dt} — ${parsed.reminder_text} 🙏`);
}

export async function cancelReminder(
  bot: TelegramBot,
  chatId: number,
  userId: string,
  text: string
): Promise<void> {
  const match = text.match(/(\d+)/);
  const ordinalEntry = Object.entries(ORDINALS).find(([word]) => text.toLowerCase().includes(word));
  const num = match ? parseInt(match[1], 10) : ordinalEntry ? ordinalEntry[1] : null;

  if (!num) {
    await bot.sendMessage(chatId, 'Напиши номер напоминания. Посмотреть список: /reminders');
    return;
  }

  const { data: reminders } = await supabase
    .from('reminders')
    .select('id')
    .eq('user_id', userId)
    .eq('is_sent', false)
    .eq('is_cancelled', false)
    .order('remind_at', { ascending: true });

  const target = reminders?.[num - 1];
  if (!target) {
    await bot.sendMessage(chatId, 'У тебя нет напоминания с таким номером 🙏');
    return;
  }

  await supabase.from('reminders').update({ is_cancelled: true }).eq('id', target.id);
  await bot.sendMessage(chatId, '✅ Напоминание отменено');
}
