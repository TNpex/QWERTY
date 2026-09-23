import { describe, it, expect } from 'vitest';
import type { ParsedData, InventoryItem, Product, Store } from '../types';
import {
  getMetrics,
  getTransferRecommendations,
  getRestockRecommendations,
  getOverstockPositions,
  excessTrigger,
  donorKeep,
} from './analyticsCore';

// ============ Фикстуры ============

const STORES: Store[] = [
  { id: 'spb1', name: 'Санкт-Петербург (Спортивная)' },
  { id: 'spb2', name: 'Санкт-Петербург (Ярослава Гашека)' },
  { id: 'ekb1', name: 'Екатеринбург (Парина)' },
  { id: 'ufa', name: 'Уфа' },
  { id: 'w', name: 'Екатеринбург (Основной склад)' },
];

function fixture(): ParsedData {
  const products: Product[] = [
    { id: 'p1', name: 'Кроссовки женские Nike Vapor', brand: 'Nike', category: 'Обувь', price: 8990 },
    { id: 'p2', name: 'Юбка женская 7/6 Kris', brand: '7/6', category: 'Одежда', price: 5990 },
    { id: 'p3', name: 'Футболка мужская Mizuno', brand: 'Mizuno', category: 'Одежда', price: 2933 },
    { id: 'p4', name: 'Струна Solinco Hyper-G', brand: 'Solinco', category: 'Теннисные струны', price: 1500 },
    { id: 'p5', name: 'Мяч Wilson (распродан)', brand: 'Wilson', category: 'Мячи для тенниса', price: 900 },
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
    lastUpdated: '',
  });

  const inventory: InventoryItem[] = [
    // p1 кроссовки женские, 39 (ходовой размер обуви): склад 1, еkb 0, уфа 0
    item('p1', 'w', '39', 1),
    item('p1', 'ekb1', '39', 0),
    item('p1', 'ufa', '39', 0),
    item('p1', 'spb1', '39', 0, true),

    // p2 юбка женская, S (приоритетный женский размер):
    // spb1 4 (избыток СПб ≥4), spb2 1 (получатель), ekb1 3 (избыток ≥3), ufa 0, склад 5
    item('p2', 'spb1', 'S', 4),
    item('p2', 'spb2', 'S', 1),
    item('p2', 'ekb1', 'S', 3),
    item('p2', 'ufa', 'S', 0),
    item('p2', 'w', 'S', 5),
    // p2 M: spb1 1, ekb1 1, остальные не возят M
    item('p2', 'spb1', 'M', 1),
    item('p2', 'ekb1', 'M', 1),
    item('p2', 'spb2', 'M', 0, true),
    item('p2', 'ufa', 'M', 0, true),
    item('p2', 'w', 'M', 0, true),

    // p3 футболка мужская M (приоритетный мужской): spb1 5 (избыток), ufa 0 → spb-expensive
    item('p3', 'spb1', 'M', 5),
    item('p3', 'ufa', 'M', 0),

    // p4 струна «сет»: ekb1 3, ufa 1 → перемещение 1 шт; сеть = 4 = норматив → дозакупки нет
    item('p4', 'ekb1', 'сет', 3),
    item('p4', 'ufa', 'сет', 1),

    // p5 мяч — распродан (строк нет)
  ];

  return { stores: STORES, products, inventory };
}

describe('правила избытка по городам', () => {
  it('СПб: больше 3 (≥4), донор оставляет 3', () => {
    expect(excessTrigger('Санкт-Петербург (Спортивная)')).toBe(4);
    expect(donorKeep('Санкт-Петербург (Спортивная)')).toBe(3);
  });
  it('Екб/Тюмень/Уфа/Ижевск: больше 2 (≥3), донор оставляет 2', () => {
    expect(excessTrigger('Екатеринбург (Парина)')).toBe(3);
    expect(donorKeep('Екатеринбург (Парина)')).toBe(2);
    expect(excessTrigger('Уфа')).toBe(3);
    expect(excessTrigger('Тюмень (Народная)')).toBe(3);
    expect(excessTrigger('Ижевск')).toBe(3);
  });
});

