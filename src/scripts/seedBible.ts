import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { supabase } from '../lib/supabase';
import { getEmbeddingsBatch } from '../lib/embeddings';

// Ожидаемый формат JSON:
// [{ "book": "Бытие", "chapter": 1, "verse": 1, "text": "В начале..." }, ...]
interface VerseInput {
  book: string;
  chapter: number;
  verse: number;
  text: string;
}

const BATCH_SIZE = 100;
const JSON_PATH = path.resolve(process.cwd(), 'bible_rst.json');

async function seed(): Promise<void> {
  if (!fs.existsSync(JSON_PATH)) {
    console.error(`Файл не найден: ${JSON_PATH}`);
    console.error('Скачай Синодальный перевод в формате JSON и положи рядом как bible_rst.json');
    console.error('Формат: [{ "book": "Бытие", "chapter": 1, "verse": 1, "text": "..." }]');
    process.exit(1);
  }

  const raw = fs.readFileSync(JSON_PATH, 'utf-8');
  const verses: VerseInput[] = JSON.parse(raw);

  console.log(`Загружено ${verses.length} стихов из файла`);

  // Проверяем сколько уже есть в БД — продолжаем с того места где остановились
  const { count: existing } = await supabase
    .from('bible_verses')
    .select('*', { count: 'exact', head: true });

  const alreadyLoaded = existing ?? 0;
  if (alreadyLoaded > 0) {
    console.log(`В БД уже есть ${alreadyLoaded} стихов. Продолжаем с ${alreadyLoaded}-го...`);
  }
  if (alreadyLoaded >= verses.length) {
    console.log('✅ Все стихи уже загружены!');
    process.exit(0);
  }

  let inserted = alreadyLoaded;
  const total = verses.length;

  for (let i = alreadyLoaded; i < verses.length; i += BATCH_SIZE) {
    const batch = verses.slice(i, i + BATCH_SIZE);
    const texts = batch.map(v => `${v.book} ${v.chapter}:${v.verse} — ${v.text}`);

    let embeddings: number[][];
    let attempt = 0;
    while (true) {
      try {
        embeddings = await getEmbeddingsBatch(texts);
        break;
      } catch (err: unknown) {
        const isGeoBlock = err instanceof Error && err.message.includes('unsupported_country');
        const isRateLimit = err instanceof Error && err.message.includes('429');
        if ((isGeoBlock || isRateLimit) && attempt < 10) {
          attempt++;
          const wait = isGeoBlock ? 60 : 30;
          process.stdout.write(`\n⏳ Блокировка, жду ${wait} сек и повторяю (попытка ${attempt}/10)...`);
          await sleep(wait * 1000);
          continue;
        }
        console.error(`\nОшибка эмбеддингов на батче ${i}–${i + BATCH_SIZE}:`, err);
        process.exit(1);
      }
    }

    const rows = batch.map((v, j) => ({
      book: v.book,
      chapter: v.chapter,
      verse: v.verse,
      text: v.text,
      translation: 'RST',
      embedding: embeddings[j],
    }));

    const { error } = await supabase.from('bible_verses').insert(rows);
    if (error) {
      // Пропускаем дубликаты (unique constraint на book+chapter+verse+translation)
      if (!error.message.includes('duplicate')) {
        console.error('Ошибка вставки:', error.message);
        process.exit(1);
      }
    }

    inserted += batch.length;
    process.stdout.write(`\rЗагружено ${inserted}/${total} стихов...`);

    // Пауза чтобы не перегружать OpenAI rate limit
    await sleep(200);
  }

  console.log(`\n✅ Готово: ${inserted} стихов загружено`);
  console.log('Теперь создай ivfflat индекс в Supabase:');
  console.log('CREATE INDEX idx_bible_verses_embedding ON bible_verses USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

seed().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
