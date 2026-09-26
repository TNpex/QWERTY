/**
 * Производные показатели по остаткам и истории снимков — «понятный анализ»:
 *
 * - продажи по товарам и магазинам между снимками (salesByStoreFromHistory);
 * - «дней до обнуления» полки магазина (runway);
 * - ABC-классы товаров по вкладу в продажи (abcClasses);
 * - мёртвый запас: есть остаток, но давно нет продаж (deadStock);
 * - деньги, замороженные в остатках по магазинам (stockValueByStore);
 * - динамика доступности по снимкам (availabilityTrend);
 * - размерный профиль точки: факт на полке против спроса сети (sizeProfile).
 *
 * Все функции чистые, работают с уже распарсенными структурами
 * (ParsedData, HistorySnapshot, SizeSnapshot) — покрыты тестами insights.test.ts.
 *
 * Правила атрибуции продаж — как в historyCore.analyzeSales: уменьшение
 * остатка точки между соседними снимками = продажа; увеличение = поступление
 * (в продажи не попадает); товар исчез из снимка = остаток 0.
 */

import type { ParsedData, Product } from '../types';
import type { HistorySnapshot } from './historyCore';

/** Пороги «дней до обнуления» для цветовой оценки */
export const RUNWAY_LOW_DAYS = 14;
export const RUNWAY_MID_DAYS = 45;
/** Сколько дней без продаж считает запас мёртвым */
export const DEAD_STOCK_DAYS = 60;

function daysBetween(from: string, to: string): number {
  const ms = Date.parse(to) - Date.parse(from);
  if (!isFinite(ms) || ms <= 0) return 1;
  return Math.max(1, Math.round(ms / 86_400_000));
}

export interface ProductSales {
  /** Продано единиц по всей сети за окно истории */
  total: number;
  /** Продано единиц по магазинам */
  byStore: Map<string, number>;
  /** Дата последней зафиксированной продажи (YYYY-MM-DD) или null */
  lastSaleDate: string | null;
}

export interface HistorySales {
  fromDate: string;
  toDate: string;
  days: number;
  /** Ключ — ссылка на товар (как в снимках) */
  byProduct: Map<string, ProductSales>;
}

/** Продажи по (товар × магазин) из последовательных снимков остатков. */
export function salesByStoreFromHistory(history: HistorySnapshot[]): HistorySales | null {
  if (history.length < 2) return null;
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const byProduct = new Map<string, ProductSales>();

  const bump = (link: string): ProductSales => {
    let row = byProduct.get(link);
    if (!row) {
      row = { total: 0, byStore: new Map(), lastSaleDate: null };
      byProduct.set(link, row);
    }
    return row;
  };

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const next = sorted[i];
    for (const [link, prevProduct] of prev.products) {
      const nextProduct = next.products.get(link);
      for (const store of Object.keys(prevProduct.byStore)) {
        const before = prevProduct.byStore[store] ?? 0;
        const after = nextProduct ? (nextProduct.byStore[store] ?? 0) : 0;
        const sold = before - after;
        if (sold > 0) {
          const row = bump(link);
          row.total += sold;
          row.byStore.set(store, (row.byStore.get(store) ?? 0) + sold);
          row.lastSaleDate = next.date;
        }
      }
    }
  }

  const fromDate = sorted[0].date;
  const toDate = sorted[sorted.length - 1].date;
  return { fromDate, toDate, days: daysBetween(fromDate, toDate), byProduct };
}

/**
 * «Дней до обнуления» полки: остаток / средняя дневная скорость продаж.
 * null — продаж за окно истории не было (скорость неизвестна);
 * 0 — полка уже пуста.
 */
export function runwayDays(
  quantity: number,
  soldInWindow: number,
  windowDays: number
): number | null {
  if (quantity <= 0) return 0;
  const perDay = soldInWindow / Math.max(1, windowDays);
  if (perDay <= 0) return null;
  return Math.round(quantity / perDay);
}

export type RunwayLevel = 'out' | 'low' | 'mid' | 'ok' | 'idle';

