import { supabase } from './supabase';
import { getEmbedding } from './embeddings';
import type { BibleVerse, SermonChunk } from '../types';

export async function searchBibleVerses(
  query: string,
  matchCount = 5,
  similarityThreshold = 0.7
): Promise<BibleVerse[]> {
  let embedding: number[];
  try {
    embedding = await getEmbedding(query);
  } catch {
    // Если OpenAI недоступен — возвращаем пустой массив, Claude использует свои знания
    return [];
  }

  const { data, error } = await supabase.rpc('search_bible_verses', {
    query_embedding: embedding,
    match_count: matchCount,
    similarity_threshold: similarityThreshold,
  });

  if (error) return [];
  return (data ?? []) as BibleVerse[];
}

export async function searchSermonChunks(
  query: string,
  matchCount = 3,
  similarityThreshold = 0.7
): Promise<SermonChunk[]> {
  let embedding: number[];
  try {
    embedding = await getEmbedding(query);
  } catch {
    return [];
  }

  const { data, error } = await supabase.rpc('search_sermon_chunks', {
    query_embedding: embedding,
    match_count: matchCount,
    similarity_threshold: similarityThreshold,
  });

  if (error) return [];
  return (data ?? []) as SermonChunk[];
}

export function formatBibleVerses(verses: BibleVerse[]): string {
  if (verses.length === 0) return '';
  return verses
    .map(v => `${v.book} ${v.chapter}:${v.verse} — "${v.text}"`)
    .join('\n');
}

export function formatSermonChunks(chunks: SermonChunk[]): string {
  if (chunks.length === 0) return '';
  return chunks
    .map(c => `[${c.sermon_title}${c.church_name ? ` / ${c.church_name}` : ''}]\n${c.content}`)
    .join('\n\n');
}
