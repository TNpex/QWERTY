#!/usr/bin/env node
/**
 * Слияние настроек в общий public/data/product-settings.json.
 *
 *   npm run merge-settings -- <файл.json> [<файл2.json> ...] [--out <путь>] [--dry]
 *
 * Зачем: скачанный на сайте JSON — либо ВСЕ настройки (сайдбар → «Настройки
 * товаров: N — скачать JSON»), либо профиль ОДНОГО магазина (вкладка
 * «🏬 Магазины» → «Профиль магазина (JSON)»). Класть профиль магазина вместо
 * общего файла нельзя — затрутся профили остальных точек и настройки товаров.
 * Этот скрипт вливает файл по тем же правилам, что и приложение при импорте
 * (см. mergeSettings в src/utils/settings.ts):
 *
 *  - словари товаров (ориентации, исключения, «Поставляется», ходовые) —
 *   incoming дополняет и перекрывает текущие ключи;
 *  - профиль магазина, описанный во входящем файле, ЗАМЕНЯЕТ текущий профиль
 *    этой точки целиком вместе с её индивидуальными минимумами (иначе снятый
 *    магазином запрет воскресал бы при каждом слиянии);
 *  - минимумы остальных магазинов не трогаются.
 *
 * После слияния: git add public/data/product-settings.json && git commit && git push.
 * Сайт подхватит файл автоматически при следующем открытии — на всех устройствах.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';

const DEFAULT_FILE = 'public/data/product-settings.json';

/** Разбор аргументов: --out/--base/--dry отдельно, остальное — входящие файлы */
function parseArgs(argv) {
  let out = DEFAULT_FILE;
  let base = null;
  let dry = false;
  const inputs = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry') {
      dry = true;
    } else if (arg === '--out') {
      out = argv[++i];
    } else if (arg === '--base') {
      base = argv[++i];
    } else if (arg.startsWith('--')) {
      console.error(`Неизвестная опция: ${arg}`);
      process.exit(1);
    } else {
      inputs.push(arg);
    }
  }
  return { out, base: base || out, dry, inputs };
}

const { out: OUT, base: BASE, dry: DRY, inputs } = parseArgs(process.argv.slice(2));

if (inputs.length === 0) {
  console.error(
    'Использование: npm run merge-settings -- <файл.json> [<файл2.json> …] [--base <общий файл>] [--out <путь>] [--dry]'
  );
  console.error(`По умолчанию общий файл (он же --base и --out): ${DEFAULT_FILE}`);
  process.exit(1);
}

const SPORTS = new Set(['padel', 'tennis', 'other']);

// ---- Разбор с отсечением мусора (зеркалит parseSettings из src/utils/settings.ts) ----
function pickStringRecord(raw, allowed) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'string' || !key.trim()) continue;
    if (allowed && !allowed.includes(value)) continue;
    out[key] = value;
  }
  return out;
}

function pickBoolRecord(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw)) {
    if (key.trim() && value === true) out[key] = true;
  }
  return out;
}

function pickMinimums(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [store, perProduct] of Object.entries(raw)) {
    if (!store.trim() || !perProduct || typeof perProduct !== 'object') continue;
    const entry = {};
    for (const [key, value] of Object.entries(perProduct)) {
      const num = typeof value === 'number' ? value : Number(value);
      if (key.trim() && Number.isFinite(num) && num > 0) entry[key.trim()] = Math.round(num);
    }
    if (Object.keys(entry).length > 0) out[store.trim()] = entry;
  }
  return out;
}

function normalizeProfile(raw) {
  const profile = {
    sport: 'all',
    hiddenCategories: [],
    transfersDisabled: false,
    defaultMinimum: 0,
    bannedProducts: {},
    note: '',
  };
  if (!raw || typeof raw !== 'object') return profile;
  if (typeof raw.sport === 'string' && (raw.sport === 'all' || SPORTS.has(raw.sport))) {
    profile.sport = raw.sport;
  }
  if (Array.isArray(raw.hiddenCategories)) {
    profile.hiddenCategories = [
      ...new Set(raw.hiddenCategories.filter((c) => typeof c === 'string' && c.trim()).map((c) => c.trim())),
    ];
  }
  if (raw.transfersDisabled === true) profile.transfersDisabled = true;
  const min = typeof raw.defaultMinimum === 'number' ? raw.defaultMinimum : Number(raw.defaultMinimum);
  if (Number.isFinite(min) && min > 0) profile.defaultMinimum = Math.round(min);
  if (raw.bannedProducts && typeof raw.bannedProducts === 'object') {
    for (const [key, value] of Object.entries(raw.bannedProducts)) {
      if (key.trim() && value !== false && value !== null && value !== undefined) {
        profile.bannedProducts[key.trim()] = true;
      }
    }
  }
  if (typeof raw.note === 'string') profile.note = raw.note;
  return profile;
}

