/**
 * Скачивает Синодальный перевод (RST) с getBible.net API
 * и сохраняет в bible_rst.json нужного формата.
 *
 * Запуск: npx ts-node src/scripts/downloadBible.ts
 */

import fs from 'fs';
import path from 'path';

const OUTPUT_PATH = path.resolve(process.cwd(), 'bible_rst.json');
const BASE_URL = 'https://bolls.life';
const TRANSLATION = 'SYNOD';

interface BollsBook {
  bookid: number;
  name: string;
  chapters: number;
}

interface BollsVerse {
  verse: number;
  text: string;
}

interface VerseOutput {
  book: string;
  chapter: number;
  verse: number;
  text: string;
}

async function fetchWithRetry(url: string, retries = 3): Promise<unknown> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} для ${url}`);
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(1000 * attempt);
    }
  }
}

async function download(): Promise<void> {
  if (fs.existsSync(OUTPUT_PATH)) {
    console.log(`Файл уже существует: ${OUTPUT_PATH}`);
    console.log('Удали его если хочешь скачать заново.');
    process.exit(0);
  }

  console.log('Скачиваем Синодальный перевод с bolls.life...\n');

  // Получаем список книг
  const books = await fetchWithRetry(`${BASE_URL}/get-books/${TRANSLATION}/`) as BollsBook[];
  console.log(`Найдено книг: ${books.length}\n`);

  const allVerses: VerseOutput[] = [];

  for (const book of books) {
    for (let ch = 1; ch <= book.chapters; ch++) {
      const verses = await fetchWithRetry(
        `${BASE_URL}/get-chapter/${TRANSLATION}/${book.bookid}/${ch}/`
      ) as BollsVerse[];

      for (const v of verses) {
        allVerses.push({
          book: book.name,
          chapter: ch,
          verse: v.verse,
          text: v.text.replace(/<[^>]+>/g, '').trim(), // убираем HTML-теги если есть
        });
      }

      await sleep(80);
    }

    process.stdout.write(`\r[${book.bookid}/${books.length}] ${book.name.padEnd(20)} — ${allVerses.length} стихов`);
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(allVerses, null, 2), 'utf-8');

  console.log(`\n\n✅ Готово: ${allVerses.length} стихов сохранено в bible_rst.json`);
  console.log('Теперь запусти: npm run seed');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

download().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
