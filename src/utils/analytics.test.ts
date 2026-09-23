import { describe, it, expect } from 'vitest';
import type { ParsedData, InventoryItem } from '../types';
import {
  getMetrics,
  getTransferRecommendations,
  getRestockRecommendations,
  MIN_PER_STORE,
  TRANSFER_CAP,
} from './analyticsCore';

// ============ Фикстуры ============

function fixture(): ParsedData {
  const stores = [
    { id: 's1', name: 'Спб' },
    { id: 's2', name: 'Екб' },
    { id: 's3', name: 'Уфа' },
  ];
  const products = [
    { id: 'p1', name: 'Кроссовки Nike', brand: 'Nike', category: 'Обувь', price: 8990 },
    { id: 'p2', name: 'Мяч Wilson', brand: 'Wilson', category: 'Мячи', price: 3500 },
  ];
  const item = (
    productId: string,
    storeId: string,
    size: string,
    quantity: number,
    notCarried = false
  ): InventoryItem => ({
    productId,
    storeId,
    size,
    quantity,
    ...(notCarried ? { notCarried: true } : {}),
    lastUpdated: '2026-01-01T00:00:00.000Z',
  });

  const inventory: InventoryItem[] = [
    // p1, размер 42: Спб — 6 (избыток), Екб — 0 (дефицит), Уфа — 0 (дефицит)
    item('p1', 's1', '42', 6),
    item('p1', 's2', '42', 0),
    item('p1', 's3', '42', 0),
    // p1, размер 43: Спб — 1, Екб — 1, Уфа — не возит
    item('p1', 's1', '43', 1),
    item('p1', 's2', '43', 1),
    item('p1', 's3', '43', 0, true),
    // p2 (полностью отсутствует → critical дозакупка)
    item('p2', 's1', '—', 0),
    item('p2', 's2', '—', 0, true),
    item('p2', 's3', '—', 0),
  ];

  return { stores, products, inventory };
}

describe('getMetrics', () => {
  it('исключает notCarried из OOS и считает метрики за один проход', () => {
    const m = getMetrics(fixture());
    expect(m.totalProducts).toBe(2);
    expect(m.totalStock).toBe(6 + 1 + 1);
    // carried: 7 записей (2 notCarried исключены)
    expect(m.carriedSKUs).toBe(7);
    expect(m.notCarriedSKUs).toBe(2);
    // нули среди carried: p1/42@s2, p1/42@s3, p2@s1, p2@s3 → 4
    expect(m.outOfStockSizes).toBe(4);
    expect(m.outOfStockPercent).toBe(Math.round((4 / 7) * 100));
    // стоимость: 8990*8 + 3500*0
    expect(m.totalValue).toBe(8990 * 8);
  });

  it('метрики магазинов не учитывают не возящие позиции', () => {
    const m = getMetrics(fixture());
    const ufa = m.storeMetrics.find((s) => s.id === 's3')!;
    // Уфа возит: p1/42 (0) и p2 (0); p1/43 — notCarried
    expect(ufa.carriedSKUs).toBe(2);
    expect(ufa.outOfStock).toBe(2);
    expect(ufa.outOfStockPercent).toBe(100);
    expect(ufa.totalItems).toBe(0);
  });
});

describe('getTransferRecommendations', () => {
  it('жадно распределяет избыток без двойного обещания одного остатка', () => {
    const recs = getTransferRecommendations(fixture());
    const moves42 = recs.filter((r) => r.size === '42');

    // Донор Спб: 6 шт, avg = 2, floor = 2 → доступно 4; получатели Екб и Уфа (по fillTarget=2)
    expect(moves42).toHaveLength(2);
    const totalFromSpb = moves42.reduce((s, r) => s + r.quantity, 0);
    expect(totalFromSpb).toBe(4); // не больше доступного избытка!
    for (const r of moves42) {
      expect(r.fromStore).toBe('Спб');
      expect(r.quantity).toBeLessThanOrEqual(TRANSFER_CAP);
      expect(['Екб', 'Уфа']).toContain(r.toStore);
    }
  });

  it('ходовой размер обуви получает высокий приоритет', () => {
    const recs = getTransferRecommendations(fixture());
    expect(recs.find((r) => r.size === '42')?.priority).toBe('high');
  });

  it('notCarried-магазины не становятся получателями', () => {
    const recs = getTransferRecommendations(fixture());
    // Уфа не возит p1/43 → рекомендаций по 43 размеру вообще нет (избытка тоже нет)
    expect(recs.filter((r) => r.size === '43')).toHaveLength(0);
  });

  it('детерминированность: два вызова — идентичный результат', () => {
    const data = fixture();
    expect(getTransferRecommendations(data)).toEqual(getTransferRecommendations(data));
  });
});

