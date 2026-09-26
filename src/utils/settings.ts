import type { Sport } from './sport';
import { productSettingsKey } from './sport';
import type { Product } from '../types';

/**
 * Ручные настройки товаров — «как можно проще»: всё хранится в браузере
 * (localStorage) и переживает перезагрузки. Для переноса между компьютерами
 * и фиксации «для всех» есть экспорт/импорт JSON (сайдбар): админ скачивает
 * файл, передаёт коллегам (или коммитит в public/data/, чтобы настройки
 * стали общими для сайта — см. bundledSettings).
 *
 * Состав:
 * - sportOverrides: ручная ориентация товара (Падел/Теннис/Прочее);
 * - excludedProducts: товары-услуги и исключённые вручную — НЕ участвуют
 *   в рекомендациях «Перемещения» и «Дозакупка» (выбор запоминается);
 * - storeMinimums / storeProfiles: правила по магазинам (минимумы товаров,
 *   профили точек: вид спорта, скрытые категории, перемещения, 🚫 запреты).
 */

import {
  normalizeStoreProfiles,
  profileOf,
  type StoreProfile,
} from './storeRules';

const STORAGE_KEY = 'saletennis-product-settings';

export interface ProductSettings {
  /** ключ товара (productSettingsKey) → ориентация */
  sportOverrides: Record<string, Sport>;
  /** ключ товара → причина исключения ('услуга' | 'вручную') */
  excludedProducts: Record<string, string>;
  /** ключ товара → true: товар ПОСТАВЛЯЕТСЯ (только они видны в «Дозакупке») */
  suppliedProducts: Record<string, boolean>;
  /** ключ товара → true: вручную отмечен как ходовой (🔥 + приоритет в перемещениях) */
  hotProducts: Record<string, boolean>;
  /**
   * Минимальные остатки по магазинам: название магазина → ключ товара → N шт.
   * Позиции с нехваткой до минимума поднимаются в перемещениях первыми,
   * помечаются ⭐ и заполняются до минимума (а не до 2 шт.).
   */
  storeMinimums: Record<string, Record<string, number>>;
  /**
   * Профили магазинов: название магазина → правила точки (вид спорта,
   * скрытые категории, перемещения выключены, минимум по умолчанию,
   * 🚫 индивидуальные запреты товаров, заметка). См. utils/storeRules.ts.
   */
  storeProfiles: Record<string, StoreProfile>;
}

export const EMPTY_SETTINGS: ProductSettings = {
  sportOverrides: {},
  excludedProducts: {},
  suppliedProducts: {},
  hotProducts: {},
  storeMinimums: {},
  storeProfiles: {},
};

/** Достаёт значение из произвольного объекта по списку ключей (валидация импорта) */
function pickRecord(raw: unknown, allowed?: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return result;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string' || !key.trim()) continue;
    if (allowed && !allowed.includes(value)) continue;
    result[key] = value;
  }
  return result;
}

/** То же, но для булевых флагов (Поставляется / Ходовой) */
function pickBoolRecord(raw: unknown): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  if (!raw || typeof raw !== 'object') return result;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key.trim()) continue;
    if (value === true) result[key] = true;
  }
  return result;
}

/** Валидация вложенных минимумов: магазин → товар → положительное число */
function pickMinimums(raw: unknown): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};
  if (!raw || typeof raw !== 'object') return result;
  for (const [store, perProduct] of Object.entries(raw as Record<string, unknown>)) {
    if (!store.trim() || !perProduct || typeof perProduct !== 'object') continue;
    const entry: Record<string, number> = {};
    for (const [key, value] of Object.entries(perProduct as Record<string, unknown>)) {
      const num = typeof value === 'number' ? value : Number(value);
      if (key.trim() && Number.isFinite(num) && num > 0) entry[key.trim()] = Math.round(num);
    }
    if (Object.keys(entry).length > 0) result[store.trim()] = entry;
  }
  return result;
}

