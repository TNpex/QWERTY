/**
 * Статус наличия товара — отдельно от того, «везде ноль» или «нет только здесь».
 *
 * Раньше в «Инвентаре» при выбранном магазине любой товар с нулём в этой точке
 * помечался «Распродано», хотя на других точках он лежал. Теперь три статуса:
 * - inStock  — есть (в выбранной области);
 * - missing  — «Отсутствует»: нет в этом магазине, но ЕСТЬ в других точках сети;
 * - soldOut  — «Распродан»: нет ни одной штуки нигде (включая склад).
 */

export type StockStatus = 'inStock' | 'missing' | 'soldOut';

/** Фильтр наличия в «Инвентаре»: все / в наличии / отсутствует в магазине / распроданные */
export type AvailabilityFilter = 'all' | StockStatus;

export const STOCK_STATUS_LABELS: Record<StockStatus, string> = {
  inStock: 'В наличии',
  missing: 'Отсутствует',
  soldOut: 'Распродан',
};

export const STOCK_STATUS_HINTS: Record<StockStatus, string> = {
  inStock: 'Есть в выбранной области',
  missing: 'Нет в этом магазине, но есть в других точках сети',
  soldOut: 'Нет ни одной штуки нигде — ни в магазинах, ни на складе',
};

/**
 * Статус товара.
 * @param networkTotal остаток по всей сети (включая склад)
 * @param storeTotal   остаток в выбранном магазине; null — область «вся сеть»
 */
export function stockStatus(networkTotal: number, storeTotal: number | null): StockStatus {
  if (!(networkTotal > 0)) return 'soldOut';
  if (storeTotal !== null && !(storeTotal > 0)) return 'missing';
  return 'inStock';
}

export function matchesAvailability(
  status: StockStatus,
  filter: AvailabilityFilter
): boolean {
  return filter === 'all' || filter === status;
}

/** Счётчики для подписей фильтра («Все (N)», «В наличии (N)», …) */
export interface AvailabilityCounts {
  all: number;
  inStock: number;
  missing: number;
  soldOut: number;
}

export function countAvailability(statuses: StockStatus[]): AvailabilityCounts {
  const counts: AvailabilityCounts = {
    all: statuses.length,
    inStock: 0,
    missing: 0,
    soldOut: 0,
  };
  for (const status of statuses) counts[status]++;
  return counts;
}
