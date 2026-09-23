import { findColumn, detectColumns, parsePrice, parseQuantity } from './xlsxParser';

/**
 * Анализ истории снимков остатков (датированные файлы парсинга).
 *
 * Снимок — это products.csv, сохранённый под именем YYYY-MM-DD.csv.
 * Сравнивая соседние снимки, получаем:
 * - продажи (суммарный остаток сети уменьшился);
 * - поступления (остаток вырос);
 * - перемещения (сумма по сети не изменилась, но изменилось распределение по магазинам);
 * - распроданные товары (был остаток → стал ноль либо товар исчез из каталога).
 */

export interface SnapshotProduct {
  link: string;
  article: string;
  name: string;
  brand: string;
  category: string;
  price: number;
  total: number;
  byStore: Record<string, number>;
}

export interface HistorySnapshot {
  /** Дата снимка YYYY-MM-DD */
  date: string;
  stores: string[];
  /** Ключ — ссылка на товар (стабильный уникальный идентификатор) */
  products: Map<string, SnapshotProduct>;
}

const LINK_ALIASES = ['ссылка', 'link', 'url'];
const TOTAL_ALIASES = ['всего', 'total', 'итого'];

function productIdentityKey(link: string, article: string, name: string): string {
  return link || `${article}|${name}`;
}

/** Парсит строки снимка (широкий формат products.csv) в HistorySnapshot */
export function parseSnapshotRows(
  rows: Record<string, unknown>[],
  date: string
): HistorySnapshot {
  if (rows.length === 0) throw new Error(`Снимок ${date}: файл пустой`);
  const headers = Object.keys(rows[0]);
  const mapping = detectColumns(headers);

  const linkCol = findColumn(headers, LINK_ALIASES);
  const totalCol = findColumn(headers, TOTAL_ALIASES);

  // Магазины: из широкого маппинга либо (для длинного формата) из значений колонки
  let storeColumns: string[] = [];
  let longStoreCol: string | null = null;
  let longQtyCol: string | null = null;
  if (mapping.format === 'wide') {
    storeColumns = mapping.storeColumns;
  } else {
    longStoreCol = mapping.storeCol;
    longQtyCol = mapping.qtyCol;
  }

  const products = new Map<string, SnapshotProduct>();
  const storesSet = new Set<string>(storeColumns);

  for (const row of rows) {
    const name = String(row[mapping.nameCol] ?? '').trim();
    if (!name) continue;
    const link = linkCol ? String(row[linkCol] ?? '').trim() : '';
    const article = mapping.articleCol ? String(row[mapping.articleCol] ?? '').trim() : '';
    const brand = mapping.brandCol ? String(row[mapping.brandCol] ?? '').trim() : 'Неизвестно';
    const category = mapping.categoryCol ? String(row[mapping.categoryCol] ?? '').trim() : 'Другое';
    const price = mapping.priceCol ? parsePrice(row[mapping.priceCol]) : 0;
    const key = productIdentityKey(link, article, name);

    let entry = products.get(key);
    if (!entry) {
      entry = { link, article, name, brand, category, price, total: 0, byStore: {} };
      products.set(key, entry);
    }

    if (storeColumns.length > 0) {
      let rowTotal = 0;
      for (const col of storeColumns) {
        const qty = parseQuantity(row[col]) ?? 0;
        entry.byStore[col] = (entry.byStore[col] ?? 0) + qty;
        rowTotal += qty;
      }
      // Колонка «Всего» приоритетнее суммы, если present
      const declaredTotal = totalCol ? parseQuantity(row[totalCol]) : null;
      entry.total += declaredTotal ?? rowTotal;
    } else if (longStoreCol && longQtyCol) {
      const storeName = String(row[longStoreCol] ?? '').trim();
      const qty = parseQuantity(row[longQtyCol]) ?? 0;
      if (storeName) {
        storesSet.add(storeName);
        entry.byStore[storeName] = (entry.byStore[storeName] ?? 0) + qty;
        entry.total += qty;
      }
    }
  }

  return { date, stores: [...storesSet], products };
}

// ============ Сравнение снимков ============

export interface ProductMovement {
  link: string;
  article: string;
  name: string;
  brand: string;
  category: string;
  /** Продано единиц за период (уменьшение суммарного остатка) */
  sold: number;
  /** Поступило единиц (увеличение остатка) */
  restocked: number;
  /** Перемещено между магазинами (при неизменном суммарном остатке) */
  transferred: number;
  firstTotal: number;
  lastTotal: number;
  currentTotal: number;
  /** Товар распродан: остаток был > 0 и стал 0 (или товар исчез из каталога) */
  soldOut: boolean;
  /** Товар впервые появился в каталоге */
  isNew: boolean;
  disappeared: boolean;
}

export interface StoreMovement {
  store: string;
  sold: number;
  restocked: number;
}

export interface SalesReport {
  fromDate: string;
  toDate: string;
  days: number;
  snapshotsCount: number;
  totalSold: number;
  totalRestocked: number;
  totalTransferred: number;
  /** Распроданные товары (остаток → 0) */
  soldOutProducts: ProductMovement[];
  /** Лидеры продаж */
  topSold: ProductMovement[];
  /** Поступления */
  restockedProducts: ProductMovement[];
  byStore: StoreMovement[];
  newProducts: number;
  removedProducts: number;
}

function daysBetween(from: string, to: string): number {
  const ms = Date.parse(to) - Date.parse(from);
  if (!isFinite(ms) || ms <= 0) return 1;
  return Math.max(1, Math.round(ms / 86_400_000));
}