describe('getMetrics', () => {
  it('считает остатки, OOS и распроданные товары', () => {
    const m = getMetrics(fixture());
    expect(m.totalProducts).toBe(5);
    // carried-строки: p1 3, p2 7, p3 2, p4 2 = 14; notCarried: 1 + 3 = 4
    expect(m.carriedSKUs).toBe(14);
    expect(m.notCarriedSKUs).toBe(4);
    expect(m.totalStock).toBe(1 + 4 + 1 + 3 + 0 + 5 + 1 + 1 + 5 + 0 + 3 + 1);
    expect(m.soldOutProducts).toBe(1); // p5 без строк
  });
});

describe('getTransferRecommendations: новые правила', () => {
  const recs = getTransferRecommendations(fixture());

  it('склад → магазин без правил: вариант со склада показан для всех дефицитов', () => {
    const whRecs = recs.filter((r) => r.route === 'warehouse');
    // склад p2/S = 5: spb2 (нужно 1) и ufa (нужно 2) → оба варианта
    const p2s = whRecs.filter((r) => r.productId === 'p2' && r.size === 'S');
    expect(p2s.length).toBe(2);
    expect(p2s.reduce((s, r) => s + r.quantity, 0)).toBe(3); // 1 + 2, склад не истощён
    // склад p1/39 = 1: только одному получателю (запас кончился)
    const p1w = whRecs.filter((r) => r.productId === 'p1');
    expect(p1w.length).toBe(1);
    expect(p1w[0].quantity).toBe(1);
  });

  it('вариативность: один дефицит — несколько альтернатив (магазин И склад)', () => {
    // p2/S в Уфу: вариант со склада (2 шт) и вариант из Екб-Парина (1 шт)
    const toUfa = recs.filter((r) => r.productId === 'p2' && r.size === 'S' && r.toStoreId === 'ufa');
    const routes = toUfa.map((r) => r.route).sort();
    expect(routes).toEqual(['intercity', 'warehouse']);
    // одна группа вариантов
    expect(new Set(toUfa.map((r) => r.optionGroup)).size).toBe(1);
  });

  it('избыток СПб (>3) остаётся в городе, если дефицит там же', () => {
    // spb1 S=4 → spb2 S=1: внутри города, 1 шт (донор оставляет 3)
    const spbMove = recs.find(
      (r) => r.productId === 'p2' && r.size === 'S' && r.fromStoreId === 'spb1' && r.toStoreId === 'spb2'
    );
    expect(spbMove).toBeDefined();
    expect(spbMove!.route).toBe('same-city');
    expect(spbMove!.quantity).toBe(1);
  });

  it('избыток не-СПб (>2) → межгород с флагом intercity', () => {
    // ekb1 S=3 → ufa S=0: 1 шт (donorKeep=2), intercity
    const ekbMove = recs.find(
      (r) => r.productId === 'p2' && r.size === 'S' && r.fromStoreId === 'ekb1' && r.toStoreId === 'ufa'
    );
    expect(ekbMove).toBeDefined();
    expect(ekbMove!.route).toBe('intercity');
    expect(ekbMove!.quantity).toBe(1);
    expect(ekbMove!.priority).toBe('low');
  });

  it('СПб → другой город помечается spb-expensive (дорого)', () => {
    // p3 M: spb1=5 (>3, donatable 2) → ufa=0
    const expensive = recs.filter((r) => r.route === 'spb-expensive');
    expect(expensive.length).toBeGreaterThan(0);
    const p3move = expensive.find((r) => r.productId === 'p3');
    expect(p3move).toBeDefined();
    expect(p3move!.quantity).toBe(2); // 5 − 3 (СПб оставляет три)
    expect(p3move!.priority).toBe('low');
  });

  it('высокий приоритет: нуль у получателя + приоритетный размер (жен S/M, муж M/L, обувь 41-44)', () => {
    // p1/39: обувь 39 не в 41-44 → не high; p2/S в Уфу (0 + женский S) → high
    const ufaS = recs.find(
      (r) => r.productId === 'p2' && r.size === 'S' && r.toStoreId === 'ufa' && r.route === 'warehouse'
    );
    expect(ufaS!.priority).toBe('high');
    // spb2 S=1 (не ноль) → medium
    const spb2s = recs.find(
      (r) => r.productId === 'p2' && r.size === 'S' && r.toStoreId === 'spb2' && r.route === 'warehouse'
    );
    expect(spb2s!.priority).toBe('medium');
  });

  it('не обещает один остаток дважды (в рамках магазинного варианта)', () => {
    // spb1 по p2/S отдал только 1 (4 − 3)
    const fromSpb1 = recs.filter((r) => r.fromStoreId === 'spb1' && r.productId === 'p2' && r.size === 'S');
    expect(fromSpb1.reduce((s, r) => s + r.quantity, 0)).toBeLessThanOrEqual(1);
  });

  it('каждая рекомендация содержит категорию, количества и группу вариантов', () => {
    for (const r of recs) {
      expect(r.category).toBeTruthy();
      expect(typeof r.fromQty).toBe('number');
      expect(typeof r.toQty).toBe('number');
      expect(r.optionGroup).toBeTruthy();
    }
  });

  it('детерминированность', () => {
    expect(getTransferRecommendations(fixture())).toEqual(recs);
  });
});

