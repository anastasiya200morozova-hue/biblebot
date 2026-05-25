// In-memory rate limiter: 3 сообщения / 10 сек на telegram_id
const WINDOW_MS = 10_000;
const MAX_MESSAGES = 3;
const BAN_MS = 60 * 60 * 1000; // 1 час

const timestamps = new Map<number, number[]>();
const bannedUntil = new Map<number, number>();

export function isRateLimited(telegramId: number): boolean {
  const now = Date.now();

  const banExpiry = bannedUntil.get(telegramId);
  if (banExpiry && now < banExpiry) return true;

  const times = (timestamps.get(telegramId) ?? []).filter(t => now - t < WINDOW_MS);
  times.push(now);
  timestamps.set(telegramId, times);

  if (times.length > MAX_MESSAGES) {
    bannedUntil.set(telegramId, now + BAN_MS);
    timestamps.delete(telegramId);
    return true;
  }

  return false;
}
