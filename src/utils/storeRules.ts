import type { Product } from '../types';
import { productSettingsKey, sportOf, SPORT_LABELS, type Sport } from './sport';

/**
 * Профили магазинов и индивидуальные правила «товар × магазин».
 *
 * Три уровня правил (сильное перекрывает слабое):
 * 1. 🚫 ЗАПРЕТ товара в магазине — самый сильный: товар не предлагается точке
 *    в перемещениях и не участвует в её нормативе дозакупки. Снимается одной кнопкой.
 * 2. ⛔ АССОРТИМЕНТ точки — вид спорта (например, «только падел») и скрытые
 *    категории (Струны, Оборудование…). Товары вне ассортимента не попадают
 *    в перемещения этой точки и в её норматив.
 * 3. 📴 ПЕРЕМЕЩЕНИЯ магазина — выключены совсем (точка не участвует ни как
 *    получатель, ни как донор) + минимум на позицию по умолчанию.
 *
 * ⭐ Индивидуальный минимум товара (settings.storeMinimums) ПЕРЕКРЫВАЕТ
 * минимум по умолчанию из профиля магазина.
 *
 * Всё хранится в ProductSettings (localStorage + общий product-settings.json),
 * поэтому профиль магазина можно выгрузить отдельным файлом того же формата —
 * заготовка под «личный кабинет» точки.
 */

/** Что продаёт точка: 'all' — и теннис, и падел; иначе — конкретный вид спорта */
export type StoreSport = 'all' | Sport;

export const STORE_SPORT_LABELS: Record<StoreSport, string> = {
  all: '🌐 Теннис и падел',
  tennis: `🎾 Только ${SPORT_LABELS.tennis.toLowerCase()}`,
  padel: `🏓 Только ${SPORT_LABELS.padel.toLowerCase()}`,
  other: `🎽 ${SPORT_LABELS.other}`,
};

export interface StoreProfile {
  /** Вид спорта точки: товары чужого спорта не попадают в её перемещения */
  sport: StoreSport;
  /** Категории, которые точка не продаёт (скрыты в перемещениях и нормативе) */
  hiddenCategories: string[];
  /** Перемещения выключены совсем (точка не участвует ни как донор, ни как получатель) */
  transfersDisabled: boolean;
  /** Минимум на позицию по умолчанию (индивидуальный минимум товара его перекрывает) */
  defaultMinimum: number;
  /** Индивидуальные запреты: ключ товара (productSettingsKey) → true */
  bannedProducts: Record<string, true>;
  /**
   * Исключения из скрытых категорий: категория → подтипы, которые точка
   * ПРОДАЁТ, даже когда категория скрыта целиком («все аксессуары, кроме
   * носков»: hiddenCategories=['Аксессуары'], categoryExceptions={'Аксессуары':['Носки']}).
   */
  categoryExceptions: Record<string, string[]>;
  /** Заметка о магазине (видна только в профиле) */
  note: string;
}

export const EMPTY_STORE_PROFILE: StoreProfile = {
  sport: 'all',
  hiddenCategories: [],
  transfersDisabled: false,
  defaultMinimum: 0,
  bannedProducts: {},
  categoryExceptions: {},
  note: '',
};

/** Минимально необходимый набор настроек (ProductSettings подходит структурно) */
export interface StoreRulesSource {
  storeProfiles: Record<string, StoreProfile>;
  storeMinimums: Record<string, Record<string, number>>;
}

/** Профиль + ориентация товаров (нужно для правила «магазин не продаёт теннис») */
export interface StoreAssortmentSource extends StoreRulesSource {
  sportOverrides: Record<string, Sport>;
}

const VALID_SPORTS: StoreSport[] = ['all', 'tennis', 'padel', 'other'];

/** Валидация профиля из JSON (импорт файла, общий product-settings.json) */
export function normalizeStoreProfile(raw: unknown): StoreProfile {
  const profile: StoreProfile = { ...EMPTY_STORE_PROFILE, hiddenCategories: [], bannedProducts: {} };
  if (!raw || typeof raw !== 'object') return profile;
  const source = raw as Record<string, unknown>;

  if (typeof source.sport === 'string' && VALID_SPORTS.includes(source.sport as StoreSport)) {
    profile.sport = source.sport as StoreSport;
  }
  if (Array.isArray(source.hiddenCategories)) {
    profile.hiddenCategories = [
      ...new Set(
        source.hiddenCategories
          .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
          .map((c) => c.trim())
      ),
    ];
  }
  if (source.transfersDisabled === true) profile.transfersDisabled = true;
  const min = typeof source.defaultMinimum === 'number' ? source.defaultMinimum : Number(source.defaultMinimum);
  if (Number.isFinite(min) && min > 0) profile.defaultMinimum = Math.round(min);
  if (source.bannedProducts && typeof source.bannedProducts === 'object') {
    for (const [key, value] of Object.entries(source.bannedProducts as Record<string, unknown>)) {
      if (key.trim() && value !== false && value !== null && value !== undefined) {
        profile.bannedProducts[key.trim()] = true;
      }
    }
  }
  if (source.categoryExceptions && typeof source.categoryExceptions === 'object') {
    for (const [category, list] of Object.entries(source.categoryExceptions as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      const subtypes = list
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim());
      if (subtypes.length > 0) profile.categoryExceptions[category] = subtypes;
    }
  }
  if (typeof source.note === 'string') profile.note = source.note;
  return profile;
}

