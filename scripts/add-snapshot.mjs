#!/usr/bin/env node
/**
 * Добавляет новый снимок остатков в историю сайта.
 *
 * Использование:
 *   npm run snapshot -- <путь-к-файлу-парсинга.csv> [ГГГГ-ММ-ДД]
 *
 * Поведение:
 * - широкий формат (колонки магазинов, как products.csv):
 *     копия → public/data/history/<дата>.csv, обновляется manifest.json
 *     и public/data/products.csv (актуальный каталог);
 * - длинный формат (колонки «Магазин»+«Количество», как sizes.csv):
 *     обновляется только public/data/sizes.csv (актуальные размеры).
 *
 * Дата берётся из аргумента, иначе из имени файла (2026-09-24.csv), иначе — сегодня.
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'fs';
import { join, basename } from 'path';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Использование: npm run snapshot -- <путь-к-csv> [ГГГГ-ММ-ДД]');
  process.exit(1);
}

const [source, dateArg] = args;
if (!existsSync(source)) {
  console.error(`Файл не найден: ${source}`);
  process.exit(1);
}

let date = dateArg;
if (!date) {
  const match = basename(source).match(/(\d{4}-\d{2}-\d{2})/);
  date = match ? match[1] : new Date().toISOString().slice(0, 10);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`Некорректная дата: ${date} (ожидается формат ГГГГ-ММ-ДД)`);
  process.exit(1);
}

const dataDir = join('public', 'data');
const historyDir = join(dataDir, 'history');
if (!existsSync(dataDir)) {
  console.error('Папка public/data не найдена — запустите скрипт из корня проекта.');
  process.exit(1);
}
mkdirSync(historyDir, { recursive: true });

// Определяем тип файла по заголовку
const text = readFileSync(source, 'utf8').replace(/^\uFEFF/, '');
const header = (text.split(/\r?\n/, 1)[0] ?? '').toLowerCase();
const isLongFormat =
  (header.includes('магазин') || header.includes('store')) &&
  (header.includes('количество') || header.includes('остаток') || header.includes('quantity'));

const manifestPath = join(historyDir, 'manifest.json');
let manifest = { snapshots: [] };
if (existsSync(manifestPath)) {
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    console.warn('⚠️ manifest.json повреждён — создаю заново');
    manifest = { snapshots: [] };
  }
}
if (!Array.isArray(manifest.snapshots)) manifest.snapshots = [];

if (isLongFormat) {
  copyFileSync(source, join(dataDir, 'sizes.csv'));
  console.log(`✅ sizes.csv обновлён из «${basename(source)}» (длинный формат)`);
} else {
  const destName = `${date}.csv`;
  copyFileSync(source, join(historyDir, destName));
  copyFileSync(source, join(dataDir, 'products.csv'));
  manifest.snapshots = manifest.snapshots.filter((s) => s && s.date !== date);
  manifest.snapshots.push({ file: destName, date });
  manifest.snapshots.sort((a, b) => a.date.localeCompare(b.date));
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`✅ Снимок добавлен: history/${destName} (всего снимков: ${manifest.snapshots.length})`);
  console.log('✅ products.csv обновлён до актуального состояния');
  if (manifest.snapshots.length >= 2) {
    console.log('📈 Снимков ≥ 2 — на вкладке «Продажи» появится анализ движения товаров');
  } else {
    console.log('💡 Добавьте следующий снимок завтра — и появится анализ продаж');
  }
}

console.log('');
console.log(`Не забудьте зафиксировать данные в git:`);
console.log(`  git add public/data && git commit -m "data: снимок остатков ${date}"`);
