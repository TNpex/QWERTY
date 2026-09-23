#!/usr/bin/env node
/**
 * Записывает ручные правки брендов (экспорт из карточки товара на сайте,
 * файл brand-edits.json) обратно в CSV-данные:
 *
 *   npm run apply-edits -- brand-edits.json
 *
 * Формат JSON: { "артикул": "бренд", ... }
 * Правятся колонка «Бренд» во всех строках с этим артикулом:
 *   public/data/products.csv и public/data/sizes.csv.
 *
 * CSV переписывается бережно: формат полей и кавычки сохраняются,
 * типизация не выполняется (всё остаётся строками, как было).
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const editsPath = process.argv[2];
if (!editsPath || !existsSync(editsPath)) {
  console.error('Использование: npm run apply-edits -- <brand-edits.json>');
  console.error('Файл правок можно скачать на сайте: сайдбар → «Правки брендов».');
  process.exit(1);
}

const edits = JSON.parse(readFileSync(editsPath, 'utf8'));
const editKeys = new Map(Object.entries(edits).map(([k, v]) => [k.trim().toLowerCase(), v]));
if (editKeys.size === 0) {
  console.log('Правок нет — делать нечего.');
  process.exit(0);
}
console.log(`Правок брендов: ${editKeys.size}`);

// ---- Мини-парсер CSV строки с кавычками (RFC 4180) ----
function splitCsvLine(line, delim) {
  const out = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delim) { out.push(field); field = ''; }
    else field += ch;
  }
  out.push(field);
  return out;
}

function quoteIfNeeded(value, delim) {
  return /[",\r\n]/.test(value) || value.includes(delim)
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

function sniffDelimiter(headerLine) {
  for (const d of [';', '\t', '|', ',']) {
    if (headerLine.includes(d)) return d;
  }
  return ',';
}

function patchFile(path) {
  if (!existsSync(path)) return;
  const raw = readFileSync(path, 'utf8');
  const hasBom = raw.charCodeAt(0) === 0xfeff;
  const text = hasBom ? raw.slice(1) : raw;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return;

  const delim = sniffDelimiter(lines[0]);
  const headers = splitCsvLine(lines[0], delim);
  const brandIdx = headers.findIndex((h) => h.trim().toLowerCase() === 'бренд');
  const artIdx = headers.findIndex((h) => h.trim().toLowerCase() === 'артикул');
  if (brandIdx === -1 || artIdx === -1) {
    console.warn(`⚠️ ${path}: нет колонок «Бренд»/«Артикул» — пропущен`);
    return;
  }

  let patched = 0;
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const fields = splitCsvLine(lines[i], delim);
    const article = (fields[artIdx] ?? '').trim().toLowerCase();
    const newBrand = editKeys.get(article);
    if (newBrand !== undefined && fields[brandIdx] !== newBrand) {
      fields[brandIdx] = newBrand;
      lines[i] = fields.map((f) => quoteIfNeeded(f, delim)).join(delim);
      patched++;
    }
  }

  writeFileSync(path, (hasBom ? '\uFEFF' : '') + lines.join(eol), 'utf8');
  console.log(`✅ ${path}: обновлено строк: ${patched}`);
}

patchFile(join('public', 'data', 'products.csv'));
patchFile(join('public', 'data', 'sizes.csv'));

console.log('');
console.log('Зафиксируйте правки в git:');
console.log('  git add public/data && git commit -m "data: ручные правки брендов" && git push');
