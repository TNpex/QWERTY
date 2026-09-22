import type {
  ParsedData,
  Product,
  InventoryItem,
  TransferRecommendation,
  TransferPriority,
  RestockRecommendation,
  RestockUrgency,
} from '../types';
import { compareSizes } from './sizes';

// ============ Константы аналитики (единый источник для UI и расчётов) ============

/** Норматив запаса: единиц на каждый ВОЗЯЩИЙ магазин на каждый размер */
export const MIN_PER_STORE = 2;
/** Максимум единиц в одном перемещении */
export const TRANSFER_CAP = 3;
/** Сколько рекомендаций показывать в списке UI (KPI считаются по полному списку!) */
export const MAX_TRANSFER_DISPLAY = 50;
/** Порог «внимание» для доли OOS, % */
export const OOS_WARN_PERCENT = 15;
/** Порог «критично» для доли OOS, % */
export const OOS_BAD_PERCENT = 30;
/** Ходовые размеры (влияют на приоритет перемещения) */
export const POPULAR_SIZES = ['41', '42', '43', '44', 'M', 'L', 'XL'];

const SHOE_CATEGORY_MARKERS = ['обувь', 'кроссовк', 'кед', 'ботинк', 'туфл'];

export function isShoeCategory(category: string): boolean {
  const lower = category.toLowerCase();
  return SHOE_CATEGORY_MARKERS.some((marker) => lower.includes(marker));
}

export type OosLevel = 'ok' | 'warn' | 'bad';

export function oosLevel(percent: number): OosLevel {
  if (percent > OOS_BAD_PERCENT) return 'bad';
  if (percent > OOS_WARN_PERCENT) return 'warn';
  return 'ok';
}

// ============ Индексы (основа производительности) ============

export interface ProductIndex {
  productById: Map<string, Product>;
  /** Только «возящие» записи (notCarried исключены), сгруппированные по товару */
  itemsByProduct: Map<string, InventoryItem[]>;
}

/**
 * Единовременное построение индексов — O(N) вместо inventory.find() во вложенных
 * циклах (O(P·S·M·N), который на 2000 товаров выполнялся ~3 минуты).
 */
export function buildIndex(data: ParsedData): ProductIndex {
  const productById = new Map(data.products.map((p) => [p.id, p]));
  const itemsByProduct = new Map<string, InventoryItem[]>();
  for (const item of data.inventory) {
    if (item.notCarried) continue;
    const arr = itemsByProduct.get(item.productId);
    if (arr) arr.push(item);
    else itemsByProduct.set(item.productId, [item]);
  }
  return { productById, itemsByProduct };
}

// ============ Метрики ============

export interface StoreMetric {
  id: string;
  name: string;
  /** Единиц товара в наличии */
  totalItems: number;
  /** SKU-позиций, которые магазин возит */
  carriedSKUs: number;
  /** Возимых SKU-позиций с нулевым остатком */
  outOfStock: number;
  outOfStockPercent: number;
}

export interface CategoryMetric {
  category: string;
  totalItems: number;
  carriedSKUs: number;
  outOfStock: number;
  outOfStockPercent: number;
}

export interface Metrics {
  totalProducts: number;
  totalSKUs: number;
  /** SKU-позиции, которые реально возятся магазинами (без notCarried) */
  carriedSKUs: number;
  notCarriedSKUs: number;
  totalStock: number;
  /** Возимые SKU с нулевым остатком */
  outOfStockSizes: number;
  /** % от carriedSKUs — корректная доля «нет в наличии» */
  outOfStockPercent: number;
  totalValue: number;
  storeMetrics: StoreMetric[];
  categoryMetrics: CategoryMetric[];
}

