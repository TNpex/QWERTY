import { describe, it, expect } from 'vitest';
import {
  countAvailability,
  matchesAvailability,
  stockStatus,
  STOCK_STATUS_HINTS,
  STOCK_STATUS_LABELS,
} from './availability';

describe('статус наличия: «Отсутствует» против «Распродан»', () => {
  it('нет ни одной штуки в сети → распродан (даже если в магазине «0»)', () => {
    expect(stockStatus(0, null)).toBe('soldOut');
    expect(stockStatus(0, 0)).toBe('soldOut');
  });

  it('в магазине ноль, но в других точках есть → отсутствует, НЕ распродан', () => {
    expect(stockStatus(7, 0)).toBe('missing');
    expect(stockStatus(1, 0)).toBe('missing');
  });

  it('есть в магазине → в наличии', () => {
    expect(stockStatus(7, 3)).toBe('inStock');
    expect(stockStatus(3, 3)).toBe('inStock');
  });

  it('область «вся сеть» (store = null): ноль в сети → распродан, иначе в наличии', () => {
    expect(stockStatus(0, null)).toBe('soldOut');
    expect(stockStatus(5, null)).toBe('inStock');
    // «missing» без выбранного магазина не бывает
    expect([stockStatus(0, null), stockStatus(5, null)]).not.toContain('missing');
  });

  it('отрицательные и нечисловые остатки трактуются как ноль', () => {
    expect(stockStatus(-3, null)).toBe('soldOut');
    expect(stockStatus(4, -1)).toBe('missing');
  });

  it('подписи статусов', () => {
    expect(STOCK_STATUS_LABELS).toEqual({
      inStock: 'В наличии',
      missing: 'Отсутствует',
      soldOut: 'Распродан',
    });
    expect(STOCK_STATUS_HINTS.missing).toContain('есть в других точках');
    expect(STOCK_STATUS_HINTS.soldOut).toContain('ни в магазинах, ни на складе');
  });
});

describe('фильтр наличия', () => {
  it('«Все» пропускает любой статус, остальное — только свой', () => {
    expect(matchesAvailability('inStock', 'all')).toBe(true);
    expect(matchesAvailability('missing', 'all')).toBe(true);
    expect(matchesAvailability('soldOut', 'all')).toBe(true);
    expect(matchesAvailability('missing', 'missing')).toBe(true);
    expect(matchesAvailability('missing', 'soldOut')).toBe(false);
    expect(matchesAvailability('soldOut', 'inStock')).toBe(false);
  });

  it('счётчики для подписей фильтра', () => {
    expect(
      countAvailability(['inStock', 'inStock', 'missing', 'soldOut', 'inStock'])
    ).toEqual({ all: 5, inStock: 3, missing: 1, soldOut: 1 });
    expect(countAvailability([])).toEqual({ all: 0, inStock: 0, missing: 0, soldOut: 0 });
  });
});