describe('getOverstockPositions', () => {
  it('переизбыток по правилам городов, склад исключён', () => {
    const overstock = getOverstockPositions(fixture());
    // spb1 p2/S = 4 ≥ 4 → excess 1
    const spb = overstock.find((p) => p.storeId === 'spb1' && p.size === 'S');
    expect(spb?.excess).toBe(1);
    // ekb1 p2/S = 3 ≥ 3 → excess 1
    const ekb = overstock.find((p) => p.storeId === 'ekb1' && p.size === 'S');
    expect(ekb?.excess).toBe(1);
    // spb1 p3/M = 5 → excess 2
    const p3 = overstock.find((p) => p.productId === 'p3');
    expect(p3?.excess).toBe(2);
    // склад исключён, хотя там 5
    expect(overstock.find((p) => p.storeId === 'w')).toBeUndefined();
    // spb2 S=1 и ekb1 p4 'сет'=3 → 'сет' ≥3 → excess 1
    expect(overstock.find((p) => p.productId === 'p4')).toBeDefined();
  });
});

describe('getRestockRecommendations: нормативы сети по размерам', () => {
  const rec = (name: string, category: string, size: string, networkTotal: number) => {
    const data: ParsedData = {
      stores: [{ id: 'a', name: 'Магазин А' }, { id: 'w', name: 'Екатеринбург (Основной склад)' }],
      products: [{ id: 'p', name, brand: 'B', category, price: 100 }],
      inventory: [
        { productId: 'p', storeId: 'a', size, quantity: networkTotal, lastUpdated: '' },
        { productId: 'p', storeId: 'w', size, quantity: 0, lastUpdated: '' },
      ],
    };
    return getRestockRecommendations(data)[0];
  };

  it('женская одежда: S минимум 11', () => {
    const r = rec('Юбка женская Test', 'Одежда', 'S', 7);
    expect(r.sizes[0]).toEqual({ size: 'S', quantity: 4, target: 11, current: 7 });
    expect(r.toPurchase).toBe(4);
    expect(r.gender).toBe('female');
  });

  it('женская одежда: XL минимум 0 — дозакупка не нужна', () => {
    expect(rec('Юбка женская Test', 'Одежда', 'XL', 0)).toBeUndefined();
  });

  it('мужская одежда: L минимум 13', () => {
    const r = rec('Футболка мужская Test', 'Одежда', 'L', 5);
    expect(r.sizes[0].target).toBe(13);
    expect(r.sizes[0].quantity).toBe(8);
    expect(r.gender).toBe('male');
  });

  it('детская одежда: M минимум 7 («для девочек» → дети)', () => {
    const r = rec('Капри для девочек Test', 'Одежда', 'M', 2);
    expect(r.gender).toBe('kids');
    expect(r.sizes[0].target).toBe(7);
  });

  it('женская обувь: 39 минимум 10; половинные размеры мужской обуви через запятую', () => {
    const w = rec('Кроссовки женские Test', 'Обувь', '39', 6);
    expect(w.sizes[0].target).toBe(10);
    const m = rec('Кроссовки мужские Test', 'Обувь', '42,5', 0);
    expect(m.sizes[0].target).toBe(11);
  });

  it('унисекс/уникальные размеры (сет, банка) — минимум 4', () => {
    const str = rec('Струна Test', 'Теннисные струны', 'сет', 1);
    expect(str.sizes[0].target).toBe(4);
    expect(str.sizes[0].quantity).toBe(3);
    const ball = rec('Мяч Test', 'Мячи для тенниса', 'банка', 0);
    expect(ball.sizes[0].target).toBe(4);
    // одежда без пола, размер не в таблице → 4
    const uni = rec('Носки Test', 'Одежда', 'XXL', 1);
    expect(uni.gender).toBe('unisex');
    expect(uni.sizes[0].target).toBe(4);
  });

  it('critical при полном нуле, coverage детерминирован', () => {
    const r = rec('Кроссовки мужские Test', 'Обувь', '43', 0);
    expect(r.urgency).toBe('critical');
    expect(r.coveragePercent).toBe(0);
    expect(getRestockRecommendations(fixture())).toEqual(getRestockRecommendations(fixture()));
  });

  it('остаток на складе входит в сетевой запас (не заказываем лишнего)', () => {
    const data: ParsedData = {
      stores: [{ id: 'a', name: 'Магазин А' }, { id: 'w', name: 'Екатеринбург (Основной склад)' }],
      products: [{ id: 'p', name: 'Юбка женская Test', brand: 'B', category: 'Одежда', price: 100 }],
      inventory: [
        { productId: 'p', storeId: 'a', size: 'S', quantity: 2, lastUpdated: '' },
        { productId: 'p', storeId: 'w', size: 'S', quantity: 9, lastUpdated: '' },
      ],
    };
    // сеть: 11 = норматив S → дозакупка не нужна (надо лишь переместить со склада)
    expect(getRestockRecommendations(data)).toHaveLength(0);
  });
});

