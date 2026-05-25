import TelegramBot from 'node-telegram-bot-api';
import { supabase } from '../lib/supabase';
import { UI } from '../config';
import type { UserProfile } from '../types';

export async function handleStart(
  bot: TelegramBot,
  chatId: number,
  profile: UserProfile
): Promise<void> {
  if (profile.onboarding_step === 'done') {
    await bot.sendMessage(chatId, UI.help);
    return;
  }
  await bot.sendMessage(chatId, UI.onboardingGreeting);
}

export async function saveName(
  bot: TelegramBot,
  chatId: number,
  userId: string,
  nameText: string
): Promise<void> {
  const name = nameText.trim().split(' ')[0]; // берём только первое слово
  await supabase
    .from('user_profiles')
    .update({ name, onboarding_step: 'done' })
    .eq('user_id', userId);

  await bot.sendMessage(chatId, UI.onboardingAfterName(name));
}

export async function handleHelp(bot: TelegramBot, chatId: number): Promise<void> {
  await bot.sendMessage(chatId, UI.help);
}

export async function handleProfile(
  bot: TelegramBot,
  chatId: number,
  userId: string
): Promise<void> {
  const [profileRes, memoryRes, countRes] = await Promise.all([
    supabase.from('user_profiles').select('name, spiritual_topics, prayer_topics, created_at').eq('user_id', userId).single(),
    supabase.from('user_memory').select('category, value').eq('user_id', userId).order('last_mentioned_at', { ascending: false }).limit(5),
    supabase.from('messages').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('role', 'user'),
  ]);

  const profile = profileRes.data;
  const memory = memoryRes.data ?? [];
  const msgCount = countRes.count ?? 0;

  const name = profile?.name ?? 'Незнакомец';
  const topics = profile?.spiritual_topics?.slice(0, 3).join(', ') || 'пока не определены';
  const prayerTopics = profile?.prayer_topics?.slice(0, 3).join(', ') || 'пока нет';
  const since = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—';

  const topFacts = memory
    .filter(m => m.category !== 'prayer')
    .slice(0, 3)
    .map(m => `• ${m.value}`)
    .join('\n');

  const text = `Вот что я знаю о тебе, ${name}:

📌 Темы разговоров: ${topics}
🙏 Темы молитв: ${prayerTopics}${topFacts ? `\n💬 Последнее важное:\n${topFacts}` : ''}
✉️ Сообщений всего: ${msgCount}
📅 Общаемся с: ${since}

Чтобы удалить всю память — /forget`;

  await bot.sendMessage(chatId, text);
}

export async function handleReminders(
  bot: TelegramBot,
  chatId: number,
  userId: string
): Promise<void> {
  const { data: reminders } = await supabase
    .from('reminders')
    .select('remind_at, text')
    .eq('user_id', userId)
    .eq('is_sent', false)
    .eq('is_cancelled', false)
    .order('remind_at', { ascending: true });

  if (!reminders || reminders.length === 0) {
    await bot.sendMessage(chatId, UI.noReminders);
    return;
  }

  const list = reminders
    .map((r, i) => {
      const dt = new Date(r.remind_at).toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      });
      return `${i + 1}. ${dt} — ${r.text}`;
    })
    .join('\n');

  await bot.sendMessage(chatId, `Твои напоминания:\n\n${list}\n\nЧтобы отменить — напиши "отмени напоминание 1"`);
}

export async function handleForget(
  bot: TelegramBot,
  chatId: number,
  userId: string
): Promise<void> {
  await supabase.from('user_memory').delete().eq('user_id', userId);
  await supabase
    .from('user_profiles')
    .update({
      spiritual_topics: [],
      prayer_topics: [],
      life_context: {},
      follow_up_needed: false,
      follow_up_at: null,
      follow_up_topic: null,
    })
    .eq('user_id', userId);

  await bot.sendMessage(chatId, UI.forgetConfirm);
}

export async function handleWeekly(
  bot: TelegramBot,
  chatId: number,
  userId: string,
  command: string
): Promise<void> {
  const enable = command.includes('on');
  const disable = command.includes('off');

  if (!enable && !disable) {
    await bot.sendMessage(chatId, 'Используй /weekly on или /weekly off');
    return;
  }

  await supabase
    .from('users')
    .update({ weekly_summary_enabled: enable })
    .eq('id', userId);

  await bot.sendMessage(
    chatId,
    enable
      ? '✅ Воскресный итог включён — буду писать каждое воскресенье в 19:00'
      : '🔕 Воскресный итог отключён'
  );
}