/** Разбор карты профилей (название магазина → профиль); мусор отбрасывается */
export function normalizeStoreProfiles(raw: unknown): Record<string, StoreProfile> {
  const result: Record<string, StoreProfile> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  for (const [storeName, value] of Object.entries(raw as Record<string, unknown>)) {
    const name = storeName.trim();
    if (!name || !value || typeof value !== 'object') continue;
    result[name] = normalizeStoreProfile(value);
  }
  return result;
}

/** Профиль магазина с заполненными значениями по умолчанию */
export function profileOf(settings: StoreRulesSource, storeName: string): StoreProfile {
  const stored = settings.storeProfiles?.[storeName];
  if (!stored) return { ...EMPTY_STORE_PROFILE, hiddenCategories: [], bannedProducts: {} };
  return {
    sport: stored.sport ?? 'all',
    hiddenCategories: stored.hiddenCategories ?? [],
    transfersDisabled: stored.transfersDisabled === true,
    defaultMinimum: stored.defaultMinimum > 0 ? stored.defaultMinimum : 0,
    bannedProducts: stored.bannedProducts ?? {},
    categoryExceptions: stored.categoryExceptions ?? {},
    note: stored.note ?? '',
  };
}

/** Пуст ли профиль (не отличается от значений по умолчанию) */
export function isProfileEmpty(profile: StoreProfile): boolean {
  return (
    profile.sport === 'all' &&
    profile.hiddenCategories.length === 0 &&
    Object.keys(profile.categoryExceptions ?? {}).length === 0 &&
    !profile.transfersDisabled &&
    profile.defaultMinimum <= 0 &&
    Object.keys(profile.bannedProducts).length === 0 &&
    !profile.note.trim()
  );
}

/** Товар запрещён в магазине индивидуально (🚫 — сильнее всех правил) */
export function isBanned(
  settings: StoreRulesSource,
  storeName: string,
  product: Pick<Product, 'article' | 'link' | 'name'>
): boolean {
  return profileOf(settings, storeName).bannedProducts[productSettingsKey(product)] === true;
}

export interface MinimumInfo {
  /** Эффективный минимум (0 — не задан) */
  min: number;
  /** Откуда минимум: индивидуальный товарный или по умолчанию из профиля */
  source: 'product' | 'store' | null;
}

/** Эффективный минимум товара в магазине: индивидуальный → профиль → 0 */
export function effectiveMinimum(
  settings: StoreRulesSource,
  storeName: string,
  productKey: string
): MinimumInfo {
  const individual = settings.storeMinimums?.[storeName]?.[productKey] ?? 0;
  if (individual > 0) return { min: individual, source: 'product' };
  const profile = profileOf(settings, storeName);
  if (profile.defaultMinimum > 0) return { min: profile.defaultMinimum, source: 'store' };
  return { min: 0, source: null };
}

/** Причина, по которой товар вне ассортимента точки (null — товар подходит) */
/** Подтипы категории, которые точка продаёт несмотря на скрытую категорию */
export function categoryExceptionsOf(
  settings: StoreAssortmentSource,
  storeName: string,
  category: string
): string[] {
  return profileOf(settings, storeName).categoryExceptions[category] ?? [];
}

