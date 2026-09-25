#!/usr/bin/env node
/**
 * Генератор тёмной темы: src/styles/dark.css
 *
 *   npm run build-dark
 *
 * Зачем: интерфейс собран на утилитах Tailwind с жёсткими цветами (bg-white,
 * text-gray-800, bg-red-50 …) — их сотни в десятках компонентов. Добавлять
 * везде вариант `dark:` нереально поддерживать, поэтому тема делается слоем
 * переопределений: скрипт находит ВСЕ цветовые утилиты, реально используемые
 * в src/**, и строит для них тёмные эквиваленты по правилам ниже.
 *
 * Правила пересчёта (HSL исходного цвета):
 *  - фоны 50/100/200 → тёмные оттенки того же тона (L 13/18/24%),
 *    насыщенные фоны 500–700 остаются акцентами (чуть темнее);
 *  - текст 600/700/800 → светлые оттенки (L 68/74/82%), чтобы читался на тёмном;
 *  - границы 100/200/300 → тёмные (L 23/30/38%);
 *  - полупрозрачные наложения (bg-white/10, bg-black/50) не трогаем — они
 *    уже корректно выглядят на тёмном.
 *
 * После добавления новых цветовых классов в компоненты — перезапустите скрипт.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'fs';
import { join, extname, dirname } from 'path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const OUT = join(SRC, 'styles', 'dark.css');

const HUES = {
  red: [0, 72], orange: [25, 95], amber: [38, 92], yellow: [48, 96],
  lime: [83, 78], green: [142, 71], emerald: [160, 84], teal: [173, 80],
  cyan: [189, 94], sky: [199, 89], blue: [217, 91], indigo: [239, 84],
  violet: [258, 90], purple: [271, 91], fuchsia: [292, 84], pink: [330, 81],
  rose: [350, 89], gray: [220, 9], slate: [215, 16], zinc: [240, 4],
  neutral: [0, 0], stone: [20, 5],
};

const COLOR_LIST = Object.keys(HUES).join('|');
const PATTERN = new RegExp(
  `\\b(bg|text|border|divide|ring|from|via|to|fill|stroke|decoration|outline|accent|caret)-(${COLOR_LIST}|white|black)(-\\d{2,3})?(?:/(\\d{1,3}))?\\b`,
  'g'
);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) yield* walk(full);
    else if (['.ts', '.tsx'].includes(extname(entry))) yield full;
  }
}

const hsl = (h, s, l, alpha) =>
  alpha ? `hsl(${h} ${Math.round(s)}% ${Math.round(l)}% / ${alpha})` : `hsl(${h} ${Math.round(s)}% ${Math.round(l)}%)`;

/** Минимальная насыщенность в тёмной теме — иначе пастельные тона выглядят грязно */
const sat = (s, min) => Math.max(s, min);

function darkValue(prefix, color, shade, alpha) {
  const a = alpha ? Number(alpha) / 100 : null;

  // Полупрозрачные наложения белого/чёрного не трогаем
  if (color === 'white' || color === 'black') {
    if (a !== null) return null;
    if (color === 'black') return null;
    // bg-white / text-white / to-white / via-white
    if (prefix === 'text') return null; // белый текст остаётся белым
    if (prefix === 'bg') return '#151b25';
    return '#151b25'; // градиенты from/to/via-white
  }

  const [h, sRaw] = HUES[color];
  const shadeNum = Number(shade ? shade.slice(1) : 500);
  // серый в тёмной теме чуть холоднее и насыщеннее, чтобы не выглядел грязным
  const s = color === 'gray' || color === 'zinc' || color === 'neutral' ? Math.max(sRaw, 18) : sRaw;

  if (prefix === 'bg' || prefix === 'from' || prefix === 'via' || prefix === 'to' || prefix === 'fill') {
    switch (true) {
      case shadeNum <= 50: return hsl(h, sat(s, 26), 13, a);
      case shadeNum <= 100: return hsl(h, sat(s, 24), 18, a);
      case shadeNum <= 200: return hsl(h, sat(s, 22), 24, a);
      case shadeNum <= 300: return hsl(h, sat(s, 20), 32, a);
      case shadeNum <= 400: return hsl(h, s, 46, a);
      case shadeNum <= 500: return hsl(h, s, 44, a);
      case shadeNum <= 600: return hsl(h, s, 39, a);
      case shadeNum <= 700: return hsl(h, s, 33, a);
      case shadeNum <= 800: return hsl(h, sat(s, 25), 22, a);
      default: return hsl(h, sat(s, 25), 13, a);
    }
  }

  if (prefix === 'text' || prefix === 'caret' || prefix === 'accent' || prefix === 'stroke') {
    switch (true) {
      case shadeNum <= 300: return hsl(h, Math.min(s, 14), 46, a);
      case shadeNum <= 400: return hsl(h, Math.min(s, 20), 58, a);
      case shadeNum <= 500: return hsl(h, Math.min(s, 62), 63, a);
      case shadeNum <= 600: return hsl(h, Math.min(s, 72), 69, a);
      case shadeNum <= 700: return hsl(h, Math.min(s, 78), 75, a);
      case shadeNum <= 800: return hsl(h, Math.min(s, 70), 83, a);
      default: return hsl(h, Math.min(s, 60), 89, a);
    }
  }

  // border / divide / ring / outline / decoration
  switch (true) {
    case shadeNum <= 50: return hsl(h, sat(s, 20), 18, a);
    case shadeNum <= 100: return hsl(h, sat(s, 20), 23, a);
    case shadeNum <= 200: return hsl(h, sat(s, 22), 30, a);
    case shadeNum <= 300: return hsl(h, sat(s, 26), 38, a);
    case shadeNum <= 400: return hsl(h, sat(s, 35), 47, a);
    case shadeNum <= 500: return hsl(h, s, 45, a);
    case shadeNum <= 600: return hsl(h, s, 40, a);
    default: return hsl(h, s, 33, a);
  }
}

