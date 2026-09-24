import { describe, it, expect } from 'vitest';
import { applyBrandOverrides, pruneAppliedOverrides } from './overrides';
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

describe('pruneAppliedOverrides', () => {
  const data: ParsedData = {
    stores: [{ id: 's1', name: 'Уфа' }],
    products: [
      // бренд в данных уже совпадает с правкой (правку зафиксировали в CSV)
      { id: 'p1', name: 'Толстовка Diadora Hoodie Core', brand: 'Diadora', category: 'Одежда', price: 100, article: 'DR1021' },
      { id: 'p2', name: 'Футболка Diadora SS Score', brand: 'Diadora', category: 'Одежда', price: 100, article: 'DR1021' },
      // правка ещё нужна: бренд в данных другой
      { id: 'p3', name: 'Шорты Court Heritage', brand: 'Не определен', category: 'Одежда', price: 100, article: 'FZ6951-110' },
    ],
    inventory: [],
  };

  it('убираает правки, которые уже отражены в данных', () => {
    const { kept, removed } = pruneAppliedOverrides(data, {
      DR1021: 'Diadora',
      'FZ6951-110': 'Nike',
    });
    expect(removed).toBe(1);
    expect(kept).toEqual({ 'FZ6951-110': 'Nike' });
  });

  it('правку не убирает, если хотя бы один товар артикула носит другой бренд', () => {
    const mixed: ParsedData = {
      ...data,
      products: [
        { id: 'p1', name: 'Толстовка Diadora', brand: 'Diadora', category: 'Одежда', price: 100, article: 'DR1021' },
        { id: 'p2', name: 'Футболка Diadora', brand: 'Не определен', category: 'Одежда', price: 100, article: 'DR1021' },
      ],
    };
    const { kept, removed } = pruneAppliedOverrides(mixed, { DR1021: 'Diadora' });
    expect(removed).toBe(0);
    expect(kept).toEqual({ DR1021: 'Diadora' });
  });

  it('правки для отсутствующих в данных товаров сохраняются (товар может вернуться)', () => {
    const { kept, removed } = pruneAppliedOverrides(data, { 'НЕТ-В-ДАННЫХ': 'Head' });
    expect(removed).toBe(0);
    expect(kept).toEqual({ 'НЕТ-В-ДАННЫХ': 'Head' });
  });

  it('без данных ничего не убирает; регистр артикула не важен', () => {
    expect(pruneAppliedOverrides(null, { A1: 'Head' }).removed).toBe(0);
    const { removed } = pruneAppliedOverrides(data, { dr1021: 'Diadora' });
    expect(removed).toBe(1);
  });
});
