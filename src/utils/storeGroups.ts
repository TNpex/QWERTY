import type { Store } from '../types';

/**
 * Группировка магазинов по городам для сортировки и логистики.
 *
 * Порядок витрины: Санкт-Петербург → Екатеринбург (розница) → Тюмень → Уфа →
 * Ижевск → прочие. Склад — всегда последний и выделяется в UI синим цветом.
 */

/** Признак склада (не розничный магазин) */
export function isWarehouse(storeName: string): boolean {
  return storeName.toLowerCase().includes('склад');
}

/** Город магазина по его названию (для группировки и оценки логистики) */
export function getStoreCity(storeName: string): string {
  const lower = storeName.toLowerCase();
  if (lower.includes('санкт-петербург') || lower.includes('спб') || lower.includes('питер')) {
    return 'Санкт-Петербург';
  }
  if (lower.includes('екатеринбург') || lower.includes('екб')) return 'Екатеринбург';
  if (lower.includes('тюмень')) return 'Тюмень';
  if (lower.includes('уфа')) return 'Уфа';
  if (lower.includes('ижевск')) return 'Ижевск';
  // Первая словоформа до скобки — fallback (например «Казань (Центральная)»)
  const beforeParen = storeName.split('(')[0].trim();
  return beforeParen || 'Прочие';
}

/**
 * Подсказка города для подписи магазина: возвращает null, если город уже
 * содержится в названии («Уфа», «Санкт-Петербург (Спортивная)»), иначе имя
 * города («Полевской тракт» → «Екатеринбург»). Защищает от дублей в UI.
 */
export function cityHint(storeName: string): string | null {
  const city = getStoreCity(storeName);
  return storeName.toLowerCase().includes(city.toLowerCase()) ? null : city;
}

const CITY_ORDER = ['Санкт-Петербург', 'Екатеринбург', 'Тюмень', 'Уфа', 'Ижевск'];

function cityRank(city: string): number {
  const index = CITY_ORDER.indexOf(city);
  return index === -1 ? CITY_ORDER.length : index;
}

/**
 * Сортировка магазинов для витрины: сначала группы по городам
 * (СПб, Екб, ...), склад — всегда последним.
 */
export function sortStoresForDisplay(stores: Store[]): Store[] {
  return [...stores].sort((a, b) => {
    const aWarehouse = isWarehouse(a.name);
    const bWarehouse = isWarehouse(b.name);
    if (aWarehouse !== bWarehouse) return aWarehouse ? 1 : -1;
    const rankDiff = cityRank(getStoreCity(a.name)) - cityRank(getStoreCity(b.name));
    if (rankDiff !== 0) return rankDiff;
    return a.name.localeCompare(b.name, 'ru');
  });
}

/** Маршрут перемещения между магазинами */
export type TransferRoute = 'warehouse' | 'same-city' | 'intercity' | 'spb-expensive';

/**
 * Классификация маршрута перемещения:
 * - warehouse: со склада в магазин — основной бесплатный поток;
 * - same-city: внутри одного города — дёшево;
 * - spb-expensive: из Санкт-Петербурга в другой город — дорогая логистика,
 *   обычно выгоднее дозаказать у поставщика (в UI скрыто по умолчанию);
 * - intercity: между другими городами — платная логистика.
 */
export function getTransferRoute(fromStore: string, toStore: string): TransferRoute {
  if (isWarehouse(fromStore)) return 'warehouse';
  const fromCity = getStoreCity(fromStore);
  const toCity = getStoreCity(toStore);
  if (fromCity === toCity) return 'same-city';
  if (fromCity === 'Санкт-Петербург') return 'spb-expensive';
  return 'intercity';
}

export const ROUTE_LABELS: Record<TransferRoute, string> = {
  warehouse: 'Со склада',
  'same-city': 'Внутри города',
  intercity: 'Между городами',
  'spb-expensive': 'Из СПб — дорого',
};

// ============ Короткие подписи магазинов для таблиц ============

const CITY_PREFIX: Record<string, string> = {
  'санкт-петербург': 'СПБ',
  'спб': 'СПБ',
  'питер': 'СПБ',
  'екатеринбург': 'ЕКБ',
  'екб': 'ЕКБ',
  'тюмень': 'ТЮМ',
  'уфа': 'УФА',
  'ижевск': 'ИЖ',
  'москва': 'МСК',
  'казань': 'КЗН',
};

/**
 * Переопределения коротких подписей: когда первая буква улицы совпадает
 * с другим магазином города («Парина» и «Полевской тракт» → обе «П»).
 */
const SHORT_LABEL_OVERRIDES: Record<string, string> = {
  'Екатеринбург (Полевской тракт)': 'ЕКБ-ПТ',
};

/**
 * Короткая подпись магазина для колонок таблиц:
 * «Санкт-Петербург (Ярослава Гашека)» → «СПБ-Я»,
 * «Екатеринбург (Парина)» → «ЕКБ-П», «Екатеринбург (Полевской тракт)» → «ЕКБ-ПТ»,
 * «Тюмень (Народная)» → «ТЮМ-Н», «Уфа» → «УФА»,
 * «Екатеринбург (Основной склад)» → «СКЛАД» (в UI выделяется синим).
 */
export function shortStoreLabel(name: string): string {
  if (isWarehouse(name)) return 'СКЛАД';
  if (SHORT_LABEL_OVERRIDES[name]) return SHORT_LABEL_OVERRIDES[name];
  const lower = name.toLowerCase();

  let prefix = '';
  for (const [key, value] of Object.entries(CITY_PREFIX)) {
    if (lower.includes(key)) {
      prefix = value;
      break;
    }
  }
  if (!prefix) {
    // Неизвестный город — первые 3 буквы названия
    prefix = name.split(/[\s(]/)[0].slice(0, 3).toUpperCase();
  }

  const paren = name.match(/\(([^)]+)\)/);
  if (paren) {
    const tail = paren[1].trim();
    const letter = tail.charAt(0).toUpperCase();
    return letter ? `${prefix}-${letter}` : prefix;
  }
  return prefix;
}