/** Глубокое слияние минимумов: по магазину и по товару */
function mergeMinimums(
  a: Record<string, Record<string, number>>,
  b: Record<string, Record<string, number>>
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = { ...a };
  for (const [store, mins] of Object.entries(b)) {
    out[store] = { ...(out[store] ?? {}), ...mins };
  }
  return out;
}

/** Безопасный разбор JSON настроек (из файла или localStorage) */
export function parseSettings(json: string): ProductSettings | null {
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return {
      sportOverrides: pickRecord(raw.sportOverrides, ['padel', 'tennis', 'other']) as Record<
        string,
        Sport
      >,
      excludedProducts: pickRecord(raw.excludedProducts),
      suppliedProducts: pickBoolRecord(raw.suppliedProducts),
      hotProducts: pickBoolRecord(raw.hotProducts),
      storeMinimums: pickMinimums(raw.storeMinimums),
      storeProfiles: normalizeStoreProfiles(raw.storeProfiles),
    };
  } catch {
    return null;
  }
}

export function loadSettings(): ProductSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_SETTINGS;
    return parseSettings(raw) ?? EMPTY_SETTINGS;
  } catch {
    return EMPTY_SETTINGS;
  }
}

export function saveSettings(settings: ProductSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* приватный режим — не критично */
  }
}

/**
 * Объединяет входящие настройки с текущими (импорт файла).
 *
 * Профили магазинов — «файл точки важнее»: магазин, описанный во входящем
 * файле, заменяет текущий профиль ЦЕЛИКОМ, вместе со своими индивидуальными
 * минимумами товаров (иначе снятый магазином запрет/минимум воскресал бы
 * при каждом импорте). Остальные магазины не трогаются.
 */