/** Цветовая оценка запаса точки по дням до обнуления */
export function runwayLevel(quantity: number, days: number | null): RunwayLevel {
  if (quantity <= 0) return 'out';
  if (days === null) return 'idle';
  if (days <= RUNWAY_LOW_DAYS) return 'low';
  if (days <= RUNWAY_MID_DAYS) return 'mid';
  return 'ok';
}

export const RUNWAY_LEVEL_LABELS: Record<RunwayLevel, string> = {
  out: 'нет на полке',
  low: 'хватит ненадолго',
  mid: 'запас умеренный',
  ok: 'запас комфортный',
  idle: 'не продаётся',
};

export type AbcClass = 'A' | 'B' | 'C';

/**
 * ABC-классификация по продажам за окно истории:
 * A — дают первые 80% продаж, B — следующие 15% (до 95%), C — остальное
 * (включая товары без продаж). Классы считаются по всей сети.
 */
export function abcClasses(sales: HistorySales | null): Map<string, AbcClass> {
  const result = new Map<string, AbcClass>();
  if (!sales) return result;
  const rows = [...sales.byProduct.entries()].filter(([, v]) => v.total > 0);
  const grand = rows.reduce((sum, [, v]) => sum + v.total, 0);
  if (grand <= 0) return result;
  rows.sort((a, b) => b[1].total - a[1].total);
  let cumulative = 0;
  for (const [link, v] of rows) {
    cumulative += v.total;
    const share = cumulative / grand;
    result.set(link, share <= 0.8 ? 'A' : share <= 0.95 ? 'B' : 'C');
  }
  for (const link of sales.byProduct.keys()) {
    if (!result.has(link)) result.set(link, 'C');
  }
  return result;
}

export interface DeadStockRow {
  product: Product;
  /** Суммарный остаток по сети (включая склад) */
  quantity: number;
  /** Стоимость запаса, ₽ */
  value: number;
  /** Дней с последней продажи (null — продаж в истории не было вовсе) */
  daysSinceSale: number | null;
  lastSaleDate: string | null;
}

/**
 * Мёртвый запас: остаток есть, но продаж нет дольше thresholdDays
 * (или не было вовсе в окне истории). Сортировка: самые «дорогие» первыми.
 */
export function deadStock(
  data: ParsedData,
  sales: HistorySales | null,
  toDate: string,
  thresholdDays = DEAD_STOCK_DAYS
): DeadStockRow[] {
  const qtyByProduct = new Map<string, number>();
  for (const item of data.inventory) {
    if (item.notCarried) continue;
    qtyByProduct.set(item.productId, (qtyByProduct.get(item.productId) ?? 0) + item.quantity);
  }
  const rows: DeadStockRow[] = [];
  for (const product of data.products) {
    const quantity = qtyByProduct.get(product.id) ?? 0;
    if (quantity <= 0) continue;
    // Ключ истории — ссылка товара; для товаров без ссылки ключа нет
    const link = product.link;
    const sale = link ? sales?.byProduct.get(link) : undefined;
    const hasSales = (sale?.total ?? 0) > 0;
    const daysSinceSale = sale?.lastSaleDate ? daysBetween(sale.lastSaleDate, toDate) : null;
    if (hasSales && (daysSinceSale ?? 0) < thresholdDays) continue;
    rows.push({
      product,
      quantity,
      value: quantity * product.price,
      daysSinceSale,
      lastSaleDate: sale?.lastSaleDate ?? null,
    });
  }
  return rows.sort((a, b) => b.value - a.value);
}

export interface StockValueRow {
  storeId: string;
  name: string;
  units: number;
  value: number;
}

/** Деньги в остатках: цена × количество по каждой точке (вне ассортимента не считается). */
export function stockValueByStore(data: ParsedData): StockValueRow[] {
  const byStore = new Map<string, { units: number; value: number }>();
  const priceById = new Map(data.products.map((p) => [p.id, p.price]));
  for (const item of data.inventory) {
    if (item.notCarried) continue;
    const row = byStore.get(item.storeId) ?? { units: 0, value: 0 };
    row.units += item.quantity;
    row.value += item.quantity * (priceById.get(item.productId) ?? 0);
    byStore.set(item.storeId, row);
  }
  return data.stores.map((store) => ({
    storeId: store.id,
    name: store.name,
    ...(byStore.get(store.id) ?? { units: 0, value: 0 }),
  }));
}

