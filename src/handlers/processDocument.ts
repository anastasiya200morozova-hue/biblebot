import TelegramBot from 'node-telegram-bot-api';
import { supabase } from '../lib/supabase';
import { getEmbeddingsBatch } from '../lib/embeddings';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const CHUNK_SIZE = 400;
const CHUNK_OVERLAP = 50;
const ALLOWED_MIME = ['text/plain', 'application/pdf'];

export async function processDocument(
  bot: TelegramBot,
  chatId: number,
  userId: string,
  document: TelegramBot.Document
): Promise<void> {
  if ((document.file_size ?? 0) > MAX_FILE_SIZE) {
    await bot.sendMessage(chatId, 'Файл слишком большой. Максимум 5MB 🙏');
    return;
  }

  if (!ALLOWED_MIME.includes(document.mime_type ?? '')) {
    await bot.sendMessage(chatId, 'Поддерживаются только .txt и .pdf файлы');
    return;
  }

  await bot.sendMessage(chatId, '⏳ Обрабатываю файл...');

  const fileLink = await bot.getFileLink(document.file_id);

  const res = await fetch(fileLink);
  const rawText = await res.text();
  const title = document.file_name?.replace(/\.[^.]+$/, '') ?? 'Без названия';

  const chunks = splitIntoChunks(rawText, CHUNK_SIZE, CHUNK_OVERLAP);

  // Эмбеддинги батчами по 50
  const BATCH = 50;
  let inserted = 0;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const embeddings = await getEmbeddingsBatch(batch);
    const rows = batch.map((content, j) => ({
      sermon_title: title,
      chunk_index: i + j,
      content,
      embedding: embeddings[j],
      uploaded_by: userId,
    }));
    await supabase.from('sermon_chunks').insert(rows);
    inserted += batch.length;
  }

  await bot.sendMessage(chatId, `✅ Кафедра "${title}" загружена. ${inserted} фрагментов проиндексировано.`);
}

function splitIntoChunks(text: string, size: number, overlap: number): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let i = 0;
  while (i < words.length) {
    chunks.push(words.slice(i, i + size).join(' '));
    i += size - overlap;
  }
  return chunks.filter(c => c.trim().length > 0);
}
