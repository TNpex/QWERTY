import { describe, it, expect } from 'vitest';
import {
  availabilityTrend,
  abcClasses,
  deadStock,
  runwayDays,
  runwayLevel,
  salesByStoreFromHistory,
  sizeProfile,
  stockValueByStore,
  DEAD_STOCK_DAYS,
} from './insights';
import type { HistorySnapshot } from './historyCore';
import type { ParsedData } from '../types';

/** Снимок из двух товаров в двух магазинах */
function snapshot(date: string, matrix: Record<string, Record<string, number>>): HistorySnapshot {
  const stores = new Set<string>();
  for (const byStore of Object.values(matrix)) {
    for (const store of Object.keys(byStore)) stores.add(store);
  }
  return {
    date,
    stores: [...stores],
    products: new Map(
      Object.entries(matrix).map(([link, byStore]) => [
        link,
        {
          link,
          article: `art-${link}`,
          name: `Товар ${link}`,
          brand: 'B',
          category: 'Обувь',
          price: 1000,
          total: Object.values(byStore).reduce((a, b) => a + b, 0),
          byStore,
        },
      ])
    ),
  };
}

const history: HistorySnapshot[] = [
  snapshot('2026-09-01', {
    l1: { 'Уфа': 10, 'Ижевск': 0 },
    l2: { 'Уфа': 5, 'Ижевск': 5 },
  }),
  snapshot('2026-09-11', {
    l1: { 'Уфа': 6, 'Ижевск': 2 },
    l2: { 'Уфа': 5, 'Ижевск': 1 },
  }),
  snapshot('2026-09-21', {
    l1: { 'Уфа': 2, 'Ижевск': 2 },
    l2: { 'Уфа': 4, 'Ижевск': 0 },
  }),
];

describe('salesByStoreFromHistory', () => {
  it('считает продажи по убыванию остатков точек', () => {
    const sales = salesByStoreFromHistory(history);
    expect(sales).not.toBeNull();
    expect(sales!.days).toBe(20);
    const l1 = sales!.byProduct.get('l1')!;
    // (10-6)+(0-→2 не продажа)+(6-2)+(2-2)=4+4=8
    expect(l1.total).toBe(8);
    expect(l1.byStore.get('Уфа')).toBe(8);
    const l2 = sales!.byProduct.get('l2')!;
    // Уфа: 0+1=1, Ижевск: 4+1=5
    expect(l2.total).toBe(6);
    expect(l2.byStore.get('Ижевск')).toBe(5);
    expect(l2.lastSaleDate).toBe('2026-09-21');
  });

  it('меньше двух снимков — null', () => {
    expect(salesByStoreFromHistory([history[0]])).toBeNull();
    expect(salesByStoreFromHistory([])).toBeNull();
  });
});

describe('runway', () => {
  it('полка пуста — 0 дней', () => {
    expect(runwayDays(0, 5, 10)).toBe(0);
    expect(runwayLevel(0, null)).toBe('out');
  });

  it('остаток / скорость продаж, округленно', () => {
    // 10 шт, продавалось 5 шт за 10 дней = 0.5/день → 20 дней
    expect(runwayDays(10, 5, 10)).toBe(20);
    expect(runwayLevel(10, 20)).toBe('mid');
    expect(runwayLevel(10, 7)).toBe('low');
    expect(runwayLevel(10, 100)).toBe('ok');
  });

  it('продаж не было — null и уровень «не продаётся»', () => {
    expect(runwayDays(10, 0, 10)).toBeNull();
    expect(runwayLevel(10, null)).toBe('idle');
  });
});

describe('abcClasses', () => {
  it('A — первые 80% продаж, C — без продаж', () => {
    const sales = salesByStoreFromHistory(history)!;
    const cls = abcClasses(sales);
    // l1: 8 продаж, l2: 6 → всего 14; l1 даёт 57% → A, l2 замыкает → C
    expect(cls.get('l1')).toBe('A');
    expect(cls.get('l2')).toBe('C');
    expect(cls.get('неизвестный')).toBeUndefined();
  });

  it('без истории классов нет', () => {
    expect(abcClasses(null).size).toBe(0);
  });
});