/** Все метрики — за один проход по inventory, O(N) */
export function getMetrics(data: ParsedData): Metrics {
  const { stores, products, inventory } = data;
  const productById = new Map(products.map((p) => [p.id, p]));

  let totalStock = 0;
  let totalValue = 0;
  let carriedSKUs = 0;
  let notCarriedSKUs = 0;
  let outOfStockSizes = 0;

  const perStore = new Map<string, { stock: number; carried: number; oos: number }>();
  for (const store of stores) perStore.set(store.id, { stock: 0, carried: 0, oos: 0 });

  const perCategory = new Map<string, { stock: number; carried: number; oos: number }>();

  for (const item of inventory) {
    if (item.notCarried) {
      notCarriedSKUs++;
      continue;
    }
    carriedSKUs++;
    totalStock += item.quantity;
    if (item.quantity === 0) outOfStockSizes++;

    const product = productById.get(item.productId);
    if (product) totalValue += product.price * item.quantity;

    const storeAgg = perStore.get(item.storeId);
    if (storeAgg) {
      storeAgg.stock += item.quantity;
      storeAgg.carried++;
      if (item.quantity === 0) storeAgg.oos++;
    }

    const category = product?.category ?? 'Другое';
    let catAgg = perCategory.get(category);
    if (!catAgg) {
      catAgg = { stock: 0, carried: 0, oos: 0 };
      perCategory.set(category, catAgg);
    }
    catAgg.stock += item.quantity;
    catAgg.carried++;
    if (item.quantity === 0) catAgg.oos++;
  }

  const percent = (oos: number, carried: number) =>
    carried > 0 ? Math.round((oos / carried) * 100) : 0;

  const storeMetrics: StoreMetric[] = stores.map((store) => {
    const agg = perStore.get(store.id) ?? { stock: 0, carried: 0, oos: 0 };
    return {
      id: store.id,
      name: store.name,
      totalItems: agg.stock,
      carriedSKUs: agg.carried,
      outOfStock: agg.oos,
      outOfStockPercent: percent(agg.oos, agg.carried),
    };
  });

  const categoryMetrics: CategoryMetric[] = [...perCategory.entries()].map(
    ([category, agg]) => ({
      category,
      totalItems: agg.stock,
      carriedSKUs: agg.carried,
      outOfStock: agg.oos,
      outOfStockPercent: percent(agg.oos, agg.carried),
    })
  );

  return {
    totalProducts: products.length,
    totalSKUs: inventory.length,
    carriedSKUs,
    notCarriedSKUs,
    totalStock,
    outOfStockSizes,
    outOfStockPercent: percent(outOfStockSizes, carriedSKUs),
    totalValue,
    storeMetrics,
    categoryMetrics,
  };
}

// ============ Перемещения между магазинами ============

interface SizeStock {
  /** storeId → количество (только возящие магазины) */
  byStore: Map<string, number>;
  total: number;
}

function groupBySize(items: InventoryItem[]): Map<string, SizeStock> {
  const bySize = new Map<string, SizeStock>();
  for (const item of items) {
    let entry = bySize.get(item.size);
    if (!entry) {
      entry = { byStore: new Map(), total: 0 };
      bySize.set(item.size, entry);
    }
    entry.byStore.set(item.storeId, (entry.byStore.get(item.storeId) ?? 0) + item.quantity);
    entry.total += item.quantity;
  }
  return bySize;
}

const PRIORITY_ORDER: Record<TransferPriority, number> = { high: 0, medium: 1, low: 2 };

/**
 * Жадный алгоритм перемещений с учётом уже распределённых остатков:
 * - донор оставляет себе не меньше ceil(среднего) и не больше TRANSFER_CAP в одни руки;
 * - каждый остаток «обещается» только один раз (прошлая версия могла распределить
 *   один и тот же запас нескольким магазинам);
 * - получатели — только магазины с нулём, которые ВОЗЯТ товар (notCarried исключены);
 * - список НЕ обрезается — KPI считаются по полному списку, обрезает только UI.
 */
