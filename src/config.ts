import 'dotenv/config';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  telegram: {
    token: requireEnv('TELEGRAM_BOT_TOKEN'),
    webhookSecret: requireEnv('TELEGRAM_WEBHOOK_SECRET'),
    webhookUrl: requireEnv('TELEGRAM_WEBHOOK_URL'),
  },
  anthropic: {
    apiKey: requireEnv('ANTHROPIC_API_KEY'),
    modelMain: 'claude-sonnet-4-20250514',
    modelAux: 'claude-haiku-4-5-20251001',
  },
  openai: {
    apiKey: requireEnv('OPENAI_API_KEY'),
    embeddingModel: 'text-embedding-3-small',
  },
  supabase: {
    url: requireEnv('SUPABASE_URL'),
    serviceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  },
  admin: {
    secret: requireEnv('ADMIN_SECRET'),
    telegramId: parseInt(requireEnv('ADMIN_TELEGRAM_ID'), 10),
  },
  app: {
    port: parseInt(process.env.PORT ?? '3000', 10),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    dailyMessageLimit: parseInt(process.env.DAILY_MESSAGE_LIMIT ?? '20', 10),
    sessionTimeoutMinutes: parseInt(process.env.SESSION_TIMEOUT_MINUTES ?? '30', 10),
  },
} as const;

// Кризисные триггеры — здесь, не в промпте, чтобы нельзя было обойти инъекцией
export const CRISIS_TRIGGERS = [
  'не хочу жить',
  'хочу умереть',
  'покончить с собой',
  'нет смысла жить',
  'лучше бы меня не было',
  'суицид',
  'убить себя',
  'конец жизни',
  'хочу уйти из жизни',
  'мне незачем жить',
  'думаю о смерти',
];

export function detectCrisis(text: string): string[] {
  const lower = text.toLowerCase();
  return CRISIS_TRIGGERS.filter(t => lower.includes(t));
}

// Intent detection — детерминированный, без LLM
export function detectIntent(text: string): 'reminder' | 'cancel_reminder' | 'message' {
  const t = text.toLowerCase();
  if (/отмени|удали|убери/.test(t) && /напоминани/.test(t)) return 'cancel_reminder';
  if (/напомни|напоминание|не забудь напомнить/.test(t)) return 'reminder';
  return 'message';
}

// Тексты UI
export const UI = {
  onboardingGreeting: `Привет! Я BibleBot 🙏

Я здесь чтобы быть рядом — как друг, у которого всегда открыта Библия.
Могу поговорить о чём угодно: семья, работа, страхи, радости, сомнения.
Отвечаю с опорой на Слово Бога.

Как тебя зовут?`,

  onboardingAfterName: (name: string) => `Рад познакомиться, ${name}! 😊
Пиши мне всё что на сердце — я слушаю 🙏`,

  limitReached: `Возвращайся завтра — буду рад продолжить! 🙏

_"Покойтесь и знайте, что Я Бог"_ — Пс 45:11

Бог с тобой 🙏`,

  crisis: (name: string) => `${name}, я слышу тебя. То что ты чувствуешь — это очень тяжело. 💙

_"Ибо Я знаю намерения какие имею о вас, говорит Господь, намерения во благо а не на зло"_ — Иер 29:11

Пожалуйста, не оставайся с этим один.
Поговори с пастором или позвони на бесплатную линию помощи:
📞 8-800-2000-122 (круглосуточно, бесплатно)

Я здесь если хочешь говорить 🙏`,

  errorRetry: 'Прости, что-то пошло не так. Попробуй ещё раз через минуту 🙏',

  technicalWork: 'Технические работы, попробуй через минуту 🙏',

  help: `Что я умею:

💬 Общаться на любые темы с опорой на Библию
📖 Рассказывать примеры из жизни библейских героев
⏰ Ставить напоминания ("напомни помолиться в воскресенье в 10")
👤 /profile — что я о тебе помню
📋 /reminders — твои напоминания
🔕 /weekly off — отключить воскресный итог
🗑 /forget — удалить всю мою память о тебе`,

  noReminders: 'У тебя пока нет активных напоминаний. Скажи мне "напомни..." — и я запомню 🙏',

  reminderCancelled: '✅ Напоминание отменено',

  reminderNotFound: 'У тебя нет напоминания с таким номером 🙏',

  forgetConfirm: '✅ Я удалил всё что знал о тебе. Начинаем с чистого листа 🙏',
};