/**
 * Агрегирует движение товаров по всем последовательным парам снимков.
 * Возвращает null, если снимков меньше двух (сравнивать не с чем).
 *
 * Правила атрибуции (v1, документированы для прозрачности):
 * - сумма по сети уменьшилась → продажа; по магазинам распределяется пропорционально
 *   убыванию остатков (не больше общего снижения);
 * - сумма не изменилась, но остатки «переехали» → перемещение между магазинами;
 * - сумма выросла → поступление.
 */
export function analyzeSales(snapshots: HistorySnapshot[]): SalesReport | null {
  if (snapshots.length < 2) return null;

  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const movements = new Map<string, ProductMovement>();
  const storeAgg = new Map<string, StoreMovement>();
  let totalSold = 0;
  let totalRestocked = 0;
  let totalTransferred = 0;
  let newProducts = 0;
  let removedProducts = 0;
  let days = 0;

  const ensureStore = (name: string): StoreMovement => {
    let agg = storeAgg.get(name);
    if (!agg) {
      agg = { store: name, sold: 0, restocked: 0 };
      storeAgg.set(name, agg);
    }
    return agg;
  };

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    days += daysBetween(prev.date, curr.date);
    for (const s of [...prev.stores, ...curr.stores]) ensureStore(s);

    const keys = new Set([...prev.products.keys(), ...curr.products.keys()]);
    for (const key of keys) {
      const p = prev.products.get(key);
      const c = curr.products.get(key);
      const meta = (c ?? p)!;

      let mv = movements.get(key);
      if (!mv) {
        mv = {
          link: meta.link,
          article: meta.article,
          name: meta.name,
          brand: meta.brand,
          category: meta.category,
          sold: 0,
          restocked: 0,
          transferred: 0,
          firstTotal: p?.total ?? c?.total ?? 0,
          lastTotal: 0,
          currentTotal: 0,
          soldOut: false,
          isNew: false,
          disappeared: false,
        };
        movements.set(key, mv);
      }

      // Товар исчез из каталога — считаем распродажей остатка
      if (p && !c) {
        removedProducts++;
        mv.disappeared = true;
        mv.sold += p.total;
        totalSold += p.total;
        mv.lastTotal = 0;
        for (const [store, qty] of Object.entries(p.byStore)) {
          ensureStore(store).sold += qty;
        }
        continue;
      }

      // Новый товар в каталоге — поступление, продажей не считается
      if (!p && c) {
        newProducts++;
        mv.isNew = true;
        mv.firstTotal = c.total;
        mv.lastTotal = c.total;
        continue;
      }

      const prevTotal = p!.total;
      const currTotal = c!.total;
      const delta = prevTotal - currTotal;
      mv.lastTotal = currTotal;

      if (delta > 0) {
        mv.sold += delta;
        totalSold += delta;
        // Распределение продаж по магазинам: сначала те, у кого остаток уменьшился сильнее
        let remaining = delta;
        const decreases = Object.keys({ ...p!.byStore, ...c!.byStore })
          .map((store) => ({ store, drop: (p!.byStore[store] ?? 0) - (c!.byStore[store] ?? 0) }))
          .filter((x) => x.drop > 0)
          .sort((a, b) => b.drop - a.drop);
        for (const { store, drop } of decreases) {
          if (remaining <= 0) break;
          const attributed = Math.min(drop, remaining);
          ensureStore(store).sold += attributed;
          remaining -= attributed;
        }
      } else if (delta < 0) {
        mv.restocked += -delta;
        totalRestocked += -delta;
        let remaining = -delta;
        const increases = Object.keys({ ...p!.byStore, ...c!.byStore })
          .map((store) => ({ store, gain: (c!.byStore[store] ?? 0) - (p!.byStore[store] ?? 0) }))
          .filter((x) => x.gain > 0)
          .sort((a, b) => b.gain - a.gain);
        for (const { store, gain } of increases) {
          if (remaining <= 0) break;
          const attributed = Math.min(gain, remaining);
          ensureStore(store).restocked += attributed;
          remaining -= attributed;
        }
      } else {
        // Сумма не изменилась: считаем объём перемещений между магазинами
        let moved = 0;
        for (const store of Object.keys({ ...p!.byStore, ...c!.byStore })) {
          const sd = (p!.byStore[store] ?? 0) - (c!.byStore[store] ?? 0);
          if (sd > 0) moved += sd;
        }
        if (moved > 0) {
          mv.transferred += moved;
          totalTransferred += moved;
        }
      }
    }
  }

  for (const mv of movements.values()) {
    mv.currentTotal = mv.lastTotal;
    mv.soldOut = !mv.isNew && (mv.firstTotal > 0 || mv.sold > 0) && mv.currentTotal === 0;
  }

  const all = [...movements.values()];
  return {
    fromDate: sorted[0].date,
    toDate: sorted[sorted.length - 1].date,
    days,
    snapshotsCount: sorted.length,
    totalSold,
    totalRestocked,
    totalTransferred,
    soldOutProducts: all
      .filter((m) => m.soldOut)
      .sort((a, b) => b.sold - a.sold || a.name.localeCompare(b.name, 'ru')),
    topSold: all
      .filter((m) => m.sold > 0)
      .sort((a, b) => b.sold - a.sold || a.name.localeCompare(b.name, 'ru')),
    restockedProducts: all
      .filter((m) => m.restocked > 0)
      .sort((a, b) => b.restocked - a.restocked || a.name.localeCompare(b.name, 'ru')),
    byStore: [...storeAgg.values()].sort((a, b) => b.sold - a.sold),
    newProducts,
    removedProducts,
  };
}