describe('getRestockRecommendations', () => {
  it('critical, когда товара нет совсем', () => {
    const recs = getRestockRecommendations(fixture());
    const ball = recs.find((r) => r.productId === 'p2')!;
    expect(ball.urgency).toBe('critical');
    expect(ball.currentStock).toBe(0);
    // возящие магазины: s1, s3 (s2 — notCarried) → норматив 2*2=4 на размер
    expect(ball.totalNeeded).toBe(MIN_PER_STORE * 2);
  });

  it('норматив считается только по возящим магазинам', () => {
    const recs = getRestockRecommendations(fixture());
    const nike = recs.find((r) => r.productId === 'p1')!;
    // Возящие p1 магазины: s1, s2, s3 (s3 возит модель — у него есть carried-строка 42).
    // Норматив на размер = 2 × 3 = 6.
    // размер 42: total 6 → нужно 0; размер 43: total 2 (s3 не возит этот размер, но возит модель) → нужно 4
    expect(nike.sizes).toEqual([{ size: '43', quantity: 4 }]);
    expect(nike.totalNeeded).toBe(4);
    expect(nike.urgency).not.toBe('critical');
  });

  it('покрытие и срочность детерминированы (никакого Math.random)', () => {
    const data = fixture();
    const a = getRestockRecommendations(data);
    const b = getRestockRecommendations(data);
    expect(a).toEqual(b);
    for (const r of a) {
      expect(r.coveragePercent).toBeGreaterThanOrEqual(0);
      expect(r.coveragePercent).toBeLessThanOrEqual(100);
      expect(['critical', 'high', 'medium']).toContain(r.urgency);
    }
  });
});

describe('производительность (регрессия против O(n²))', () => {
  it('2000 товаров × 8 магазинов × 10 размеров обрабатываются быстрее 3 секунд', () => {
    const nProducts = 2000;
    const nStores = 8;
    const nSizes = 10;

    const stores = Array.from({ length: nStores }, (_, s) => ({
      id: `s${s}`,
      name: `Магазин ${s}`,
    }));
    const products = Array.from({ length: nProducts }, (_, p) => ({
      id: `p${p}`,
      name: `Товар ${p}`,
      brand: `Бренд ${p % 10}`,
      category: p % 2 === 0 ? 'Обувь' : 'Мячи',
      price: 5000,
    }));

    const inventory: InventoryItem[] = [];
    let counter = 0;
    for (let p = 0; p < nProducts; p++) {
      for (let s = 0; s < nStores; s++) {
        for (let z = 0; z < nSizes; z++) {
          inventory.push({
            productId: `p${p}`,
            storeId: `s${s}`,
            size: `${38 + z}`,
            quantity: counter++ % 5,
            lastUpdated: '',
          });
        }
      }
    }
    const data: ParsedData = { stores, products, inventory };

    const start = Date.now();
    const metrics = getMetrics(data);
    const transfers = getTransferRecommendations(data);
    const restocks = getRestockRecommendations(data);
    const elapsed = Date.now() - start;

    expect(metrics.totalStock).toBeGreaterThan(0);
    expect(Array.isArray(transfers)).toBe(true);
    expect(Array.isArray(restocks)).toBe(true);
    // Старая реализация на этом объёме выполнялась ~194 секунды
    expect(elapsed).toBeLessThan(3000);
  });
});
