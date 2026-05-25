import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { registerRouter } from './router';
import { registerBotForAlerts } from '../lib/alerts';
import { createWebhookServer } from './webhook';
import { startRemindersJob } from '../cron/reminders';
import { startFollowUpJob } from '../cron/followUp';
import { startWeeklySummaryJob } from '../cron/weeklySummary';
import { registerAdminRoutes } from '../admin/routes';

async function main(): Promise<void> {
  const bot = new TelegramBot(config.telegram.token, { polling: false });

  // Регистрируем бота для отправки алертов
  registerBotForAlerts(bot);

  // Роутер апдейтов
  registerRouter(bot);

  // Webhook-сервер
  const app = createWebhookServer(bot);
  registerAdminRoutes(app);

  app.listen(config.app.port, () => {
    console.log(`BibleBot webhook listening on port ${config.app.port}`);
  });

  // Устанавливаем webhook в Telegram (с retry на случай временных сетевых ошибок)
  const webhookUrl = `${config.telegram.webhookUrl}/${config.telegram.webhookSecret}`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await bot.setWebHook(webhookUrl, { secret_token: config.telegram.webhookSecret });
      break;
    } catch (err) {
      if (attempt === 5) throw err;
      console.warn(`setWebHook attempt ${attempt} failed, retrying in ${attempt * 2}s...`);
      await new Promise(r => setTimeout(r, attempt * 2000));
    }
  }

  // Cron-задачи
  startRemindersJob(bot);
  startFollowUpJob(bot);
  startWeeklySummaryJob(bot);

  console.log('BibleBot started successfully');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
