# BibleBot — Христианский AI-советник в Telegram

## Обзор
Telegram-бот, который отвечает на жизненные вопросы с опорой на Библию, помнит пользователя между сессиями, отправляет напоминания и проявляет проактивную заботу. Аудитория: русскоязычные протестанты/евангельские христиане, 25–45 лет.

## Стек технологий
- **Runtime:** Node.js 20, TypeScript, VPS Ubuntu 22, PM2
- **Telegram:** node-telegram-bot-api (webhook, не polling)
- **LLM основной:** Claude Sonnet (`claude-sonnet-4-20250514`) — основные диалоги
- **LLM вспомогательный:** Claude Haiku (`claude-haiku-4-5-20251001`) — extract_memory, sentiment, парсинг напоминаний, follow_up
- **БД:** Supabase (PostgreSQL 15 + pgvector, RLS на всех таблицах)
- **Эмбеддинги:** OpenAI `text-embedding-3-small` (vector 1536)
- **Планировщик:** node-cron

## Архитектура
```
src/
  bot/         — инициализация, роутер апдейтов, Express webhook-сервер
  handlers/    — processMessage, processReminder, handleCrisis, handleCommands
  cron/        — reminders (каждую мин), followUp (каждый час), weeklySummary (вс 19:00 МСК)
  lib/         — claude, supabase, embeddings, vectorSearch, memory, sentiment, session, rateLimit, crisis
  admin/       — REST API: /admin/stats, /admin/crisis, /admin/crisis/:id/review
  scripts/     — seedBible.ts (разовая загрузка 31 102 стихов Синодального перевода)
  types/       — единые TypeScript-типы проекта
  config.ts    — константы, тексты UI, CRISIS_TRIGGERS (здесь, не в промпте)
```

### Ключевые потоки
**Роутинг:** команды (/start /help /profile /reminders /forget /weekly) → onboarding (awaiting_name) → detectIntent (reminder / cancel_reminder) → processMessage

**processMessage (строго по порядку):**
getUser → checkDailyLimit → getOrCreateSession → detectCrisis → sendTyping → loadContext → vectorSearch Bible + Sermons (параллельно) → callClaude → sendMessage → saveMessages → incrementCount → [async] extractMemory + detectSentiment + logTokens

**Сессии:** таймаут SESSION_TIMEOUT_MINUTES (30 мин); при новой сессии история не передаётся в Claude — только долгосрочная память из user_memory.

## Правила кодирования
- TypeScript strict mode, без `any`
- Zod-валидация на всех входящих данных от Telegram
- Текст пользователя — только в `user`-роли Claude, НИКОГДА в system-промпте
- CRISIS_TRIGGERS хранятся в `config.ts` в коде, не в промпте — нельзя обойти инъекцией
- Асинхронные задачи (extractMemory, detectSentiment, logTokens) не блокируют ответ пользователю
- Claude API не вызывается после исчерпания дневного лимита (статичный ответ)
- Rate limiting: in-memory Map, 3 сообщения / 10 сек на telegram_id

## Работа с Supabase
- RLS включена на всех таблицах — только service_role имеет доступ
- Векторный поиск через Supabase RPC: `search_bible_verses()` и `search_sermon_chunks()`
- В промпт: топ-20 фактов user_memory по last_mentioned_at; max 200 записей (старые удаляются при INSERT)
- Дневной лимит сбрасывается в 00:00 МСК (поле daily_reset_at, сравнивается как DATE строка)

## Безопасность
- Webhook: secret в URL + заголовок `X-Telegram-Bot-Api-Secret-Token`
- Admin API: Bearer ADMIN_SECRET + IP-бан после 5 неудачных попыток
- При кризисе: немедленный статичный ответ (не через Claude) + запись в crisis_logs + алерт ADMIN_TELEGRAM_ID

## Переменные окружения (обязательные)
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_WEBHOOK_URL`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_SECRET`, `ADMIN_TELEGRAM_ID`, `PORT=3000`, `TZ=Europe/Moscow`, `DAILY_MESSAGE_LIMIT=20`, `SESSION_TIMEOUT_MINUTES=30`

## Команды
```bash
npm run build                            # tsc → dist/
npm run dev                              # локальная разработка
pm2 start ecosystem.config.js           # запуск в production
npx ts-node src/scripts/seedBible.ts    # разовая загрузка Библии (~30 мин, ~$0.50)
```

## Субагенты (.claude/agents/)
| Агент | Модель | Когда использовать |
|-------|--------|--------------------|
| `database-architect` | Opus | Таблицы, миграции, RLS, pgvector-индексы, RPC-функции |
| `backend-engineer` | Sonnet | Handlers, cron, lib, admin API, scripts |
| `ai-agent-architect` | Opus | Системный промпт, RAG-пайплайн, Haiku-промпты, качество AI |
| `qa-reviewer` | Sonnet | Проверка после реализации модуля (только чтение) |

## Ограничения MVP (не реализовывать)
Монетизация, мультиязычность, голосовые ответы, веб-интерфейс, план чтения Библии, групповой режим.
Алерт при стоимости API > $5 за день — уведомление ADMIN_TELEGRAM_ID.