const PROP = {
  bg: 'background-color',
  from: '--tw-gradient-from',
  via: '--tw-gradient-via',
  to: '--tw-gradient-to',
  text: 'color',
  caret: 'caret-color',
  accent: 'accent-color',
  border: 'border-color',
  divide: 'border-color',
  ring: '--tw-ring-color',
  outline: 'outline-color',
  decoration: 'text-decoration-color',
  fill: 'fill',
  stroke: 'stroke',
};

// ---- сбор используемых классов ----
const found = new Map(); // className → {prefix, color, shade, alpha}
for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(PATTERN)) {
    const [full, prefix, color, shade, alpha] = m;
    if (!found.has(full)) found.set(full, { prefix, color, shade, alpha });
  }
}

// ---- генерация CSS ----
const lines = [];
lines.push('/*');
lines.push(' * Тёмная тема — СГЕНЕРИРОВАНО АВТОМАТИЧЕСКИ, руками не править.');
lines.push(' * Команда: npm run build-dark  (scripts/build-dark-css.mjs)');
lines.push(' *');
lines.push(' * Слой переопределений цветовых утилит Tailwind для `.dark` на <html>.');
lines.push(` * Классов в проекте: ${found.size}. Пересчёт — по HSL-правилам из шапки скрипта.`);
lines.push(' */');
lines.push('');
lines.push('html.dark {');
lines.push('  color-scheme: dark;');
lines.push('  background-color: #0f141c;');
lines.push('}');
lines.push('');
lines.push('html.dark body {');
lines.push('  background-color: #0f141c;');
lines.push('  color: #e5e9f0;');
lines.push('}');
lines.push('');
lines.push('/* Скроллбары */');
lines.push('html.dark ::-webkit-scrollbar-track { background: #151b25; }');
lines.push('html.dark ::-webkit-scrollbar-thumb { background: #334054; }');
lines.push('html.dark ::-webkit-scrollbar-thumb:hover { background: #46586f; }');
lines.push('');

const sorted = [...found.entries()].sort((a, b) => a[0].localeCompare(b[0]));
let skipped = 0;
for (const [className, { prefix, color, shade, alpha }] of sorted) {
  const value = darkValue(prefix, color, shade, alpha);
  if (!value) {
    skipped++;
    continue;
  }
  const prop = PROP[prefix];
  if (!prop) continue;
  const selector = `.${className.replace(/([/.[\]:])/g, '\\$1')}`;
  if (prefix === 'divide') {
    // divide-* применяется к дочерним элементам
    lines.push(`html.dark ${selector} > :not([hidden]) ~ :not([hidden]) { ${prop}: ${value}; }`);
  } else if (prefix === 'ring') {
    lines.push(`html.dark ${selector} { --tw-ring-color: ${value}; }`);
  } else if (prefix === 'from' || prefix === 'via' || prefix === 'to') {
    lines.push(`html.dark ${selector} { ${prop}: ${value}; }`);
  } else {
    lines.push(`html.dark ${selector} { ${prop}: ${value}; }`);
  }
}

lines.push('');
lines.push('/* Инверсия изображений товаров: на тёмном фоне белая подложка фото режет глаз */');
lines.push('html.dark img { background-color: #f3f4f6; border-radius: 8px; }');
lines.push('');
lines.push('/* Плотные тени на тёмном не видны — усиливаем контуры */');
lines.push('html.dark .shadow-sm, html.dark .shadow-md, html.dark .shadow-lg, html.dark .shadow-2xl {');
lines.push('  box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.5);');
lines.push('}');

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8');

console.log(`✅ ${OUT}`);
console.log(`   цветовых классов найдено: ${found.size}, переопределено: ${found.size - skipped}, пропущено: ${skipped}`);
console.log('   (пропущены полупрозрачные наложения white/black и белый текст — они не меняются)');
if (!existsSync(join(SRC, 'index.css'))) {
  console.warn('⚠ src/index.css не найден — подключите dark.css вручную');
} else {
  const css = readFileSync(join(SRC, 'index.css'), 'utf8');
  if (!css.includes('styles/dark.css')) {
    console.warn('⚠ Не забудьте подключить в src/index.css: @import "./styles/dark.css";');
  }
}