export function assortmentBlock(
  settings: StoreAssortmentSource,
  storeName: string,
  product: Pick<Product, 'article' | 'link' | 'name' | 'category' | 'subtype'>
): { reason: 'sport' | 'category' | 'banned'; label: string } | null {
  const profile = profileOf(settings, storeName);
  if (profile.bannedProducts[productSettingsKey(product)]) {
    return { reason: 'banned', label: '🚫 запрещено для магазина' };
  }
  const sport = sportOf(product, settings.sportOverrides ?? {});
  // 'other' (Теннис/Падел, прочее) — универсальные товары, подходят любой точке
  if (profile.sport !== 'all' && sport !== profile.sport && sport !== 'other') {
    return {
      reason: 'sport',
      label: `⛔ магазин не продаёт «${SPORT_LABELS[sport]}»`,
    };
  }
  if (profile.hiddenCategories.includes(product.category)) {
    const exceptions = profile.categoryExceptions[product.category];
    const excepted = product.subtype != null && exceptions?.includes(product.subtype);
    if (!excepted) {
      return { reason: 'category', label: `⛔ категория «${product.category}» скрыта в магазине` };
    }
  }
  return null;
}

/**
 * Продаёт ли точка этот товар (ассортимент: запреты + спорт + категории).
 * Используется нормативом ходовых товаров в «Дозакупке».
 */
export function storeSellsProduct(
  settings: StoreAssortmentSource,
  storeName: string,
  product: Pick<Product, 'article' | 'link' | 'name' | 'category' | 'subtype'>
): boolean {
  return assortmentBlock(settings, storeName, product) === null;
}

/**
 * Можно ли ПРЕДЛОЖИТЬ товар магазину в перемещениях:
 * ассортимент (🚫/⛔) + включённые перемещения точки (📴).
 */
export function storeAcceptsTransfer(
  settings: StoreAssortmentSource,
  storeName: string,
  product: Pick<Product, 'article' | 'link' | 'name' | 'category' | 'subtype'>
): boolean {
  if (profileOf(settings, storeName).transfersDisabled) return false;
  return storeSellsProduct(settings, storeName, product);
}

/** Участвует ли магазин в перемещениях как донор (📴 выключает оба направления) */
export function storeCanDonate(settings: StoreRulesSource, storeName: string): boolean {
  return !profileOf(settings, storeName).transfersDisabled;
}

// ============ Статусы для строки магазина в карточке товара ============

export type StoreRuleStatus =
  | 'banned'
  | 'not-sold'
  | 'category-hidden'
  | 'transfers-off'
  | 'minimum'
  | 'allowed';

export interface StoreRuleView {
  storeName: string;
  status: StoreRuleStatus;
  /** Короткий значок статуса */
  icon: string;
  /** Человекочитаемая подпись статуса */
  label: string;
  /** Эффективный минимум (0 — не задан) */
  minimum: number;
  /** Откуда минимум */
  minimumSource: MinimumInfo['source'];
  /** Товар в принципе в ассортименте точки (запрет/спорт/категория) */
  blocked: boolean;
}

const STATUS_META: Record<StoreRuleStatus, { icon: string; label: string }> = {
  banned: { icon: '🚫', label: 'запрещено' },
  'not-sold': { icon: '⛔', label: 'вне ассортимента' },
  'category-hidden': { icon: '⛔', label: 'категория скрыта' },
  'transfers-off': { icon: '📴', label: 'перемещения выключены' },
  minimum: { icon: '⭐', label: 'минимум' },
  allowed: { icon: '✅', label: 'перемещение разрешено' },
};

/**
 * Статус правила для строки магазина в карточке товара.
 * Приоритет: 🚫 запрет → ⛔ ассортимент → 📴 перемещения → ⭐ минимум → ✅ разрешено.
 */
export function storeRuleView(
  settings: StoreAssortmentSource,
  storeName: string,
  product: Pick<Product, 'article' | 'link' | 'name' | 'category' | 'subtype'>
): StoreRuleView {
  const profile = profileOf(settings, storeName);
  const block = assortmentBlock(settings, storeName, product);
  const minimum = effectiveMinimum(settings, storeName, productSettingsKey(product));

  let status: StoreRuleStatus = 'allowed';
  let label = STATUS_META.allowed.label;
  if (block?.reason === 'banned') {
    status = 'banned';
    label = 'запрещено для этого магазина';
  } else if (block?.reason === 'sport') {
    status = 'not-sold';
    label = block.label.replace(/^⛔\s*/, '');
  } else if (block?.reason === 'category') {
    status = 'category-hidden';
    label = block.label.replace(/^⛔\s*/, '');
  } else if (profile.transfersDisabled) {
    status = 'transfers-off';
    label = STATUS_META['transfers-off'].label;
  } else if (minimum.min > 0) {
    status = 'minimum';
    label = `минимум ${minimum.min} шт.`;
  }

  return {
    storeName,
    status,
    icon: STATUS_META[status].icon,
    label,
    minimum: minimum.min,
    minimumSource: minimum.source,
    blocked: block !== null,
  };
}

