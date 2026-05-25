import TelegramBot from 'node-telegram-bot-api';
import { detectIntent } from '../config';
import { isRateLimited } from '../lib/rateLimit';
import { getOrCreateUser } from '../lib/users';
import { processMessage } from '../handlers/processMessage';
import { processReminder, cancelReminder } from '../handlers/processReminder';
import {
  handleStart,
  saveName,
  handleHelp,
  handleProfile,
  handleReminders,
  handleForget,
  handleWeekly,
} from '../handlers/handleCommands';
import { processDocument } from '../handlers/processDocument';

export function registerRouter(bot: TelegramBot): void {
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id;
    if (!telegramId) return;

    // Rate limiting
    if (isRateLimited(telegramId)) return;

    const text = msg.text ?? '';
    const username = msg.from?.username ?? null;
    const firstName = msg.from?.first_name ?? null;

    // Получаем или создаём пользователя
    let user, profile;
    try {
      ({ user, profile } = await getOrCreateUser(telegramId, username, firstName));
    } catch {
      await bot.sendMessage(chatId, 'Технические работы, попробуй через минуту 🙏');
      return;
    }

    // Команды
    if (text === '/start') {
      await handleStart(bot, chatId, profile);
      return;
    }
    if (text === '/help') {
      await handleHelp(bot, chatId);
      return;
    }
    if (text === '/profile') {
      await handleProfile(bot, chatId, user.id);
      return;
    }
    if (text === '/reminders') {
      await handleReminders(bot, chatId, user.id);
      return;
    }
    if (text === '/forget') {
      await handleForget(bot, chatId, user.id);
      return;
    }
    if (text.startsWith('/weekly')) {
      await handleWeekly(bot, chatId, user.id, text);
      return;
    }

    // Онбординг: ждём имя
    if (profile.onboarding_step === 'awaiting_name') {
      if (!text) {
        await bot.sendMessage(chatId, 'Как тебя зовут?');
        return;
      }
      await saveName(bot, chatId, user.id, text);
      return;
    }

    // Документ (только для admin)
    if (msg.document) {
      if (user.role === 'admin') {
        await processDocument(bot, chatId, user.id, msg.document);
      } else {
        await bot.sendMessage(chatId, 'Загрузка документов доступна только администратору.');
      }
      return;
    }

    // Нет текста — пропускаем (фото, стикеры и т.д.)
    if (!text) return;

    // Intent detection
    const intent = detectIntent(text);

    if (intent === 'reminder') {
      await processReminder(bot, chatId, user.id, text);
      return;
    }

    if (intent === 'cancel_reminder') {
      await cancelReminder(bot, chatId, user.id, text);
      return;
    }

    // Основной диалог
    await processMessage(bot, chatId, telegramId, user.id, text, {
      name: profile.name,
      prayer_topics: profile.prayer_topics,
    });
  });
}