export function mergeSettings(
  current: ProductSettings,
  incoming: ProductSettings
): ProductSettings {
  const storeProfiles: Record<string, StoreProfile> = {
    ...current.storeProfiles,
    ...incoming.storeProfiles,
  };
  const storeMinimums = mergeMinimums(current.storeMinimums, incoming.storeMinimums);
  for (const storeName of Object.keys(incoming.storeProfiles)) {
    storeMinimums[storeName] = { ...(incoming.storeMinimums[storeName] ?? {}) };
    if (Object.keys(storeMinimums[storeName]).length === 0) delete storeMinimums[storeName];
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

export function settingsToJson(settings: ProductSettings): string {
  return JSON.stringify(settings, null, 2);
}

/** Скачивание настроек файлом product-settings.json */
export function downloadSettings(settings: ProductSettings): void {
  const blob = new Blob([settingsToJson(settings)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'product-settings.json';
  link.click();
  URL.revokeObjectURL(url);
}

/** Сводка для сайдбара: сколько ручных настроек задано */
export function settingsCounts(settings: ProductSettings): {
  sports: number;
  excluded: number;
  supplied: number;
  hot: number;
  minimums: number;
  /** Магазины с непустым профилем */
  profiles: number;
  /** Индивидуальные запреты товаров (суммарно по магазинам) */
  bans: number;
} {
  let minimums = 0;
  for (const perStore of Object.values(settings.storeMinimums)) {
    minimums += Object.keys(perStore).length;
  }
  let profiles = 0;
  let bans = 0;
  for (const [storeName, profile] of Object.entries(settings.storeProfiles)) {
    bans += Object.keys(profile?.bannedProducts ?? {}).length;
    if (
      profile &&
      (profile.sport !== 'all' ||
        (profile.hiddenCategories?.length ?? 0) > 0 ||
        profile.transfersDisabled ||
        profile.defaultMinimum > 0 ||
        Object.keys(profile.bannedProducts ?? {}).length > 0 ||
        Boolean(profile.note?.trim()))
    ) {
      profiles++;
    } else if (Object.keys(settings.storeMinimums[storeName] ?? {}).length > 0) {
      profiles++;
    }
  }
  return {
    sports: Object.keys(settings.sportOverrides).length,
    excluded: Object.keys(settings.excludedProducts).length,
    supplied: Object.keys(settings.suppliedProducts).length,
    hot: Object.keys(settings.hotProducts).length,
    minimums,
    profiles,
    bans,
  };
}

/** Есть ли в настройках хоть одно правило по магазинам (для подписей в UI) */
export function hasStoreRules(settings: ProductSettings): boolean {
  return (
    Object.keys(settings.storeMinimums).length > 0 ||
    Object.keys(settings.storeProfiles).some((store) => !isEmptyProfile(profileOf(settings, store)))
  );
}

function isEmptyProfile(profile: StoreProfile): boolean {
  return (
    profile.sport === 'all' &&
    profile.hiddenCategories.length === 0 &&
    !profile.transfersDisabled &&
    profile.defaultMinimum <= 0 &&
    Object.keys(profile.bannedProducts).length === 0 &&
    !profile.note.trim()
  );
}

/**
 * Миграция старых ключей настроек на новые (unique-per-product).
 *
 * Раньше ключом был артикул, но он не уникален: правки «склеивались» между
 * разными товарами с одним артикулом. Новый ключ — нормализованная ссылка
 * (см. productSettingsKey). Функция переносит сохранённые значения со старых
 * артикульных ключей на новые ключи всех товаров с тем артикулом (поведение
 * «как было» однократно, дальше настройки становятся индивидуальными).
 * Если переносить нечего — возвращает тот же объект (без перерисовок).
 */
export function migrateSettingsKeys<T extends ProductSettings>(
  settings: T,
  products: Pick<Product, 'article' | 'link' | 'name'>[]
): T {
  const newKeys = new Set(products.map(productSettingsKey));
  const byOldKey = new Map<string, string[]>();
  for (const product of products) {
    const article = (product.article ?? '').trim().toLowerCase();
    if (!article) continue;
    const newKey = productSettingsKey(product);
    const list = byOldKey.get(article) ?? [];
    if (!list.includes(newKey)) list.push(newKey);
    byOldKey.set(article, list);
  }

  const remap = (key: string): string[] => {
    if (newKeys.has(key)) return [key];
    const legacy = byOldKey.get(key.trim().toLowerCase());
    return legacy && legacy.length > 0 ? legacy : [key];
  };

  const remapRecord = <V>(record: Record<string, V>): { next: Record<string, V>; changed: boolean } => {
    const next: Record<string, V> = {};
    let changed = false;
    for (const [key, value] of Object.entries(record)) {
      const targets = remap(key);
      if (targets.length !== 1 || targets[0] !== key) changed = true;
      for (const target of targets) {
        if (!(target in next)) next[target] = value;
      }
    }
    return { next, changed };
  };

  let changed = false;
  const sport = remapRecord(settings.sportOverrides);
  const excluded = remapRecord(settings.excludedProducts);
  const supplied = remapRecord(settings.suppliedProducts);
  const hot = remapRecord(settings.hotProducts);
  changed ||= sport.changed || excluded.changed || supplied.changed || hot.changed;

  const storeMinimums: Record<string, Record<string, number>> = {};
  for (const [store, record] of Object.entries(settings.storeMinimums)) {
    const r = remapRecord(record);
    changed ||= r.changed;
    storeMinimums[store] = r.next;
  }
  const storeProfiles: Record<string, StoreProfile> = {};
  for (const [store, profile] of Object.entries(settings.storeProfiles)) {
    const banned = remapRecord(profile.bannedProducts);
    changed ||= banned.changed;
    storeProfiles[store] = banned.changed ? { ...profile, bannedProducts: banned.next } : profile;
  }

  if (!changed) return settings;
  return {
    ...settings,
    sportOverrides: sport.next,
    excludedProducts: excluded.next,
    suppliedProducts: supplied.next,
    hotProducts: hot.next,
    storeMinimums,
    storeProfiles,
  };
}
