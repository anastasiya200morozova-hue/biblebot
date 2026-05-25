import { callClaude } from './claude';
import { supabase } from './supabase';
import { config } from '../config';
import type { MemoryFact, UserContext } from '../types';

const MAX_MEMORY_RECORDS = 200;
const MEMORY_IN_PROMPT = 20;

export async function extractAndSaveMemory(userId: string, text: string): Promise<void> {
  const prompt = `Из текста сообщения извлеки факты о пользователе для долгосрочной памяти.
Верни JSON: { "facts": [{ "category": "person|situation|prayer|topic|fact", "key": "...", "value": "..." }] }
Если фактов нет — {"facts": []}
Не извлекай общие истины, только личные факты о пользователе.

Примеры:
"Поругался с братом Петей" → {category:"person", key:"брат", value:"Петя, был конфликт"}
"Боюсь потерять работу" → {category:"situation", key:"страх работы", value:"боится потерять работу"}
"Молюсь за маму" → {category:"prayer", key:"мама", value:"молится за маму"}

Сообщение: ${text}`;

  let raw: string;
  try {
    raw = await callClaude({
      system: 'Ты — система извлечения фактов. Отвечай только валидным JSON.',
      messages: [{ role: 'user', content: prompt }],
      model: config.anthropic.modelAux,
      maxTokens: 512,
      userId,
    });
  } catch {
    return;
  }

  let facts: MemoryFact[] = [];
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw.trim()) as { facts: MemoryFact[] };
    facts = parsed.facts ?? [];
  } catch {
    return;
  }

  for (const fact of facts) {
    await upsertMemory(userId, fact);
  }

  await pruneOldMemory(userId);
}

async function upsertMemory(userId: string, fact: MemoryFact): Promise<void> {
  const { data: existing } = await supabase
    .from('user_memory')
    .select('id, mentioned_count')
    .eq('user_id', userId)
    .eq('key', fact.key)
    .single();

  if (existing) {
    await supabase
      .from('user_memory')
      .update({
        value: fact.value,
        mentioned_count: existing.mentioned_count + 1,
        last_mentioned_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
  } else {
    await supabase.from('user_memory').insert({
      user_id: userId,
      category: fact.category,
      key: fact.key,
      value: fact.value,
    });
  }
}

async function pruneOldMemory(userId: string): Promise<void> {
  const { count } = await supabase
    .from('user_memory')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  if ((count ?? 0) <= MAX_MEMORY_RECORDS) return;

  const { data: oldest } = await supabase
    .from('user_memory')
    .select('id')
    .eq('user_id', userId)
    .order('last_mentioned_at', { ascending: true })
    .limit((count ?? 0) - MAX_MEMORY_RECORDS);

  if (oldest && oldest.length > 0) {
    const ids = oldest.map(r => r.id);
    await supabase.from('user_memory').delete().in('id', ids);
  }
}

export async function loadTopMemory(userId: string): Promise<string> {
  const { data } = await supabase
    .from('user_memory')
    .select('category, key, value')
    .eq('user_id', userId)
    .order('last_mentioned_at', { ascending: false })
    .limit(MEMORY_IN_PROMPT);

  if (!data || data.length === 0) return '';
  return data.map(m => `[${m.category}] ${m.key}: ${m.value}`).join('\n');
}

export async function loadUserContext(userId: string, sessionId: string): Promise<UserContext> {
  const [userRes, profileRes, memoryRes, messagesRes] = await Promise.all([
    supabase.from('users').select('*').eq('id', userId).single(),
    supabase.from('user_profiles').select('*').eq('user_id', userId).single(),
    supabase
      .from('user_memory')
      .select('*')
      .eq('user_id', userId)
      .order('last_mentioned_at', { ascending: false })
      .limit(MEMORY_IN_PROMPT),
    supabase
      .from('messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  return {
    user: userRes.data!,
    profile: profileRes.data!,
    memory: memoryRes.data ?? [],
    recentMessages: (messagesRes.data ?? []).reverse(),
  };
}
