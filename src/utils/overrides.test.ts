import { describe, it, expect } from 'vitest';
import { applyBrandOverrides } from './overrides';
import type { ParsedData } from '../types';

describe('applyBrandOverrides', () => {
  const data: ParsedData = {
    stores: [{ id: 's1', name: 'Уфа' }],
    products: [
      { id: 'p1', name: 'Шорты Court Heritage', brand: 'Не определен', category: 'Одежда', price: 100, article: 'FZ6951-110' },
      { id: 'p2', name: 'Шорты Court Heritage (другой цвет)', brand: 'Не определен', category: 'Одежда', price: 100, article: 'FZ6951-110' },
      { id: 'p3', name: 'Ракетка Head', brand: 'Head', category: 'Ракетки', price: 200, article: 'H1' },
    ],
    inventory: [],
  };

  it('правит бренд у всех товаров с тем же артикулом', () => {
    const result = applyBrandOverrides(data, { 'FZ6951-110': 'Nike' });
    expect(result.products.find((p) => p.id === 'p1')!.brand).toBe('Nike');
    expect(result.products.find((p) => p.id === 'p2')!.brand).toBe('Nike');
    expect(result.products.find((p) => p.id === 'p3')!.brand).toBe('Head');
  });

  it('регистр артикула не важен; пустые правки не трогают данные', () => {
    const result = applyBrandOverrides(data, { 'fz6951-110': 'Nike' });
    expect(result.products.find((p) => p.id === 'p1')!.brand).toBe('Nike');
    expect(applyBrandOverrides(data, {})).toBe(data);
  });
});
