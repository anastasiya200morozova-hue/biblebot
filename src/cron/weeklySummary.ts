import cron from 'node-cron';
import TelegramBot from 'node-telegram-bot-api';
import { supabase } from '../lib/supabase';
import { callClaude } from '../lib/claude';
import { searchBibleVerses } from '../lib/vectorSearch';
import { markUserInactive } from '../lib/users';
import { config } from '../config';

export function startWeeklySummaryJob(bot: TelegramBot): void {
  // Воскресенье в 16:00 UTC = 19:00 МСК
  cron.schedule('0 16 * * 0', async () => {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Пользователи с 3+ сообщениями за неделю и включённым итогом
    const { data: activeUsers } = await supabase
      .from('users')
      .select('id, telegram_id')
      .eq('is_active', true)
      .eq('weekly_summary_enabled', true);

    if (!activeUsers) return;

    for (const u of activeUsers) {
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', u.id)
        .eq('role', 'user')
        .gte('created_at', weekAgo);

      if ((count ?? 0) < 3) continue;

      await sendWeeklySummary(bot, u.id, u.telegram_id, weekAgo);
    }
  });
}

async function sendWeeklySummary(
  bot: TelegramBot,
  userId: string,
  telegramId: number,
  since: string
): Promise<void> {
  const [profileRes, messagesRes] = await Promise.all([
    supabase.from('user_profiles').select('name, spiritual_topics').eq('user_id', userId).single(),
    supabase
      .from('messages')
      .select('content')
      .eq('user_id', userId)
      .eq('role', 'user')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  const name = profileRes.data?.name ?? '';
  const topics = profileRes.data?.spiritual_topics ?? [];
  const messages = messagesRes.data ?? [];

  const msgSummary = messages.map(m => m.content).join('. ').slice(0, 1000);

  const [verses] = await Promise.all([
    searchBibleVerses(msgSummary || topics.join(' ')),
  ]);

  const versesText = verses.slice(0, 2).map(v => `${v.book} ${v.chapter}:${v.verse} — "${v.text}"`).join('\n');

  const prompt = `Напиши краткое воскресное ободрение для ${name || 'пользователя'}.
Темы недели: ${topics.slice(0, 3).join(', ') || 'разные жизненные ситуации'}.
Релевантные стихи:\n${versesText}

Сообщение: тёплое, 80-120 слов, 1 стих курсивом, завершить молитвенным словом.
Без заголовков, без списков.`;

  let summary: string;
  try {
    summary = await callClaude({
      system: 'Ты — BibleBot, пишешь воскресное ободрение.',
      messages: [{ role: 'user', content: prompt }],
      model: config.anthropic.modelAux,
      maxTokens: 512,
      userId,
    });
  } catch {
    return;
  }

  try {
    await bot.sendMessage(telegramId, summary, { parse_mode: 'Markdown' });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('403')) {
      await markUserInactive(userId);
    }
  }
}
