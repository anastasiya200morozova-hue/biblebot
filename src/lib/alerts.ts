import { config } from '../config';

// Импортируется лениво чтобы избежать циклических зависимостей при старте
let botInstance: { sendMessage: (chatId: number, text: string) => Promise<unknown> } | null = null;

export function registerBotForAlerts(bot: { sendMessage: (chatId: number, text: string) => Promise<unknown> }): void {
  botInstance = bot;
}

export async function sendAdminAlert(message: string): Promise<void> {
  if (!botInstance) return;
  try {
    await botInstance.sendMessage(config.admin.telegramId, message);
  } catch {
    // Не бросаем ошибку — алерт не должен ломать основной поток
  }
}
