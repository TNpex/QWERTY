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
import { detectGender, getRestockMinimum, isPrioritySize } from './productMeta';

// ============ Константы аналитики (единый источник для UI и расчётов) ============

/** До какого остатка заполняем магазин-получатель при перемещении */
export const FILL_TO = 2;
/** Избыток в СПб-магазине: начиная с этого количества (т.е. «больше 3») */
export const SPB_EXCESS_TRIGGER = 4;
/** Избыток в магазине Екб/Тюмени/Уфы/Ижевска: «больше 2» */
export const CITY_EXCESS_TRIGGER = 3;
/** Сколько оставляет себе донор в СПб */
export const SPB_DONOR_KEEP = 3;
/** Сколько оставляет себе донор в других городах */
export const CITY_DONOR_KEEP = 2;
/** Максимум единиц в одном перемещении между магазинами */
export const TRANSFER_CAP = 3;
/** Ходовые размеры обуви (повышенный приоритет) */
export const POPULAR_SHOE_SIZES = ['41', '42', '42,5', '43', '43,5', '44'];

/** Сколько рекомендаций показывать в списке UI (KPI считаются по полному списку!) */
export const MAX_TRANSFER_DISPLAY = 50;
export const MAX_RESTOCK_DISPLAY = 100;
export const MAX_SALES_DISPLAY = 50;
/** Пороги «внимание»/«критично» для доли позиций без наличия, % */
export const OOS_WARN_PERCENT = 15;
export const OOS_BAD_PERCENT = 30;

const SHOE_CATEGORY_MARKERS = ['обувь', 'кроссовк', 'кед', 'ботинк', 'туфл'];

export function isShoeCategory(category: string): boolean {
  const lower = category.toLowerCase();
  return SHOE_CATEGORY_MARKERS.some((marker) => lower.includes(marker));
}

const SPB_CITY = 'Санкт-Петербург';

/** Порог избытка для магазина: СПб — ≥4 («больше 3»), прочие — ≥3 («больше 2») */
export function excessTrigger(storeName: string): number {
  return getStoreCity(storeName) === SPB_CITY ? SPB_EXCESS_TRIGGER : CITY_EXCESS_TRIGGER;
}