/** Правила по всем магазинам для одного товара (строки в карточке товара) */
export function storeRuleViews(
  settings: StoreAssortmentSource,
  storeNames: string[],
  product: Pick<Product, 'article' | 'link' | 'name' | 'category' | 'subtype'>
): StoreRuleView[] {
  return storeNames.map((name) => storeRuleView(settings, name, product));
}

/** Человекопонятное описание статуса (для title/подписей) */
export function storeRuleText(view: StoreRuleView): string {
  switch (view.status) {
    case 'banned':
      return '🚫 запрещено — товар не предлагается этому магазину';
    case 'not-sold':
    case 'category-hidden':
      return `⛔ ${view.label}`;
    case 'transfers-off':
      return '📴 перемещения магазина выключены';
    case 'minimum':
      return `⭐ минимум ${view.minimum} шт.${view.minimumSource === 'store' ? ' (по умолчанию для магазина)' : ''}`;
    default:
      return '✅ перемещение разрешено';
  }
}

// ============ Сводка профилей (плашка в «Перемещениях», список в «Магазинах») ============

export interface StoreProfileSummary {
  storeName: string;
  profile: StoreProfile;
  /** Профиль отличается от пустого (правила что-то меняют) */
  active: boolean;
  /** Сколько товаров не попадает в точку: по видам спорта / категориям / запретам */
  excluded: { sport: number; category: number; banned: number; total: number };
  /** Всего товаров в выборке */
  products: number;
}

/**
 * Сводка по профилям магазинов: какие правила заданы и сколько товаров
 * они отсекают. Используется плашкой «учтены профили» во «Перемещениях»
 * и бейджами в списке магазинов на вкладке «🏬 Магазины».
 */
export function summarizeStoreProfiles(
  products: Pick<Product, 'article' | 'link' | 'name' | 'category'>[],
  settings: StoreAssortmentSource,
  storeNames: string[]
): StoreProfileSummary[] {
  return storeNames.map((storeName) => {
    const profile = profileOf(settings, storeName);
    const excluded = { sport: 0, category: 0, banned: 0, total: 0 };
    for (const product of products) {
      const block = assortmentBlock(settings, storeName, product);
      if (!block) continue;
      excluded[block.reason]++;
      excluded.total++;
    }
    return {
      storeName,
      profile,
      active: !isProfileEmpty(profile) || excluded.total > 0,
      excluded,
      products: products.length,
    };
  });
}

/** Только активные профили (есть правила) — для плашки в «Перемещениях» */
export function activeStoreProfiles(
  products: Pick<Product, 'article' | 'link' | 'name' | 'category'>[],
  settings: StoreAssortmentSource,
  storeNames: string[]
): StoreProfileSummary[] {
  return summarizeStoreProfiles(products, settings, storeNames).filter(
    (s) =>
      s.active ||
      s.profile.transfersDisabled ||
      s.profile.defaultMinimum > 0 ||
      Object.keys(s.profile.bannedProducts).length > 0
  );
}

// ============ Экспорт профиля магазина (JSON, совместимый с product-settings.json) ============

/**
 * Профиль одного магазина в формате общего product-settings.json:
 * тот же объект настроек, но только с данными этой точки. Файл можно
 * импортировать обратно (сайдбар → «Загрузить настройки товаров») или
 * положить в public/data/product-settings.json, чтобы профиль стал общим.
 */
export function storeProfileSettings(
  settings: StoreRulesSource,
  storeName: string
): Record<string, unknown> {
  const profile = profileOf(settings, storeName);
  const minimums = settings.storeMinimums?.[storeName] ?? {};
  return {
    sportOverrides: {},
    excludedProducts: {},
    suppliedProducts: {},
    hotProducts: {},
    storeMinimums: Object.keys(minimums).length > 0 ? { [storeName]: { ...minimums } } : {},
    storeProfiles: { [storeName]: profile },
  };
}

export function storeProfileJson(settings: StoreRulesSource, storeName: string): string {
  return JSON.stringify(storeProfileSettings(settings, storeName), null, 2);
}

/** Имя файла профиля: product-settings-ekb-elizavetinskoe-shosse.json */
export function storeProfileFileName(storeName: string): string {
  const slug = storeName
    .toLowerCase()
    .replace(/[()]/g, ' ')
    .trim()
    .replace(/[^a-zа-яё0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `product-settings-${slug || 'store'}.json`;
}

/** Скачивание профиля магазина отдельным файлом */
export function downloadStoreProfile(settings: StoreRulesSource, storeName: string): string {
  const fileName = storeProfileFileName(storeName);
  if (typeof document === 'undefined') return fileName;
  const blob = new Blob([storeProfileJson(settings, storeName)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
  return fileName;
}
