import type { ParsedData, Product } from '../types';
import { isWarehouse } from './storeGroups';
import { sportOf } from './sport';
import { profileOf, type StoreAssortmentSource } from './storeRules';

/**
 * «Обзор»: честные числа по сети или по одному магазину.
 *
 * Единица учёта — ПОЗИЦИЯ: товар × размер × магазин, который этот товар возит.
 * «—» (магазин не возит товар, notCarried) в знаменатель не попадает: это не
 * дефицит, а отсутствие товара в ассортименте точки.
 *
 * Область (scope):
 * - 'all' — 🌐 вся сеть;
 * - название магазина — его собственный обзор (позиции, артикулы, остатки,
 *   стоимость считаются только по нему).
 *
 * Профиль магазина (вид спорта / скрытые категории) сужает ассортимент точки:
 * такие позиции не попадают в её знаменатель, а их количество видно отдельно
 * (hiddenByProfile) — цифры объяснимы.
 */

export type OverviewScope = 'all' | string;

export const ALL_SCOPE: OverviewScope = 'all';

export interface PositionCount {
  /** Позиции, которые магазин возит (знаменатель) */
  carried: number;
  /** Позиции с наличием (≥1 шт.) */
  inStock: number;
  /** Позиции без наличия (0 шт.) */
  outOfStock: number;
}

export interface StoreOverviewRow extends PositionCount {
  storeId: string;
  storeName: string;
  isWarehouse: boolean;
  /** Штук в наличии */
  stock: number;
  /** Стоимость остатков, ₽ */
  value: number;
  /** Артикулов в ассортименте точки */
  products: number;
  /** Артикулов с наличием */
  productsInStock: number;
  /** Распроданные артикулы (нет ни одной штуки) */
  soldOutProducts: number;
  /** Позиции, скрытые профилем магазина (вид спорта / категория) */
  hiddenByProfile: number;
}

export interface CategoryAvailability {
  category: string;
  inStock: number;
  outOfStock: number;
  carried: number;
}

export interface OverviewMetrics {
  scope: OverviewScope;
  scopeLabel: string;
  isStore: boolean;
  positions: PositionCount;
  /** Позиции, исключённые профилем магазина (только для области магазина) */
  hiddenByProfile: number;
  /** Артикулов в области */
  products: number;
  /** Артикулов с наличием */
  productsInStock: number;
  /** Распроданных артикулов (нет ни одной штуки в области) */
  soldOutProducts: number;
  /** Остаток, шт. */
  stock: number;
  /** Стоимость остатков, ₽ */
  value: number;
  /** Разрез по магазинам («86 / 100 позиций с наличием») */
  stores: StoreOverviewRow[];
  /** Разрез по категориям (стековая диаграмма «с наличием / без наличия») */
  categories: CategoryAvailability[];
  /** Дата снимка остатков */
  asOf?: string;
}

export interface OverviewOptions {
  scope?: OverviewScope;
  /** Правила магазинов (профили + ручные ориентации товаров) */
  settings?: StoreAssortmentSource;
}

const EMPTY_SETTINGS: StoreAssortmentSource = {
  storeProfiles: {},
  storeMinimums: {},
  sportOverrides: {},
};

