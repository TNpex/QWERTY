#!/usr/bin/env node
/**
 * Удаляет из public/data/product_images файлы-сироты: фотографии, на которые
 * не ссылаются ни product-images.json (map ссылка→файл), ни колонка «Фото»
 * products.csv — то есть фото товаров, давно убранных с сайта или сменивших
 * адрес/файл.
 *
 * Зачем: сироты копируются в каждый деплой и оседают в Deployment Storage
 * Vercel (на 26.09.2026 их было 3539 файлов ≈ 71 МБ из 128 МБ каталога).
 * Локальные фото ссылается только колонка «Фото» в products.csv
 * (product-images.json хранит link→удалённый URL сайта и локальные файлы
 * не упоминает), поэтому критерий один: имени файла нет в CSV.
 * Проверка значений map оставлена дополнительным предохранителем.
 */
import { readFileSync, readdirSync, statSync, rmSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const DIR = join(root, 'public/data/product_images');
const map = JSON.parse(readFileSync(join(root, 'public/data/product-images.json'), 'utf8'));
const referenced = new Set(Object.values(map));
const csv = readFileSync(join(root, 'public/data/products.csv'), 'utf8');

let removed = 0;
let bytes = 0;
for (const file of readdirSync(DIR)) {
  if (referenced.has(file) || csv.includes(file)) continue;
  const path = join(DIR, file);
  bytes += statSync(path).size;
  rmSync(path);
  removed += 1;
}
console.log(
  `clean-orphan-images: удалено файлов: ${removed}, освобождено ${(bytes / 1048576).toFixed(1)} MB`
);