describe('производительность (регрессия против O(n²))', () => {
  it('2000 товаров × 8 магазинов × 10 размеров обрабатываются быстрее 5 секунд', () => {
    const nProducts = 2000;
    const nStores = 8;
    const nSizes = 10;

    const stores = Array.from({ length: nStores }, (_, s) => ({
      id: `s${s}`,
      name: s === nStores - 1 ? 'Главный склад' : `Магазин ${s}`,
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
    const overstock = getOverstockPositions(data);
    const elapsed = Date.now() - start;

    expect(metrics.totalStock).toBeGreaterThan(0);
    expect(transfers.length).toBeGreaterThan(0);
    expect(restocks.length).toBeGreaterThan(0);
    expect(overstock.length).toBeGreaterThan(0);
    // Старая реализация на этом объёме выполнялась ~194 секунды
    expect(elapsed).toBeLessThan(5000);
  });
});

describe('ходовые товары (hot-products)', () => {
  it('минимум N штук в каждом розничном магазине, склад не считается', () => {
    const data: ParsedData = {
      stores: [
        { id: 'a', name: 'Магазин А' },
        { id: 'b', name: 'Магазин Б' },
        { id: 'w', name: 'Основной склад' },
      ],
      products: [{ id: 'p', name: 'Носки 7/6 Socks Pro - White', brand: '7/6', category: 'Аксессуары', price: 990, article: 'SL76-WH' }],
      inventory: [
        { productId: 'p', storeId: 'a', size: '39-42', quantity: 2, lastUpdated: '' },
        { productId: 'p', storeId: 'b', size: '39-42', quantity: 6, lastUpdated: '' },
        { productId: 'p', storeId: 'w', size: '39-42', quantity: 10, lastUpdated: '' },
      ],
    };
    const recs = getRestockRecommendations(data, [{ article: 'SL76-WH', minPerStore: 5 }]);
    expect(recs).toHaveLength(1);
    const r = recs[0];
    expect(r.isHot).toBe(true);
    expect(r.hotMinPerStore).toBe(5);
    // А: 2 → не хватает 3; Б: 6 → 0; склад не учитывается как розница
    expect(r.totalNeeded).toBe(3);
    expect(r.toPurchase).toBe(3);
    expect(r.urgency).toBe('high');
    // в списке — первыми (сортировка: ходовые сверху)
  });

  it('без правила ходового товара — обычный норматив 4 на позицию', () => {
    const data: ParsedData = {
      stores: [{ id: 'a', name: 'Магазин А' }],
      products: [{ id: 'p', name: 'Носки 7/6 Socks Pro - White', brand: '7/6', category: 'Аксессуары', price: 990, article: 'SL76-WH' }],
      inventory: [{ productId: 'p', storeId: 'a', size: '39-42', quantity: 2, lastUpdated: '' }],
    };
    const recs = getRestockRecommendations(data);
    expect(recs[0].sizes[0].target).toBe(4); // DEFAULT_MINIMUM для аксессуаров
    expect(recs[0].sizes[0].quantity).toBe(2);
  });
});