/** Доля, % (0, если знаменатель пуст) — для подписи под дробью */
export function sharePercent(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

/** Позиция входит в ассортимент точки по её профилю (вид спорта + категории) */
function inStoreAssortment(
  settings: StoreAssortmentSource,
  storeName: string,
  product: Product
): boolean {
  const profile = profileOf(settings, storeName);
  if (profile.sport === 'all' && profile.hiddenCategories.length === 0) return true;
  if (profile.hiddenCategories.includes(product.category)) return false;
  if (profile.sport === 'all') return true;
  const sport = sportOf(product, settings.sportOverrides);
  return sport === profile.sport || sport === 'other';
}

export function computeOverview(data: ParsedData, options: OverviewOptions = {}): OverviewMetrics {
  const settings = options.settings ?? EMPTY_SETTINGS;
  const scope = options.scope ?? ALL_SCOPE;
  const productById = new Map(data.products.map((p) => [p.id, p]));
  const storeById = new Map(data.stores.map((s) => [s.id, s]));

  // ---- Агрегаты по магазинам ----
  interface Agg {
    carried: number;
    inStock: number;
    outOfStock: number;
    stock: number;
    value: number;
    hiddenByProfile: number;
    products: Set<string>;
    productsInStock: Set<string>;
  }
  const perStore = new Map<string, Agg>();
  for (const store of data.stores) {
    perStore.set(store.id, {
      carried: 0,
      inStock: 0,
      outOfStock: 0,
      stock: 0,
      value: 0,
      hiddenByProfile: 0,
      products: new Set(),
      productsInStock: new Set(),
    });
  }

  // ---- Агрегаты области (вся сеть или один магазин) ----
  const scopeAgg: Agg = {
    carried: 0,
    inStock: 0,
    outOfStock: 0,
    stock: 0,
    value: 0,
    hiddenByProfile: 0,
    products: new Set(),
    productsInStock: new Set(),
  };
  const perCategory = new Map<string, { inStock: number; outOfStock: number }>();
  /** Остаток по товару в области (для «распроданных артикулов») */
  const productTotals = new Map<string, number>();

  const isAllScope = scope === ALL_SCOPE;
  const scopeStore = isAllScope ? undefined : data.stores.find((s) => s.name === scope);
  const scopeStoreId = scopeStore?.id ?? null;

  for (const item of data.inventory) {
    if (item.notCarried) continue;
    const product = productById.get(item.productId);
    const store = storeById.get(item.storeId);
    if (!product || !store) continue;

    const storeAgg = perStore.get(item.storeId);
    const inScope = isAllScope || item.storeId === scopeStoreId;
    const fitsAssortment = inStoreAssortment(settings, store.name, product);

    if (storeAgg) {
      if (!fitsAssortment) {
        storeAgg.hiddenByProfile++;
      } else {
        storeAgg.carried++;
        storeAgg.stock += item.quantity;
        storeAgg.value += product.price * item.quantity;
        if (item.quantity > 0) storeAgg.inStock++;
        else storeAgg.outOfStock++;
        const key = product.id;
        storeAgg.products.add(key);
        if (item.quantity > 0) storeAgg.productsInStock.add(key);
      }
    }

    if (!inScope || !fitsAssortment) {
      if (inScope) scopeAgg.hiddenByProfile++;
      continue;
    }

    scopeAgg.carried++;
    scopeAgg.stock += item.quantity;
    scopeAgg.value += product.price * item.quantity;
    if (item.quantity > 0) scopeAgg.inStock++;
    else scopeAgg.outOfStock++;

    const key = product.id;
    scopeAgg.products.add(key);
    if (item.quantity > 0) scopeAgg.productsInStock.add(key);
    productTotals.set(key, (productTotals.get(key) ?? 0) + item.quantity);

    let cat = perCategory.get(product.category);
    if (!cat) {
      cat = { inStock: 0, outOfStock: 0 };
      perCategory.set(product.category, cat);
    }
    if (item.quantity > 0) cat.inStock++;
    else cat.outOfStock++;
  }

  // ---- Артикулы области ----
  // «Вся сеть»: все товары каталога, даже без единой строчки остатков —
  // товар без строк так же распродан, как товар с нулями.
  // Магазин: только те товары, которые он возит (notCarried / нет строки = не возит).
  const scopeProducts = new Set<string>();
  if (isAllScope) {
    for (const product of data.products) scopeProducts.add(product.id);
  } else {
    for (const key of scopeAgg.products) scopeProducts.add(key);
  }
  let soldOutProducts = 0;
  let productsInStock = 0;
  for (const key of scopeProducts) {
    if ((productTotals.get(key) ?? 0) > 0) productsInStock++;
    else soldOutProducts++;
  }

  const stores: StoreOverviewRow[] = data.stores.map((store) => {
    const agg = perStore.get(store.id)!;
    return {
      storeId: store.id,
      storeName: store.name,
      isWarehouse: isWarehouse(store.name),
      carried: agg.carried,
      inStock: agg.inStock,
      outOfStock: agg.outOfStock,
      stock: agg.stock,
      value: agg.value,
      products: agg.products.size,
      productsInStock: agg.productsInStock.size,
      soldOutProducts: agg.products.size - agg.productsInStock.size,
      hiddenByProfile: agg.hiddenByProfile,
    };
  });

  const categories: CategoryAvailability[] = [...perCategory.entries()]
    .map(([category, agg]) => ({
      category,
      inStock: agg.inStock,
      outOfStock: agg.outOfStock,
      carried: agg.inStock + agg.outOfStock,
    }))
    .sort((a, b) => b.carried - a.carried || a.category.localeCompare(b.category, 'ru'));

  return {
    scope,
    scopeLabel: isAllScope ? '🌐 Вся сеть' : scopeStore?.name ?? scope,
    isStore: !isAllScope,
    positions: {
      carried: scopeAgg.carried,
      inStock: scopeAgg.inStock,
      outOfStock: scopeAgg.outOfStock,
    },
    hiddenByProfile: scopeAgg.hiddenByProfile,
    products: scopeProducts.size,
    productsInStock,
    soldOutProducts,
    stock: scopeAgg.stock,
    value: scopeAgg.value,
    stores,
    categories,
    ...(data.asOf ? { asOf: data.asOf } : {}),
  };
}

/** Итоговая строка таблицы сравнения магазинов */
export function totalsRow(rows: StoreOverviewRow[]): StoreOverviewRow {
  const total: StoreOverviewRow = {
    storeId: 'total',
    storeName: 'Итого по сети',
    isWarehouse: false,
    carried: 0,
    inStock: 0,
    outOfStock: 0,
    stock: 0,
    value: 0,
    products: 0,
    productsInStock: 0,
    soldOutProducts: 0,
    hiddenByProfile: 0,
  };
  for (const row of rows) {
    total.carried += row.carried;
    total.inStock += row.inStock;
    total.outOfStock += row.outOfStock;
    total.stock += row.stock;
    total.value += row.value;
    total.products += row.products;
    total.productsInStock += row.productsInStock;
    total.soldOutProducts += row.soldOutProducts;
    total.hiddenByProfile += row.hiddenByProfile;
  }
  return total;
}

/** «86 из 100» — короткая подпись доли позиций с наличием */
export function shareLabel(part: number, total: number): string {
  return `${part} из ${total}`;
}