describe('stockValueByStore', () => {
  it('цена × количество по точкам, вне ассортимента не считается', () => {
    const data: ParsedData = {
      source: 'upload',
      stores: [
        { id: 's1', name: 'Уфа' },
        { id: 's2', name: 'Ижевск' },
      ],
      products: [{ id: 'p1', name: 'Т', brand: 'B', category: 'Обувь', price: 100, link: 'l1' }],
      inventory: [
        { productId: 'p1', storeId: 's1', size: '42', quantity: 3 },
        { productId: 'p1', storeId: 's2', size: '42', quantity: 0 },
        { productId: 'p1', storeId: 's2', size: '43', quantity: 7, notCarried: true },
      ],
      warnings: [],
    };
    const rows = stockValueByStore(data);
    expect(rows.find((r) => r.name === 'Уфа')).toMatchObject({ units: 3, value: 300 });
    expect(rows.find((r) => r.name === 'Ижевск')).toMatchObject({ units: 0, value: 0 });
  });
});

describe('availabilityTrend', () => {
  it('доля нулей среди возимых позиций по снимкам', () => {
    const trend = availabilityTrend(history);
    expect(trend).toHaveLength(3);
    // 2026-09-01: 4 позиции, 1 ноль → 25%
    expect(trend[0].networkOosPercent).toBe(25);
    expect(trend[0].byStore['Ижевск']).toBe(50);
    // 2026-09-21: 4 позиции, 1 ноль → 25%
    expect(trend[2].networkOosPercent).toBe(25);
  });
});

describe('deadStock', () => {
  const data: ParsedData = {
    source: 'upload',
    stores: [{ id: 's1', name: 'Уфа' }],
    products: [
      { id: 'p1', name: 'Продаётся', brand: 'B', category: 'Обувь', price: 10, link: 'l1' },
      { id: 'p2', name: 'Мёртвый', brand: 'B', category: 'Обувь', price: 20, link: 'lX' },
      { id: 'p3', name: 'Распродан', brand: 'B', category: 'Обувь', price: 30, link: 'l2' },
    ],
    inventory: [
      { productId: 'p1', storeId: 's1', size: '42', quantity: 2 },
      { productId: 'p2', storeId: 's1', size: '42', quantity: 4 },
      { productId: 'p3', storeId: 's1', size: '42', quantity: 0 },
    ],
    warnings: [],
  };

  it('в список попадает товар с остатком без продаж; распроданный — нет', () => {
    const sales = salesByStoreFromHistory(history)!;
    const rows = deadStock(data, sales, sales.toDate);
    expect(rows.map((r) => r.product.id)).toEqual(['p2']);
    expect(rows[0].value).toBe(80);
    expect(rows[0].daysSinceSale).toBeNull();
  });

  it('товар с давней продажей старше порога — тоже мёртвый', () => {
    const sales = salesByStoreFromHistory(history)!;
    // последняя продажа l1 — 2026-09-21; «сегодня» на 61 день позже
    const late = '2026-11-21';
    expect(DEAD_STOCK_DAYS).toBe(60);
    const rows = deadStock(
      { ...data, products: data.products.filter((p) => p.id === 'p1') },
      sales,
      late
    );
    expect(rows.map((r) => r.product.id)).toEqual(['p1']);
    expect(rows[0].daysSinceSale).toBe(61);
  });
});

describe('sizeProfile', () => {
  it('сопоставляет остаток точки и спрос сети по размерам', () => {
    const data: ParsedData = {
      source: 'upload',
      stores: [{ id: 's1', name: 'Уфа' }],
      products: [{ id: 'p1', name: 'Т', brand: 'B', category: 'Обувь', price: 10, link: 'l1' }],
      inventory: [
        { productId: 'p1', storeId: 's1', size: '42', quantity: 8 },
        { productId: 'p1', storeId: 's1', size: '44', quantity: 2 },
      ],
      warnings: [],
    };
    const rows = sizeProfile(
      data,
      {
        entries: [
          { link: 'l1', size: '42', sold: 1 },
          { link: 'l1', size: '44', sold: 9 },
        ],
      },
      'Уфа'
    );
    // 44-й выметают (90% продаж), а на полке его 20% → большой разрыв
    expect(rows[0].size).toBe('44');
    expect(rows[0].gap).toBe(70);
    expect(rows[1].gap).toBe(-70);
  });
});
