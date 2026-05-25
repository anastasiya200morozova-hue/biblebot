import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { supabase } from './supabase';

const anthropic = new Anthropic({
  apiKey: config.anthropic.apiKey,
  baseURL: process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com',
});

interface CallClaudeOptions {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  model?: string;
  maxTokens?: number;
  userId?: string;
  sessionId?: string;
}

export async function callClaude({
  system,
  messages,
  model = config.anthropic.modelMain,
  maxTokens = 1024,
  userId,
  sessionId,
}: CallClaudeOptions): Promise<string> {
  const startedAt = Date.now();

  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages,
  });

  const latencyMs = Date.now() - startedAt;
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  // Sonnet pricing: $3/$15 per 1M tokens
  const costUsd = (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;

  // Логируем асинхронно, не блокируем ответ
  logUsage({ userId, sessionId, model, inputTokens, outputTokens, costUsd, latencyMs }).catch(() => {});

  // Алерт если дневная стоимость > $5
  checkDailyCostAlert(costUsd).catch(() => {});

  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude');
  return block.text;
}

async function logUsage(params: {
  userId?: string;
  sessionId?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}): Promise<void> {
  await supabase.from('agent_logs').insert({
    user_id: params.userId ?? null,
    session_id: params.sessionId ?? null,
    model: params.model,
    input_tokens: params.inputTokens,
    output_tokens: params.outputTokens,
    cost_usd: params.costUsd,
    latency_ms: params.latencyMs,
  });
}

async function checkDailyCostAlert(latestCost: number): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('agent_logs')
    .select('cost_usd')
    .gte('created_at', `${today}T00:00:00Z`);

  const totalToday = (data ?? []).reduce((sum, row) => sum + (row.cost_usd ?? 0), 0) + latestCost;
  if (totalToday > 5) {
    // Алерт импортируется лениво чтобы избежать циклической зависимости
    const { sendAdminAlert } = await import('./alerts');
    await sendAdminAlert(`⚠️ Стоимость API за сегодня: $${totalToday.toFixed(2)} (порог $5)`);
  }
}