/** Неснижаемый остаток донора: СПб — 3, прочие — 2 */
export function donorKeep(storeName: string): number {
  return getStoreCity(storeName) === SPB_CITY ? SPB_DONOR_KEEP : CITY_DONOR_KEEP;
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
  /** Позиций (товар × размер × магазин), которые магазин возит */
  carriedSKUs: number;
  /** Возимых позиций с нулевым остатком */
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
  /** Позиции, которые реально возятся магазинами (без notCarried) */
  carriedSKUs: number;
  notCarriedSKUs: number;
  totalStock: number;
  /** Возимые позиции с нулевым остатком */
  outOfStockSizes: number;
  /** % от carriedSKUs — корректная доля «нет в наличии» */
  outOfStockPercent: number;
  totalValue: number;
  /** Товары с нулевым суммарным остатком по всей сети */
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

  const categoryMetrics: CategoryMetric[] = [...perCategory.entries()]
    .map(([category, agg]) => ({
      category,
      totalItems: agg.stock,
      carriedSKUs: agg.carried,
      outOfStock: agg.oos,
      outOfStockPercent: percent(agg.oos, agg.carried),
    }))
    .sort((a, b) => b.totalItems - a.totalItems);

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
 * Логика перемещений (правила владельца сети):
 *
 * 1. ИЗБЫТОК В МАГАЗИНЕ → ДЕФИЦИТ:
 *    - Екатеринбург / Тюмень / Уфа / Ижевск: позиция одного размера «больше 2» (≥3) —
 *      избыток; перемещаем в любой магазин, где её 0 или 1 (донор оставляет 2);
 *    - Санкт-Петербург: «больше 3» (≥4); донор оставляет 3;
 *    - получатель заполняется до 2 единиц.
 * 2. СКЛАД — БЕЗ ПРАВИЛ: если размер есть на складе, а в магазине 0–1,
 *    показываем вариант перемещения со склада (склад может уйти в ноль).
 * 3. ВАРИАТИВНОСТЬ: для одного дефицита показываются ОБА варианта —
 *    «из магазина с избытком» И «со склада» (optionGroup), приоритет не отдаётся складу.
 * 4. ЛОГИСТИКА: из СПб в другие города — дорого (route 'spb-expensive',
 *    UI скрывает по умолчанию и предлагает дозаказать у поставщика).
 * 5. ПРИОРИТЕТ: высокий — дефицит (0) приоритетного размера: у женщин S/M,
 *    у мужчин M/L, плюс ходовые размеры обуви 41–44.
 */
export function getTransferRecommendations(data: ParsedData): TransferRecommendation[] {
  const storeById = new Map(data.stores.map((s) => [s.id, s]));
  const { itemsByProduct } = buildIndex(data);
  const recommendations: TransferRecommendation[] = [];

  const warehouse = data.stores.find((s) => isWarehouse(s.name));
  const storesOrdered = sortStoresForDisplay(data.stores).filter((s) => s.id !== warehouse?.id);
  const cityRank = new Map(data.stores.map((s, i) => [s.id, i]));

  for (const product of data.products) {
    const items = itemsByProduct.get(product.id);
    if (!items || items.length === 0) continue;

    const gender = product.gender ?? detectGender(product.name, product.category);
    const shoe = isShoeCategory(product.category);
    const bySize = groupBySize(items);

    for (const [size, stock] of bySize) {
      if (stock.total === 0) continue;

      const prioritySize =
        isPrioritySize(gender, size) ||
        (shoe && POPULAR_SHOE_SIZES.includes(size.replace('.', ',')));

      // ---- Получатели: магазины, где размера 0 или 1 ----
      const recipients = storesOrdered
        .filter((s) => {
          const qty = stock.byStore.get(s.id);
          return qty !== undefined && qty <= 1;
        })
        .sort((a, b) => (cityRank.get(a.id) ?? 0) - (cityRank.get(b.id) ?? 0));
      if (recipients.length === 0) continue;

      const makeRec = (
        fromId: string,
        toId: string,
        quantity: number,
        reasonSuffix: string
      ): TransferRecommendation | null => {
        const fromStore = storeById.get(fromId);
        const toStore = storeById.get(toId);
        if (!fromStore || !toStore || quantity <= 0) return null;
        const route = getTransferRoute(fromStore.name, toStore.name);
        const toQty = stock.byStore.get(toId) ?? 0;
        const priority: TransferPriority =
          route === 'spb-expensive' || route === 'intercity'
            ? 'low'
            : toQty === 0 && prioritySize
              ? 'high'
              : 'medium';
        return {
          productId: product.id,
          productName: product.name,
          ...(product.link ? { productLink: product.link } : {}),
          brand: product.brand,
          category: product.category,
          ...(product.subtype ? { subtype: product.subtype } : {}),
          fromStore: fromStore.name,
          fromStoreId: fromId,
          toStore: toStore.name,
          toStoreId: toId,
          size,
          quantity,
          reason: `Размер ${size}: ${reasonSuffix}`,
          priority,
          route,
          fromQty: stock.byStore.get(fromId) ?? 0,
          toQty,
          optionGroup: `${product.id}|${size}|${toId}`,
        };
      };

      // ---- Вариант А: со склада (без правил) ----
      if (warehouse) {
        let warehouseAvailable = stock.byStore.get(warehouse.id) ?? 0;
        if (warehouseAvailable > 0) {
          for (const recipient of recipients) {
            if (warehouseAvailable <= 0) break;
            const need = FILL_TO - (stock.byStore.get(recipient.id) ?? 0);
            const move = Math.min(warehouseAvailable, need);
            const rec = makeRec(
              warehouse.id,
              recipient.id,
              move,
              `${move} шт. есть на складе, в «${recipient.name}» — ${stock.byStore.get(recipient.id) ?? 0} шт.`
            );
            if (rec) {
              recommendations.push(rec);
              warehouseAvailable -= move;
            }
          }
        }
      }

      // ---- Вариант Б: из магазинов с избытком ----
      const donors = storesOrdered
        .map((s) => {
          const qty = stock.byStore.get(s.id) ?? 0;
          const trigger = excessTrigger(s.name);
          return qty >= trigger ? { store: s, qty, donatable: qty - donorKeep(s.name) } : null;
        })
        .filter((d): d is { store: typeof storesOrdered[number]; qty: number; donatable: number } =>
          Boolean(d && d.donatable > 0)
        )
        .sort((a, b) => b.donatable - a.donatable);

      // Рабочие количества получателей — в рамках «магазинного» варианта
      const recipientWorking = new Map<string, number>();
      for (const r of recipients) recipientWorking.set(r.id, stock.byStore.get(r.id) ?? 0);

      for (const donor of donors) {
        let available = donor.donatable;
        if (available <= 0) continue;
        const donorCity = getStoreCity(donor.store.name);

        // Сначала свой город, затем остальные (СПб→другой город получит флаг «дорого»)
        const orderedRecipients = [...recipients].sort((a, b) => {
          const aSame = getStoreCity(a.name) === donorCity ? 0 : 1;
          const bSame = getStoreCity(b.name) === donorCity ? 0 : 1;
          return aSame - bSame;
        });

        for (const recipient of orderedRecipients) {
          if (available <= 0) break;
          if (recipient.id === donor.store.id) continue;
          const currentQty = recipientWorking.get(recipient.id) ?? 0;
          const need = FILL_TO - currentQty;
          if (need <= 0) continue;
          const move = Math.min(available, need, TRANSFER_CAP);
          if (move <= 0) continue;

          const rec = makeRec(
            donor.store.id,
            recipient.id,
            move,
            `переизбыток в «${donor.store.name}» (${donor.qty} шт.), ` +
              (currentQty === 0 ? 'отсутствует' : 'мало') + ` в «${recipient.name}»`
          );
          if (rec) {
            recommendations.push(rec);
            available -= move;
            recipientWorking.set(recipient.id, currentQty + move);
          }
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
  /** Сколько единиц сверх неснижаемого остатка */
  excess: number;
}

/**
 * Позиции с переизбытком в МАГАЗИНАХ (склад не участвует — он перемещается
 * без правил): СПб — ≥ 4 шт одного размера, прочие города — ≥ 3 шт.
 */
export function getOverstockPositions(data: ParsedData): OverstockPosition[] {
  const storeById = new Map(data.stores.map((s) => [s.id, s]));
  const productById = new Map(data.products.map((p) => [p.id, p]));
  const positions: OverstockPosition[] = [];

  for (const item of data.inventory) {
    if (item.notCarried) continue;
    const store = storeById.get(item.storeId);
    if (!store || isWarehouse(store.name)) continue;
    if (item.quantity < excessTrigger(store.name)) continue;
    const product = productById.get(item.productId);
    if (!product) continue;
    positions.push({
      productId: item.productId,
      productName: product.name,
      ...(product.link ? { productLink: product.link } : {}),
      brand: product.brand,
      storeId: item.storeId,
      storeName: store.name,
      size: item.size,
      quantity: item.quantity,
      excess: item.quantity - donorKeep(store.name),
    });
  }

  return positions.sort(
    (a, b) => b.excess - a.excess || a.productName.localeCompare(b.productName, 'ru')
  );
}

// ============ Дозакупка у поставщика ============

const URGENCY_ORDER: Record<RestockUrgency, number> = { critical: 0, high: 1, medium: 2 };

/**
 * Дозакупка по нормативам владельца (минимум на размер ПО ВСЕЙ СЕТИ):
 * - женская одежда: XXS 3, XS 4, S 11, M 11, L 3, XL 0;
 * - мужская одежда: XS 1, S 4, M 12, L 13, XL 8;
 * - детская одежда: XS 4, S 6, M 7, L 6, XL 4;
 * - женская обувь: 35:4, 36:5, 37:5, 38:8, 39:10, 40:8;
 * - мужская обувь: 41:8, 42:11, 42,5:11, 43:11, 43,5:11, 44:10, 44,5:8, 45:6, 46:3, 47:1;
 * - неизвестный пол или уникальный размер (сет/банка/ростовка и т.п.) — минимум 4.
 *
 * ХОДОВЫЕ ТОВАРЫ (hotRules, из public/data/hot-products.json): норматив
 * «minPerStore единиц в КАЖДОМ розничном магазине» (суммарно по размерам);
 * нехватка распределяется по размерам round-robin (популярные размеры первыми).
 *
 * Текущий остаток считается по всей сети (включая склад), поэтому покрытие
 * перемещением не требуется: нехватка относительно норматива — это чистый заказ.
 */
export function getRestockRecommendations(
  data: ParsedData,
  hotRules?: { article: string; minPerStore: number }[]
): RestockRecommendation[] {
  const { itemsByProduct } = buildIndex(data);
  const recommendations: RestockRecommendation[] = [];

  const hotByArticle = new Map<string, number>();
  for (const rule of hotRules ?? []) {
    const article = rule.article.trim().toLowerCase();
    if (article && rule.minPerStore > 0) hotByArticle.set(article, rule.minPerStore);
  }
  const retailStores = data.stores.filter((s) => !isWarehouse(s.name));

  for (const product of data.products) {
    const items = itemsByProduct.get(product.id);
    if (!items || items.length === 0) continue;

    const bySize = groupBySize(items);
    const hotMin = hotByArticle.get((product.article ?? '').trim().toLowerCase());

    // ---- Ходовой товар: минимум в каждом розничном магазине ----
    if (hotMin) {
      const storeTotals = new Map<string, number>();
      for (const item of items) {
        storeTotals.set(item.storeId, (storeTotals.get(item.storeId) ?? 0) + item.quantity);
      }
      let totalNeeded = 0;
      let currentStock = 0;
      for (const store of retailStores) {
        const have = storeTotals.get(store.id) ?? 0;
        currentStock += have;
        totalNeeded += Math.max(0, hotMin - have);
      }
      // Складской запас тоже учитываем в «сейчас» (он покрывает сеть)
      const warehouseStore = data.stores.find((s) => isWarehouse(s.name));
      if (warehouseStore) currentStock += storeTotals.get(warehouseStore.id) ?? 0;

      if (totalNeeded === 0) continue;

      // Распределение заказа по размерам: round-robin, популярные (с остатком) первыми
      const sizeOrder = [...bySize.entries()]
        .sort((a, b) => b[1].total - a[1].total || compareSizes(a[0], b[0]))
        .map(([size, stock]) => ({ size, current: stock.total, quantity: 0 }));
      if (sizeOrder.length === 0) sizeOrder.push({ size: '—', current: 0, quantity: 0 });
      let left = totalNeeded;
      let idx = 0;
      while (left > 0 && sizeOrder.length > 0) {
        sizeOrder[idx % sizeOrder.length].quantity++;
        left--;
        idx++;
      }
      const neededSizes = sizeOrder
        .filter((s) => s.quantity > 0)
        .map((s) => ({ size: s.size, quantity: s.quantity, target: s.current + s.quantity, current: s.current }))
        .sort((a, b) => compareSizes(a.size, b.size));

      const normTotal = hotMin * retailStores.length;
      const coveragePercent = normTotal > 0 ? Math.round((currentStock / normTotal) * 100) : 100;

      recommendations.push({
        productId: product.id,
        productName: product.name,
        ...(product.link ? { productLink: product.link } : {}),
        brand: product.brand,
        category: product.category,
        ...(product.subtype ? { subtype: product.subtype } : {}),
        gender: product.gender ?? detectGender(product.name, product.category),
        sizes: neededSizes,
        totalNeeded,
        transferCover: 0,
        toPurchase: totalNeeded,
        currentStock,
        coveragePercent,
        urgency: currentStock === 0 ? 'critical' : 'high',
        isHot: true,
        hotMinPerStore: hotMin,
      });
      continue;
    }

    // ---- Обычный товар: норматив на размер по всей сети ----
    const neededSizes: RestockRecommendation['sizes'] = [];
    let totalNeeded = 0;
    let currentStock = 0;
    let targetTotal = 0;
    let sizesFullyOut = 0;
    const gender = product.gender ?? detectGender(product.name, product.category);

    for (const [size, stock] of bySize) {
      const target = getRestockMinimum(gender, product.category, size);
      currentStock += stock.total;
      targetTotal += target;
      if (stock.total === 0) sizesFullyOut++;
      const needed = Math.max(0, target - stock.total);
      if (needed > 0) {
        neededSizes.push({ size, quantity: needed, target, current: stock.total });
        totalNeeded += needed;
      }
    }

    if (neededSizes.length === 0) continue;
    neededSizes.sort((a, b) => compareSizes(a.size, b.size));

    const coveragePercent = targetTotal > 0 ? Math.round((currentStock / targetTotal) * 100) : 100;
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
      ...(product.subtype ? { subtype: product.subtype } : {}),
      gender,
      sizes: neededSizes,
      totalNeeded,
      transferCover: 0,
      toPurchase: totalNeeded,
      currentStock,
      coveragePercent,
      urgency,
    });
  }

  return recommendations.sort(
    (a, b) =>
      (b.isHot ? 1 : 0) - (a.isHot ? 1 : 0) ||
      URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] ||
      b.toPurchase - a.toPurchase ||
      a.productName.localeCompare(b.productName, 'ru')
  );
}
