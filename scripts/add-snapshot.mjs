#!/usr/bin/env node
/**
 * Добавляет новый снимок остатков в историю сайта.
 *
 * Использование:
 *   npm run snapshot -- <путь-к-файлу-или-папке-парсинга> [ГГГГ-ММ-ДД[_ЧЧ-ММ-СС]]
 *
 * Если передать ПАПКУ парсера (в ней products.csv / sizes.csv / changes.csv /
 * датированный снимок) — скрипт сам разложит все файлы.
 * Если передать файл снимка (широкий формат) — рядом ищутся sizes.csv и
 * changes.csv и тоже обновляются.
 *
 * Что делает:
 * - снимок (products-формат, .csv или .xlsx) → public/data/history/<дата-время>.<ext>
 *   + manifest.json + public/data/products.csv (актуальный каталог);
 * - sizes.csv → public/data/sizes.csv (актуальные размеры);
 * - changes.csv → public/data/changes.csv (журнал изменений парсера);
 * - дата: из аргумента, иначе из имени файла (2026-09-24_16-52-05), иначе сейчас.
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, basename, extname, dirname, resolve } from 'path';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Использование: npm run snapshot -- <файл-или-папка-парсинга> [ГГГГ-ММ-ДД[_ЧЧ-ММ-СС]]');
  process.exit(1);
}

const SOURCE = args[0];
const dateArg = args[1];
if (!existsSync(SOURCE)) {
  console.error(`Не найдено: ${SOURCE}`);
  process.exit(1);
}

const dataDir = join('public', 'data');
const historyDir = join(dataDir, 'history');
if (!existsSync(dataDir)) {
  console.error('Папка public/data не найдена — запустите скрипт из корня проекта.');
  process.exit(1);
}
mkdirSync(historyDir, { recursive: true });

// ---- Определяем файлы ----
const isDir = statSync(SOURCE).isDirectory();
let snapshotFile = null;
let sizesFile = null;
let changesFile = null;

const DATE_RE = /(\d{4}-\d{2}-\d{2}(?:[_T]\d{2}[-_:]\d{2}(?:[-_:]\d{2})?)?)/;

if (isDir) {
  const files = readdirSync(SOURCE);
  sizesFile = files.find((f) => /^sizes\.csv$/i.test(f));
  changesFile = files.find((f) => /^changes\.csv$/i.test(f));
  // Снимок: датированный файл, иначе products.csv
  const dated = files
    .filter((f) => DATE_RE.test(f) && /\.(csv|xlsx|xls)$/i.test(f))
    .sort();
  snapshotFile = dated[dated.length - 1] ?? files.find((f) => /^products\.csv$/i.test(f));
  if (snapshotFile) snapshotFile = join(SOURCE, snapshotFile);
  if (sizesFile) sizesFile = join(SOURCE, sizesFile);
  if (changesFile) changesFile = join(SOURCE, changesFile);
} else {
  snapshotFile = SOURCE;
  const dir = dirname(resolve(SOURCE));
  const siblings = readdirSync(dir);
  const sizesSib = siblings.find((f) => /^sizes\.csv$/i.test(f));
  const changesSib = siblings.find((f) => /^changes\.csv$/i.test(f));
  if (sizesSib) sizesFile = join(dir, sizesSib);
  if (changesSib) changesFile = join(dir, changesSib);
}

if (!snapshotFile) {
  console.error('Не удалось найти файл снимка (products.csv или датированный CSV/XLSX).');
  process.exit(1);
}

// ---- Дата снимка ----
let dateStamp = dateArg;
if (!dateStamp) {
  const match = basename(snapshotFile).match(DATE_RE);
  dateStamp = match ? match[1] : new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
}
// ISO для manifest: 2026-09-24_16-52-05 → 2026-09-24T16:52:05; 2026-09-24 → 2026-09-24
let isoDate = dateStamp;
const isoMatch = dateStamp.match(/^(\d{4}-\d{2}-\d{2})(?:[_T](\d{2})[-_:](\d{2})(?:[-_:](\d{2}))?)?/);
if (isoMatch) {
  isoDate = isoMatch[2]
    ? `${isoMatch[1]}T${isoMatch[2]}:${isoMatch[3]}:${isoMatch[4] ?? '00'}`
    : isoMatch[1];
}

const ext = extname(snapshotFile).toLowerCase() || '.csv';
const destName = `${dateStamp}${ext}`;

// ---- Копирование ----
copyFileSync(snapshotFile, join(historyDir, destName));
copyFileSync(snapshotFile, join(dataDir, 'products.csv'));
console.log(`✅ Снимок: history/${destName}`);
console.log('✅ products.csv обновлён');

if (sizesFile) {
  copyFileSync(sizesFile, join(dataDir, 'sizes.csv'));
  console.log(`✅ sizes.csv обновлён из «${basename(sizesFile)}»`);
}
if (changesFile) {
  copyFileSync(changesFile, join(dataDir, 'changes.csv'));
  console.log(`✅ changes.csv (журнал парсера) обновлён`);
}

// ---- manifest.json ----
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
manifest.snapshots = manifest.snapshots.filter((s) => s && s.file !== destName && s.date !== isoDate);
manifest.snapshots.push({ file: destName, date: isoDate });
manifest.snapshots.sort((a, b) => a.date.localeCompare(b.date));
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log(`📈 Снимков в истории: ${manifest.snapshots.length}`);
console.log('');
console.log('Зафиксируйте данные в git:');
console.log('  git add public/data && git commit -m "data: снимок ' + dateStamp + '" && git push');
