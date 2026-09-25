import type { ParsedData } from '../types';
import { normalizeLink } from './historyCore';

/**
 * Скидки (распродажа) saletennis.com.
 *
 * Источник — публичный раздел «Распродажа» (/catalog/sale/): в карточке товара
 * лежат JSON-атрибут data-ecommerce (id, name, price, brand, category),
 * старая цена (c-item__price-old), текущая (c-item__price-current) и бейдж
 * процента (c-item__label--sale). Парсер обходит страницы раздела при каждом
 * прогоне и пишет public/data/discounts.json.
 *
 * Ключ записи — itemId товара (числовой id сайта, тот же, что в cart-map.json):
 * он стабилен, а slug ссылки сайт между парсингами меняет. Ссылка хранится
 * внутри записи и используется как запасной способ сопоставления.
 */

export interface DiscountInfo {
  itemId: string;
  /** Текущая цена со скидкой, ₽ */
  price: number;
  /** Цена до скидки, ₽ */
  oldPrice: number;
  /** Процент скидки (1..99) */
  percent: number;
  name?: string;
  link?: string;
}

export interface DiscountMap {
  generatedAt?: string;
  source?: string;
  /** itemId → скидка */
  items: Record<string, DiscountInfo>;
}

const toNumber = (value: unknown): number => {
  const num = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(num) ? num : 0;
};

/** Разбор discounts.json с отсечением мусора (нет цены или процента — не скидка) */
export function parseDiscounts(json: string): DiscountMap | null {
  try {
    const raw = JSON.parse(json) as {
      generatedAt?: string;
      source?: string;
      items?: Record<string, unknown>;
    };
    if (!raw || typeof raw !== 'object' || !raw.items || typeof raw.items !== 'object') {
      return null;
    }
    const items: Record<string, DiscountInfo> = {};
    for (const [key, value] of Object.entries(raw.items)) {
      if (!value || typeof value !== 'object') continue;
      const entry = value as Record<string, unknown>;
      const itemId = String(entry.itemId ?? key).trim();
      if (!itemId) continue;
      const price = toNumber(entry.price);
      const oldPrice = toNumber(entry.oldPrice);
      const percent = computePercent(entry.percent, price, oldPrice);
      if (percent <= 0) continue; // без процента это не скидка
      items[itemId] = {
        itemId,
        price: price || oldPrice,
        oldPrice,
        percent,
        ...(typeof entry.name === 'string' && entry.name ? { name: entry.name } : {}),
        ...(typeof entry.link === 'string' && entry.link ? { link: entry.link } : {}),
      };
    }
    return {
      ...(typeof raw.generatedAt === 'string' ? { generatedAt: raw.generatedAt } : {}),
      ...(typeof raw.source === 'string' ? { source: raw.source } : {}),
      items,
    };
  } catch {
    return null;
  }
}

/** Процент скидки: из данных сайта либо по ценам (и наоборот — цены из процента) */
export function computePercent(raw: unknown, price: number, oldPrice: number): number {
  const given = toNumber(raw);
  if (given > 0 && given < 100) return Math.round(given);
  if (oldPrice > 0 && price > 0 && price < oldPrice) {
    return Math.max(1, Math.min(99, Math.round((1 - price / oldPrice) * 100)));
  }
  return 0;
}

/**
 * itemId товара из его ссылки: «…/catalog/product/sumka-…-19166/» → «19166».
 * Сайт меняет slug, но числовой хвост — это id товара (тот же, что в корзине).
 */
export function itemIdFromLink(link?: string): string | null {
  const text = (link ?? '').trim();
  if (!text) return null;
  const match = text.replace(/\/+$/, '').match(/-(\d{2,})$/);
  return match ? match[1] : null;
}

/** Скидка товара: сначала по itemId из ссылки, затем по совпадению ссылки */
export function discountFor(
  map: DiscountMap | null,
  product: { link?: string; article?: string }
): DiscountInfo | null {
  if (!map) return null;
  const id = itemIdFromLink(product.link);
  if (id && map.items[id]) return map.items[id];
  const link = normalizeLink(product.link ?? '');
  if (!link) return null;
  for (const item of Object.values(map.items)) {
    if (item.link && normalizeLink(item.link) === link) return item;
  }
  return null;
}

/** Сводка по скидкам для подписей в интерфейсе */
export function discountSummary(map: DiscountMap | null): {
  count: number;
  maxPercent: number;
  avgPercent: number;
} {
  const items = Object.values(map?.items ?? {});
  if (items.length === 0) return { count: 0, maxPercent: 0, avgPercent: 0 };
  const percents = items.map((i) => i.percent);
  return {
    count: items.length,
    maxPercent: Math.max(...percents),
    avgPercent: Math.round(percents.reduce((s, p) => s + p, 0) / percents.length),
  };
}

/**
 * Проставляет товарам скидку из discounts.json (старая цена + процент).
 * Текущая `price` в каталоге уже равна цене со скидкой — сайт отдаёт её как
 * основную, поэтому добавляем только oldPrice и discountPercent.
 */
export function applyDiscounts(data: ParsedData, map: DiscountMap | null): ParsedData {
  if (!map || Object.keys(map.items).length === 0) return data;
  let touched = false;
  const products = data.products.map((product) => {
    const discount = discountFor(map, product);
    if (!discount) return product;
    touched = true;
    return {
      ...product,
      discountPercent: discount.percent,
      ...(discount.oldPrice > 0 ? { oldPrice: discount.oldPrice } : {}),
    };
  });
  return touched ? { ...data, products } : data;
}
