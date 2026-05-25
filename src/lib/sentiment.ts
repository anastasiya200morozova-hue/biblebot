import { callClaude } from './claude';
import { supabase } from './supabase';
import { config } from '../config';
import type { Sentiment, SentimentResult } from '../types';

export async function detectSentiment(
  userId: string,
  text: string
): Promise<SentimentResult | null> {
  const prompt = `Определи эмоциональный тон сообщения. Ответь только JSON:
{"sentiment": "positive"|"neutral"|"negative", "confidence": 0.0-1.0}

Negative — если человек выражает боль, страх, тревогу, депрессию, конфликт, потерю.
Positive — радость, благодарность, победа, вдохновение.
Neutral — вопросы, нейтральные темы.

Сообщение: ${text}`;

  let raw: string;
  try {
    raw = await callClaude({
      system: 'Ты — система анализа тональности. Отвечай только валидным JSON.',
      messages: [{ role: 'user', content: prompt }],
      model: config.anthropic.modelAux,
      maxTokens: 64,
      userId,
    });
  } catch {
    return null;
  }

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch ? jsonMatch[0] : raw.trim()) as SentimentResult;
  } catch {
    return null;
  }
}

export async function setFollowUpIfNeeded(
  userId: string,
  result: SentimentResult,
  topic: string
): Promise<void> {
  if (result.sentiment !== 'negative' || result.confidence <= 0.7) return;

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('last_follow_up_sent_at')
    .eq('user_id', userId)
    .single();

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const lastFollowUp = profile?.last_follow_up_sent_at;
  if (lastFollowUp && new Date(lastFollowUp).getTime() > weekAgo) return;

  const followUpAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  await supabase
    .from('user_profiles')
    .update({
      follow_up_needed: true,
      follow_up_at: followUpAt,
      follow_up_topic: topic.slice(0, 200),
    })
    .eq('user_id', userId);
}
