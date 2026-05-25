import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';

export function createWebhookServer(bot: TelegramBot): express.Application {
  const app = express();
  app.use(express.json());

  const webhookPath = `/webhook/${config.telegram.webhookSecret}`;

  app.post(webhookPath, (req, res) => {
    // Валидируем секретный заголовок Telegram
    const header = req.headers['x-telegram-bot-api-secret-token'];
    if (header !== config.telegram.webhookSecret) {
      res.sendStatus(403);
      return;
    }
    bot.processUpdate(req.body as TelegramBot.Update);
    res.sendStatus(200);
  });

  // Healthcheck
  app.get('/health', (_req, res) => {
    res.json({ ok: true, ts: new Date().toISOString() });
  });

  return app;
}