export function getTransferRecommendations(data: ParsedData): TransferRecommendation[] {
  const storeById = new Map(data.stores.map((s) => [s.id, s]));
  const { itemsByProduct } = buildIndex(data);
  const recommendations: TransferRecommendation[] = [];

  for (const product of data.products) {
    const items = itemsByProduct.get(product.id);
    if (!items || items.length === 0) continue;

    const shoe = isShoeCategory(product.category);
    const bySize = groupBySize(items);

    for (const [size, stock] of bySize) {
      if (stock.total === 0) continue;

      const carryingCount = stock.byStore.size;
      const avg = stock.total / carryingCount;
      const donorFloor = Math.ceil(avg); // ниже этого донор не отдаёт
      const fillTarget = Math.max(1, Math.round(avg)); // сколько докладываем в нулевой магазин

      const donors = [...stock.byStore.entries()]
        .filter(([, qty]) => qty > donorFloor)
        .map(([storeId, qty]) => ({ storeId, available: qty - donorFloor }))
        .sort((a, b) => b.available - a.available);

      const recipients = [...stock.byStore.entries()]
        .filter(([, qty]) => qty === 0)
        .map(([storeId]) => storeId);

      if (donors.length === 0 || recipients.length === 0) continue;

      const popular = POPULAR_SIZES.includes(size.toUpperCase());
      const priority: TransferPriority = popular && shoe ? 'high' : popular ? 'medium' : 'low';

      for (const toStoreId of recipients) {
        let need = fillTarget;
        for (const donor of donors) {
          if (need <= 0) break;
          if (donor.available <= 0) continue;

          const quantity = Math.min(donor.available, need, TRANSFER_CAP);
          if (quantity <= 0) continue;

          const fromStore = storeById.get(donor.storeId);
          const toStore = storeById.get(toStoreId);
          if (!fromStore || !toStore || fromStore.id === toStore.id) continue;

          donor.available -= quantity;
          need -= quantity;

          recommendations.push({
            productId: product.id,
            productName: product.name,
            fromStore: fromStore.name,
            toStore: toStore.name,
            size,
            quantity,
            reason: `Размер ${size}: нет в «${toStore.name}», избыток в «${fromStore.name}»`,
            priority,
          });
        }
      }
    }
  }

  return recommendations.sort(
    (a, b) =>
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      b.quantity - a.quantity ||
      a.productName.localeCompare(b.productName, 'ru')
  );
}

// ============ Дозакупка у поставщика ============

const URGENCY_ORDER: Record<RestockUrgency, number> = { critical: 0, high: 1, medium: 2 };

/**
 * Детерминированные рекомендации по дозакупке (без Math.random — прошлая версия
 * выдавала случайные «продажи в день» и «дни до исчерпания»):
 * - норматив: MIN_PER_STORE единиц на каждый возящий магазин на размер;
 * - critical: суммарный остаток товара равен нулю;
 * - high: покрытие норматива < 50% ИЛИ более половины размеров с нулём по сети;
 * - medium: остальное.
 * Когда появится история продаж, сюда можно добавить честный прогноз дней до stockout.
 */
export function getRestockRecommendations(data: ParsedData): RestockRecommendation[] {
  const { itemsByProduct } = buildIndex(data);
  const recommendations: RestockRecommendation[] = [];

  for (const product of data.products) {
    const items = itemsByProduct.get(product.id);
    if (!items || items.length === 0) continue;

    const carryingStores = new Set(items.map((i) => i.storeId));
    const normPerSize = MIN_PER_STORE * carryingStores.size;

    const bySize = groupBySize(items);
    const neededSizes: { size: string; quantity: number }[] = [];
    let totalNeeded = 0;
    let currentStock = 0;
    let sizesFullyOut = 0;

    for (const [size, stock] of bySize) {
      currentStock += stock.total;
      if (stock.total === 0) sizesFullyOut++;
      const needed = Math.max(0, normPerSize - stock.total);
      if (needed > 0) {
        neededSizes.push({ size, quantity: needed });
        totalNeeded += needed;
      }
    }

    if (neededSizes.length === 0) continue;
    neededSizes.sort((a, b) => compareSizes(a.size, b.size));

    const normTotal = normPerSize * bySize.size;
    const coveragePercent = normTotal > 0 ? Math.round((currentStock / normTotal) * 100) : 100;

    const urgency: RestockUrgency =
      currentStock === 0
        ? 'critical'
        : coveragePercent < 50 || sizesFullyOut * 2 >= bySize.size
          ? 'high'
          : 'medium';

    recommendations.push({
      productId: product.id,
      productName: product.name,
      brand: product.brand,
      sizes: neededSizes,
      totalNeeded,
      currentStock,
      coveragePercent,
      urgency,
    });
  }

  return recommendations.sort(
    (a, b) =>
      URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] ||
      b.totalNeeded - a.totalNeeded ||
      a.productName.localeCompare(b.productName, 'ru')
  );
}
