import {
  buildOrderHash,
  cartLinesToText,
  orderUrl,
  resolveCartItems,
  type CartItemPayload,
  type CartLine,
  type CartMap,
} from './cart';

/**
 * Выбор позиций в заказ и их количества — ЧИСТАЯ логика (без React).
 *
 * Зачем отдельным модулем: раньше окно заказа хранило «снимок» списка
 * (готовый url + числа), а плавающая панель корзины лежит поверх окна —
 * правка количества в снимок уже не попадала, и на сайт уезжало 1 шт.
 * Теперь заказ каждый раз собирается из ТЕКУЩЕГО выбора (buildOrder),
 * поэтому счётчик в строке рекомендации, в плавающей панели и в окне заказа
 * показывает одно и то же число, и все три кнопки берут свежие значения.
 */

/** Ключ группы вариантов (товар + размер + получатель) → строка заказа */
export type OrderSelection = ReadonlyMap<string, CartLine>;

export const MIN_QTY = 1;
export const MAX_QTY = 99;

export function clampQty(value: number): number {
  const num = Math.round(Number(value));
  if (!Number.isFinite(num)) return MIN_QTY;
  return Math.min(MAX_QTY, Math.max(MIN_QTY, num));
}

/** Отметить/снять позицию (при отметке количество = рекомендованное, но не меньше 1) */
export function toggleLine(
  prev: OrderSelection,
  line: Omit<CartLine, 'quantity'> & { quantity?: number }
): Map<string, CartLine> {
  const next = new Map(prev);
  if (next.has(line.key)) {
    next.delete(line.key);
    return next;
  }
  next.set(line.key, {
    key: line.key,
    name: line.name,
    ...(line.link ? { link: line.link } : {}),
    size: line.size,
    quantity: clampQty(line.quantity ?? 1),
    toStore: line.toStore,
  });
  return next;
}

/** Изменить количество позиции (общее значение для всех трёх мест в UI) */
export function setLineQty(
  prev: OrderSelection,
  key: string,
  quantity: number
): Map<string, CartLine> {
  const line = prev.get(key);
  if (!line) return new Map(prev);
  const next = new Map(prev);
  next.set(key, { ...line, quantity: clampQty(quantity) });
  return next;
}

/** Убрать позицию из заказа */
export function removeLine(prev: OrderSelection, key: string): Map<string, CartLine> {
  if (!prev.has(key)) return new Map(prev);
  const next = new Map(prev);
  next.delete(key);
  return next;
}

/** Добавить все позиции товара в заказ (карточный вид «Перемещений»); уже отмеченные не трогает */
export function addLines(
  prev: OrderSelection,
  lines: (Omit<CartLine, 'quantity'> & { quantity?: number })[]
): Map<string, CartLine> {
  const next = new Map(prev);
  for (const line of lines) {
    if (next.has(line.key)) continue;
    next.set(line.key, {
      key: line.key,
      name: line.name,
      ...(line.link ? { link: line.link } : {}),
      size: line.size,
      quantity: clampQty(line.quantity ?? 1),
      toStore: line.toStore,
    });
  }
  return next;
}

/** Снять отметки со всех позиций товара (если они уже в заказе) */
export function dropLines(prev: OrderSelection, keys: string[]): Map<string, CartLine> {
  const next = new Map(prev);
  for (const key of keys) next.delete(key);
  return next;
}

export interface SelectionSummary {
  /** Позиций в заказе */
  positions: number;
  /** Штук суммарно */
  units: number;
}

export function summarizeSelection(selection: OrderSelection): SelectionSummary {
  let units = 0;
  for (const line of selection.values()) units += line.quantity;
  return { positions: selection.size, units };
}

/** Сколько позиций/штук выбрано внутри одного товара (для карточек) */
export function summarizeKeys(selection: OrderSelection, keys: string[]): SelectionSummary {
  let units = 0;
  let positions = 0;
  for (const key of keys) {
    const line = selection.get(key);
    if (!line) continue;
    positions++;
    units += line.quantity;
  }
  return { positions, units };
}

/** Всё, что нужно окну заказа — считается из текущего выбора в момент вызова */
export interface OrderDraft {
  /** Ссылка на корзину saletennis.com со свежим списком в #stcart */
  url: string;
  /** Позиции корзины (одинаковые itemId+size слиты, количества просуммированы) */
  items: CartItemPayload[];
  /** Позиций в корзине сайта (после слияния одинаковых размеров) */
  count: number;
  /** Штук в корзине сайта */
  units: number;
  /** Позиций, которые не удалось превратить в элементы корзины */
  missingCount: number;
  missing: { line: CartLine; reason: string }[];
  /** Текстовый список (копирование менеджеру) — те же свежие числа */
  text: string;
  /** Пусто ли (нечего заказывать) */
  empty: boolean;
  /** Hash-часть ссылки (#stcart=…) — для проверки и отладки */
  hash: string;
}

export function buildOrder(cartMap: CartMap | null, selection: OrderSelection): OrderDraft {
  const lines = [...selection.values()];
  const { items, missing } = resolveCartItems(cartMap, lines);
  const units = items.reduce((sum, item) => sum + item.count, 0);
  return {
    url: orderUrl(items),
    items,
    count: items.length,
    units,
    missingCount: missing.length,
    missing,
    text: cartLinesToText(lines),
    empty: lines.length === 0,
    hash: buildOrderHash(items),
  };
}
