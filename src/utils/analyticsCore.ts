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
import {
  isWarehouse,
  getStoreCity,
  getTransferRoute,
  sortStoresForDisplay,
  type TransferRoute,
} from './storeGroups';

// ============ Константы аналитики (единый источник для UI и расчётов) ============

/** Норматив запаса: единиц на каждый ВОЗЯЩИЙ магазин на каждый размер */
export const MIN_PER_STORE = 2;
/** Максимум единиц в одном перемещении между магазинами */
export const TRANSFER_CAP = 3;
/** Избыток в магазине: начиная с этого количества размер считается «переизбытком» */
export const STORE_EXCESS_TRIGGER = 4;
/** Сколько единиц донор-магазин оставляет себе при перемещении избытка */
export const DONOR_KEEP = 3;
/** Получатель с таким остатком (или нулём) считается «мало» */
export const RECIPIENT_LOW = 1;
/** Сколько рекомендаций показывать в списке UI (KPI считаются по полному списку!) */
export const MAX_TRANSFER_DISPLAY = 50;
export const MAX_RESTOCK_DISPLAY = 100;
export const MAX_SALES_DISPLAY = 50;
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
  /** Товары с нулевым суммарным остатком по всей сети (включая товары без строк остатков) */
  soldOutProducts: number;
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

  const totalByProduct = new Map<string, number>();

  for (const item of inventory) {
    if (item.notCarried) {
      notCarriedSKUs++;
      continue;
    }
    carriedSKUs++;
    totalStock += item.quantity;
    if (item.quantity === 0) outOfStockSizes++;
    totalByProduct.set(item.productId, (totalByProduct.get(item.productId) ?? 0) + item.quantity);

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

  // Распродано: товар с нулевым суммарным остатком (либо вообще без строк остатков)
  let soldOutProducts = 0;
  for (const product of products) {
    if ((totalByProduct.get(product.id) ?? 0) === 0) soldOutProducts++;
  }

  return {
    totalProducts: products.length,
    totalSKUs: inventory.length,
    carriedSKUs,
    notCarriedSKUs,
    totalStock,
    outOfStockSizes,
    outOfStockPercent: percent(outOfStockSizes, carriedSKUs),
    totalValue,
    soldOutProducts,
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
const ROUTE_ORDER: Record<TransferRoute, number> = {
  warehouse: 0,
  'same-city': 1,
  intercity: 2,
  'spb-expensive': 3,
};

/**
 * Логика перемещений (бизнес-правила сети):
 *
 * 1. СКЛАД → МАГАЗИНЫ: если размер лежит на складе, а в магазине его нет (0) —
 *    везём со склада до норматива MIN_PER_STORE. Это основной поток.
 * 2. ИЗБЫТОК → ДЕФИЦИТ: если в магазине ≥ STORE_EXCESS_TRIGGER единиц одного
 *    размера (переизбыток), часть (не трогая DONOR_KEEP) перемещается в магазины,
 *    где этого размера нет (0) или мало (≤ RECIPIENT_LOW).
 * 3. ЛОГИСТИКА: маршрут классифицируется — «со склада», «внутри города» (дёшево),
 *    «между городами» (платно) и «из СПб в другой город» (дорого — UI скрывает
 *    такие рекомендации по умолчанию и предлагает дозаказать у поставщика).
 * 4. Остатки учитываются жадно: одна единица не «обещается» дважды, движения
 *    фазы 1 применяются к рабочим количествам до фазы 2.
 */
export function getTransferRecommendations(data: ParsedData): TransferRecommendation[] {
  const storeById = new Map(data.stores.map((s) => [s.id, s]));
  const { itemsByProduct } = buildIndex(data);
  const recommendations: TransferRecommendation[] = [];

  const warehouse = data.stores.find((s) => isWarehouse(s.name));
  // Порядок перебора: сначала города по группам (склад — последний, но он донор фазы 1)
  const storesOrdered = sortStoresForDisplay(data.stores);

  for (const product of data.products) {
    const items = itemsByProduct.get(product.id);
    if (!items || items.length === 0) continue;

    const shoe = isShoeCategory(product.category);
    const bySize = groupBySize(items);

    for (const [size, stock] of bySize) {
      if (stock.total === 0) continue;

      const popular = POPULAR_SIZES.includes(size.toUpperCase());
      // Рабочие количества — мутируются по мере «обещания» единиц
      const working = new Map(stock.byStore);

      const pushRec = (
        fromId: string,
        toId: string,
        quantity: number,
        priority: TransferPriority,
        reasonSuffix: string
      ) => {
        const fromStore = storeById.get(fromId);
        const toStore = storeById.get(toId);
        if (!fromStore || !toStore || quantity <= 0) return;
        recommendations.push({
          productId: product.id,
          productName: product.name,
          ...(product.link ? { productLink: product.link } : {}),
          fromStore: fromStore.name,
          fromStoreId: fromId,
          toStore: toStore.name,
          toStoreId: toId,
          size,
          quantity,
          reason: `Размер ${size}: ${reasonSuffix}`,
          priority,
          route: getTransferRoute(fromStore.name, toStore.name),
          fromQty: stock.byStore.get(fromId) ?? 0,
          toQty: stock.byStore.get(toId) ?? 0,
        });
      };

      // ---- Фаза 1: склад → магазины, где размера НЕТ ----
      if (warehouse && (working.get(warehouse.id) ?? 0) > 0) {
        const warehouseCity = getStoreCity(warehouse.name);
        const recipients = storesOrdered
          .filter((s) => s.id !== warehouse.id && working.has(s.id) && (working.get(s.id) ?? 0) === 0)
          .sort((a, b) => {
            const aSame = getStoreCity(a.name) === warehouseCity ? 0 : 1;
            const bSame = getStoreCity(b.name) === warehouseCity ? 0 : 1;
            return aSame - bSame;
          });

        for (const recipient of recipients) {
          const available = working.get(warehouse.id) ?? 0;
          if (available <= 0) break;
          const move = Math.min(available, MIN_PER_STORE);
          pushRec(
            warehouse.id,
            recipient.id,
            move,
            popular && shoe ? 'high' : 'medium',
            `есть на складе, отсутствует в «${recipient.name}»`
          );
          working.set(warehouse.id, available - move);
          working.set(recipient.id, move);
        }
      }

      // ---- Фаза 2: избытки магазинов (≥ STORE_EXCESS_TRIGGER) → где нет/мало ----
      const donors = storesOrdered
        .filter((s) => s.id !== warehouse?.id && (working.get(s.id) ?? 0) >= STORE_EXCESS_TRIGGER)
        .map((s) => ({ store: s, donatable: (working.get(s.id) ?? 0) - DONOR_KEEP }))
        .filter((d) => d.donatable > 0)
        .sort((a, b) => b.donatable - a.donatable);

      for (const donor of donors) {
        let available = donor.donatable;
        if (available <= 0) continue;

        const donorCity = getStoreCity(donor.store.name);
        const recipients = storesOrdered
          .filter((s) => {
            if (s.id === donor.store.id || s.id === warehouse?.id) return false;
            const qty = working.get(s.id);
            return qty !== undefined && qty <= RECIPIENT_LOW;
          })
          .sort((a, b) => {
            const aSame = getStoreCity(a.name) === donorCity ? 0 : 1;
            const bSame = getStoreCity(b.name) === donorCity ? 0 : 1;
            return aSame - bSame;
          });

        for (const recipient of recipients) {
          if (available <= 0) break;
          const recipientQty = working.get(recipient.id) ?? 0;
          const need = MIN_PER_STORE - recipientQty;
          const move = Math.min(available, need, TRANSFER_CAP);
          if (move <= 0) continue;

          const route = getTransferRoute(donor.store.name, recipient.name);
          const priority: TransferPriority =
            route === 'spb-expensive' || route === 'intercity'
              ? 'low'
              : recipientQty === 0 && popular
                ? 'high'
                : 'medium';

          pushRec(
            donor.store.id,
            recipient.id,
            move,
            priority,
            `переизбыток в «${donor.store.name}» (${stock.byStore.get(donor.store.id) ?? 0} шт.), ` +
              (recipientQty === 0 ? 'отсутствует' : 'мало') +
              ` в «${recipient.name}»`
          );
          available -= move;
          working.set(donor.store.id, (working.get(donor.store.id) ?? 0) - move);
          working.set(recipient.id, recipientQty + move);
        }
      }
    }
  }

  return recommendations.sort(
    (a, b) =>
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      ROUTE_ORDER[a.route] - ROUTE_ORDER[b.route] ||
      b.quantity - a.quantity ||
      a.productName.localeCompare(b.productName, 'ru')
  );
}

// ============ Переизбыток ============

export interface OverstockPosition {
  productId: string;
  productName: string;
  productLink?: string;
  brand: string;
  storeId: string;
  storeName: string;
  size: string;
  quantity: number;
  /** Сколько единиц сверх неснижаемого остатка (quantity − DONOR_KEEP) */
  excess: number;
}

/** Позиции с переизбытком: ≥ STORE_EXCESS_TRIGGER единиц одного размера в магазине */
export function getOverstockPositions(data: ParsedData): OverstockPosition[] {
  const storeById = new Map(data.stores.map((s) => [s.id, s]));
  const productById = new Map(data.products.map((p) => [p.id, p]));
  const positions: OverstockPosition[] = [];

  for (const item of data.inventory) {
    if (item.notCarried || item.quantity < STORE_EXCESS_TRIGGER) continue;
    const product = productById.get(item.productId);
    if (!product) continue;
    positions.push({
      productId: item.productId,
      productName: product.name,
      ...(product.link ? { productLink: product.link } : {}),
      brand: product.brand,
      storeId: item.storeId,
      storeName: storeById.get(item.storeId)?.name ?? '',
      size: item.size,
      quantity: item.quantity,
      excess: item.quantity - DONOR_KEEP,
    });
  }

  return positions.sort(
    (a, b) => b.excess - a.excess || a.productName.localeCompare(b.productName, 'ru')
  );
}

// ============ Дозакупка у поставщика ============

const URGENCY_ORDER: Record<RestockUrgency, number> = { critical: 0, high: 1, medium: 2 };

/**
 * Детерминированные рекомендации по дозакупке (без Math.random):
 * - норматив: MIN_PER_STORE единиц на каждый возящий магазин на размер;
 * - НОВОЕ: перед заказом проверяем, можно ли покрыть дефицит ПЕРЕМЕЩЕНИЕМ —
 *   со склада (товар лежит там) или из переизбытка других магазинов
 *   (≥ STORE_EXCESS_TRIGGER, отдадут без DONOR_KEEP). Что покрыть нельзя —
 *   в колонку «заказать» (toPurchase);
 * - critical: суммарный остаток товара равен нулю;
 * - high: покрытие норматива < 50% ИЛИ более половины размеров с нулём по сети;
 * - medium: остальное.
 */
export function getRestockRecommendations(data: ParsedData): RestockRecommendation[] {
  const { itemsByProduct } = buildIndex(data);
  const recommendations: RestockRecommendation[] = [];

  const warehouse = data.stores.find((s) => isWarehouse(s.name));

  for (const product of data.products) {
    const items = itemsByProduct.get(product.id);
    if (!items || items.length === 0) continue;

    const carryingStores = new Set(items.map((i) => i.storeId));
    const normPerSize = MIN_PER_STORE * carryingStores.size;

    const bySize = groupBySize(items);
    const neededSizes: RestockRecommendation['sizes'] = [];
    let totalNeeded = 0;
    let totalCover = 0;
    let currentStock = 0;
    let sizesFullyOut = 0;

    for (const [size, stock] of bySize) {
      currentStock += stock.total;
      if (stock.total === 0) sizesFullyOut++;

      const needed = Math.max(0, normPerSize - stock.total);
      if (needed > 0) {
        // Чем можно покрыть дефицит перемещением:
        // 1) запас этого размера на складе;
        // 2) избытки размера в магазинах (≥ STORE_EXCESS_TRIGGER, отдают без DONOR_KEEP).
        const warehouseQty =
          warehouse && carryingStores.has(warehouse.id) ? stock.byStore.get(warehouse.id) ?? 0 : 0;
        let donorExcess = 0;
        for (const [storeId, qty] of stock.byStore) {
          if (storeId === warehouse?.id) continue;
          if (qty >= STORE_EXCESS_TRIGGER) donorExcess += qty - DONOR_KEEP;
        }
        const transferCover = Math.min(needed, warehouseQty + donorExcess);
        const toPurchase = needed - transferCover;

        neededSizes.push({ size, quantity: needed, transferCover, toPurchase });
        totalNeeded += needed;
        totalCover += transferCover;
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
      ...(product.link ? { productLink: product.link } : {}),
      brand: product.brand,
      category: product.category,
      sizes: neededSizes,
      totalNeeded,
      transferCover: totalCover,
      toPurchase: totalNeeded - totalCover,
      currentStock,
      coveragePercent,
      urgency,
    });
  }

  return recommendations.sort(
    (a, b) =>
      URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] ||
      b.toPurchase - a.toPurchase ||
      b.totalNeeded - a.totalNeeded ||
      a.productName.localeCompare(b.productName, 'ru')
  );
}