function normalizeProfiles(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [store, value] of Object.entries(raw)) {
    if (store.trim() && value && typeof value === 'object') out[store.trim()] = normalizeProfile(value);
  }
  return out;
}

function parseSettings(text, fileName) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    console.error(`✗ ${fileName}: не JSON — ${e.message}`);
    process.exit(1);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    console.error(`✗ ${fileName}: ожидается объект настроек`);
    process.exit(1);
  }
  return {
    sportOverrides: pickStringRecord(raw.sportOverrides, [...SPORTS]),
    excludedProducts: pickStringRecord(raw.excludedProducts),
    suppliedProducts: pickBoolRecord(raw.suppliedProducts),
    hotProducts: pickBoolRecord(raw.hotProducts),
    storeMinimums: pickMinimums(raw.storeMinimums),
    storeProfiles: normalizeProfiles(raw.storeProfiles),
  };
}

// ---- Слияние (зеркалит mergeSettings) ----
function mergeSettings(current, incoming) {
  const storeProfiles = { ...current.storeProfiles, ...incoming.storeProfiles };
  const storeMinimums = {};
  for (const [store, mins] of Object.entries({ ...current.storeMinimums, ...incoming.storeMinimums })) {
    storeMinimums[store] = { ...(current.storeMinimums[store] || {}), ...(incoming.storeMinimums[store] || {}) };
  }
  for (const store of Object.keys(incoming.storeProfiles)) {
    const mins = { ...(incoming.storeMinimums[store] || {}) };
    if (Object.keys(mins).length > 0) storeMinimums[store] = mins;
    else delete storeMinimums[store];
  }
  return {
    sportOverrides: { ...current.sportOverrides, ...incoming.sportOverrides },
    excludedProducts: { ...current.excludedProducts, ...incoming.excludedProducts },
    suppliedProducts: { ...current.suppliedProducts, ...incoming.suppliedProducts },
    hotProducts: { ...current.hotProducts, ...incoming.hotProducts },
    storeMinimums,
    storeProfiles,
  };
}

const count = (obj) => Object.keys(obj || {}).length;

// ---- Работа ----
const targetRaw = existsSync(BASE) ? readFileSync(BASE, 'utf8') : '{}';
let result = parseSettings(targetRaw, BASE);
console.log(`Общий файл (база): ${BASE}${existsSync(BASE) ? '' : ' — не найден, начинаем с пустого'}`);
console.log(`Куда пишем:       ${OUT}${DRY ? ' (--dry: не пишем)' : ''}`);
console.log(
  `  было: ориентаций ${count(result.sportOverrides)}, исключений ${count(result.excludedProducts)}, ` +
    `«Поставляется» ${count(result.suppliedProducts)}, ходовых ${count(result.hotProducts)}, ` +
    `минимумов в ${count(result.storeMinimums)} магазинах, профилей ${count(result.storeProfiles)}`
);

for (const file of inputs) {
  if (!existsSync(file)) {
    console.error(`✗ Файл не найден: ${file}`);
    process.exit(1);
  }
  const incoming = parseSettings(readFileSync(file, 'utf8'), file);
  const stores = Object.keys(incoming.storeProfiles);
  const bans = stores.reduce((sum, s) => sum + count(incoming.storeProfiles[s].bannedProducts), 0);
  console.log(
    `  + ${file}: ориентаций ${count(incoming.sportOverrides)}, исключений ${count(incoming.excludedProducts)}, ` +
      `«Поставляется» ${count(incoming.suppliedProducts)}, ходовых ${count(incoming.hotProducts)}, ` +
      `профилей магазинов ${stores.length}${stores.length ? ` (${stores.join(', ')})` : ''}, запретов ${bans}`
  );
  result = mergeSettings(result, incoming);
}

console.log(
  `  стало: ориентаций ${count(result.sportOverrides)}, исключений ${count(result.excludedProducts)}, ` +
    `«Поставляется» ${count(result.suppliedProducts)}, ходовых ${count(result.hotProducts)}, ` +
    `минимумов в ${count(result.storeMinimums)} магазинах, профилей ${count(result.storeProfiles)}`
);

if (DRY) {
  console.log('\n--dry: файл не записан. Результат слияния:');
  console.log(JSON.stringify(result, null, 2).slice(0, 4000));
  process.exit(0);
}

writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(`\n✅ Записано: ${OUT}`);
console.log('Дальше:');
console.log('  git add public/data/product-settings.json');
console.log('  git commit -m "data: общие настройки товаров и профили магазинов"');
console.log('  git push');
console.log('После деплоя настройки подхватятся на всех устройствах автоматически.');
