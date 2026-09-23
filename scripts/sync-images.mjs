#!/usr/bin/env node
/**
 * Копирует фотографии товаров из папки вашего парсера (Product_images)
 * в public/data/product_images/ — сайт раздаёт их локально (быстро, без
 * зависимости от saletennis.com).
 *
 * Использование (из корня проекта):
 *   npm run images -- C:\путь\к\Product_images
 *
 * Что делает:
 * 1. копирует *.png / *.jpg / *.jpeg / *.webp (пропуская уже скопированные
 *    файлы того же размера — повторный запуск почти мгновенный);
 * 2. сверяет с колонкой «Фото» в public/data/products.csv и печатает
 *    покрытие: у скольких товаров каталога есть локальное фото;
 * 3. сообщает общий вес папки (важно для git: >100 МБ — см. README).
 *
 * Двойная работа исключается: сайт берёт фото из колонки «Фото» products.csv,
 * поэтому скрейпер (scrape-images.mjs) нужен только как резерв для товаров
 * без локального файла.
 */
import { readdirSync, statSync, copyFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join, extname } from 'path';

const SOURCE = process.argv[2];
if (!SOURCE) {
  console.error('Использование: npm run images -- <путь к папке Product_images>');
  process.exit(1);
}
if (!existsSync(SOURCE)) {
  console.error(`Папка не найдена: ${SOURCE}`);
  process.exit(1);
}

const DEST = join('public', 'data', 'product_images');
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);

mkdirSync(DEST, { recursive: true });

const files = readdirSync(SOURCE).filter((f) =>
  IMAGE_EXTENSIONS.has(extname(f).toLowerCase())
);
console.log(`В папке парсера: ${files.length} изображений`);

let copied = 0;
let skipped = 0;
let totalBytes = 0;

for (const file of files) {
  const srcPath = join(SOURCE, file);
  const destPath = join(DEST, file);
  const size = statSync(srcPath).size;
  totalBytes += size;

  if (existsSync(destPath) && statSync(destPath).size === size) {
    skipped++;
    continue;
  }
  copyFileSync(srcPath, destPath);
  copied++;
}

console.log(`Скопировано: ${copied}, уже на месте: ${skipped}`);
console.log(`Объём папки: ${(totalBytes / 1024 / 1024).toFixed(1)} МБ`);
if (totalBytes > 100 * 1024 * 1024) {
  console.warn(
    '⚠️ Больше 100 МБ — git push будет долгим, а GitHub может отклонить push.\n' +
      '   Варианты: сжать изображения (например, XnConvert: 600px, WebP q80),\n' +
      '   либо хранить фото вне git (см. README, раздел «Фотографии товаров»).'
  );
}

// Сверка покрытия с каталогом
const csvPath = join('public', 'data', 'products.csv');
if (existsSync(csvPath)) {
  const csv = readFileSync(csvPath, 'utf8');
  const referenced = new Set(
    [...csv.matchAll(/data\\+product_images\\+([^,"\r\n]+\.(?:png|jpe?g|webp))/gi)].map((m) => m[1])
  );
  const available = new Set(readdirSync(DEST));
  let covered = 0;
  const missing = [];
  for (const name of referenced) {
    if (available.has(name)) covered++;
    else if (missing.length < 10) missing.push(name);
  }
  console.log('');
  console.log(`Каталог ссылается на ${referenced.size} фото; локально доступно: ${covered}`);
  if (missing.length > 0) {
    console.log(`Отсутствуют (примеры): ${missing.join(', ')}`);
    console.log('Для них сайт автоматически использует фото с saletennis.com (резерв).');
  }
}

console.log('');
console.log('Не забудьте закоммитить изображения:');
console.log('  git add public/data/product_images && git commit -m "data: фото товаров"');