export interface AvailabilityTrendPoint {
  date: string;
  /** Доля размерных позиций с нулём по сети, % */
  networkOosPercent: number;
  /** То же по магазинам (имя → %) */
  byStore: Record<string, number>;
}

/** Динамика доступности: доля нулевых позиций среди возимых по каждому снимку. */
export function availabilityTrend(history: HistorySnapshot[]): AvailabilityTrendPoint[] {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((snapshot) => {
    const byStore: Record<string, number> = {};
    const storeCounters = new Map<string, { carried: number; zeros: number }>();
    let carried = 0;
    let zeros = 0;
    for (const product of snapshot.products.values()) {
      for (const [store, qty] of Object.entries(product.byStore)) {
        const counter = storeCounters.get(store) ?? { carried: 0, zeros: 0 };
        counter.carried += 1;
        if (qty <= 0) counter.zeros += 1;
        storeCounters.set(store, counter);
        carried += 1;
        if (qty <= 0) zeros += 1;
      }
    }
    for (const [store, counter] of storeCounters) {
      byStore[store] = counter.carried > 0 ? Math.round((counter.zeros / counter.carried) * 100) : 0;
    }
    return {
      date: snapshot.date,
      networkOosPercent: carried > 0 ? Math.round((zeros / carried) * 100) : 0,
      byStore,
    };
  });
}

export interface SizeProfileRow {
  size: string;
  /** Остаток размера в точке, шт */
  stock: number;
  /** Доля размера в остатке точки, % */
  stockShare: number;
  /** Продажи размера по сети за окно, шт */
  sold: number;
  /** Доля размера в продажах сети, % */
  soldShare: number;
  /** soldShare - stockShare: >0 — размер выметают, а на полке его мало */
  gap: number;
}

/**
 * Размерный профиль точки: сколько каждого размера лежит в магазине против
 * того, как часто этот размер покупают по сети (спрос по снимкам sizes).
 * gap > 0 — размер продаётся быстрее, чем занимает место на полке.
 */
export function sizeProfile(
  data: ParsedData,
  sizeSales: { entries: { link: string; size: string; sold: number }[] } | null,
  storeName: string
): SizeProfileRow[] {
  const stockBySize = new Map<string, number>();
  for (const item of data.inventory) {
    if (item.notCarried || item.size === '—') continue;
    const store = data.stores.find((s) => s.id === item.storeId)?.name;
    if (store !== storeName) continue;
    stockBySize.set(item.size, (stockBySize.get(item.size) ?? 0) + item.quantity);
  }
  const soldBySize = new Map<string, number>();
  if (sizeSales) {
    // учитываем только товары текущего среза (фильтры действуют)
    const links = new Set(data.products.map((p) => p.link).filter(Boolean) as string[]);
    for (const entry of sizeSales.entries) {
      if (!links.has(entry.link)) continue;
      soldBySize.set(entry.size, (soldBySize.get(entry.size) ?? 0) + entry.sold);
    }
  }
  const sizes = new Set([...stockBySize.keys(), ...soldBySize.keys()]);
  const totalStock = [...stockBySize.values()].reduce((a, b) => a + b, 0);
  const totalSold = [...soldBySize.values()].reduce((a, b) => a + b, 0);
  const rows: SizeProfileRow[] = [];
  for (const size of sizes) {
    const stock = stockBySize.get(size) ?? 0;
    const sold = soldBySize.get(size) ?? 0;
    const stockShare = totalStock > 0 ? Math.round((stock / totalStock) * 100) : 0;
    const soldShare = totalSold > 0 ? Math.round((sold / totalSold) * 100) : 0;
    rows.push({ size, stock, stockShare, sold, soldShare, gap: soldShare - stockShare });
  }
  return rows.sort((a, b) => b.gap - a.gap || b.sold - a.sold);
}
