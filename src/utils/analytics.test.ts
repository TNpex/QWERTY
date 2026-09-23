import { describe, it, expect } from 'vitest';
import type { ParsedData, InventoryItem } from '../types';
import {
  getMetrics,
  getTransferRecommendations,
  getRestockRecommendations,
  getOverstockPositions,
  MIN_PER_STORE,
  TRANSFER_CAP,
  STORE_EXCESS_TRIGGER,
  DONOR_KEEP,
} from './analyticsCore';

// ============ Фикстуры ============

// Магазины: один город «Тест» (три точки + склад), СПб и Уфа — для маршрутов
const STORES = [
  { id: 'spb', name: 'Санкт-Петербург (Невский)' },
  { id: 'a', name: 'Тест (Центральный)' },
  { id: 'b', name: 'Тест (Северный)' },
  { id: 'c', name: 'Тест (Южный)' },
  { id: 'ufa', name: 'Уфа' },
  { id: 'w', name: 'Тест (Склад)' },
];

function fixture(): ParsedData {
  const products = [
    { id: 'p1', name: 'Кроссовки Nike', brand: 'Nike', category: 'Обувь', price: 8990, link: 'l1' },
    { id: 'p2', name: 'Сумка Head', brand: 'Head', category: 'Сумки и чехлы', price: 5000, link: 'l2' },
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
    // p1 / 42: склад 5, Центр 0, Север 1, Юг 6, СПб и Уфа возят, но 0
    item('p1', 'w', '42', 5),
    item('p1', 'a', '42', 0),
    item('p1', 'b', '42', 1),
    item('p1', 'c', '42', 6),
    item('p1', 'spb', '42', 0, true),
    item('p1', 'ufa', '42', 0, true),
    // p1 / 43: Центр 4 (переизбыток), Север 0
    item('p1', 'a', '43', 4),
    item('p1', 'b', '43', 0),
    // p2 / —: СПб 5 (переизбыток), Уфа 0 → дорогой маршрут spb-expensive
    item('p2', 'spb', '—', 5),
    item('p2', 'ufa', '—', 0),
    item('p2', 'a', '—', 0),
  ];

  return { stores: STORES, products, inventory };
}

describe('getMetrics', () => {
  it('исключает notCarried из OOS и считает распроданные товары', () => {
    const m = getMetrics(fixture());
    // carried-строки: 42(w5,a0,b1,c6)=4, 43(a4,b0)=2, p2(5,0,0)=3 → 9
    expect(m.carriedSKUs).toBe(9);
    expect(m.notCarriedSKUs).toBe(2);
    expect(m.totalStock).toBe(5 + 1 + 6 + 4 + 5);
    expect(m.outOfStockSizes).toBe(4); // a42, b43, ufa-p2, a-p2
    expect(m.soldOutProducts).toBe(0);
    expect(m.totalValue).toBe(8990 * (5 + 1 + 6 + 4) + 5000 * 5);
  });
});

describe('getTransferRecommendations: новая бизнес-логика', () => {
  const recs = getTransferRecommendations(fixture());
  const byRoute = (route: string) => recs.filter((r) => r.route === route);

  it('фаза 1: склад → магазин без товара, до норматива', () => {
    const wh = byRoute('warehouse');
    // склад(5) → Центр(0): везём MIN_PER_STORE=2
    const toA = wh.find((r) => r.toStoreId === 'a' && r.size === '42');
    expect(toA).toBeDefined();
    expect(toA!.quantity).toBe(MIN_PER_STORE);
    expect(toA!.fromStoreId).toBe('w');
    // Север имеет 1 шт — фаза 1 его не трогает (нет = только 0)
    expect(wh.find((r) => r.toStoreId === 'b')).toBeUndefined();
  });

  it('фаза 2: переизбыток (≥4) → где нет/мало, донор оставляет DONOR_KEEP', () => {
    // Юг(6) размер 42: после фазы 1 Центр получил 2 → не получатель; Север(1) — получатель
    const excess = recs.filter((r) => r.fromStoreId === 'c' && r.size === '42');
    const sent = excess.reduce((s, r) => s + r.quantity, 0);
    expect(excess.length).toBeGreaterThan(0);
    // донор не может отдать больше, чем quantity - DONOR_KEEP = 3
    expect(sent).toBeLessThanOrEqual(6 - DONOR_KEEP);
    // Центр(4) размер 43 → Север(0), внутри города
    const a43 = recs.find((r) => r.fromStoreId === 'a' && r.size === '43');
    expect(a43).toBeDefined();
    expect(a43!.toStoreId).toBe('b');
    expect(a43!.quantity).toBeLessThanOrEqual(4 - DONOR_KEEP); // 1
    expect(a43!.route).toBe('same-city');
  });

  it('ходовой размер обуви со склада — высокий приоритет', () => {
    const wh42 = recs.find((r) => r.route === 'warehouse' && r.size === '42' && r.toStoreId === 'a');
    expect(wh42!.priority).toBe('high'); // 42 — популярный + Обувь
  });

  it('из СПб в другие города — маршрут spb-expensive с низким приоритетом', () => {
    const expensive = byRoute('spb-expensive');
    expect(expensive.length).toBeGreaterThan(0);
    for (const r of expensive) {
      expect(r.fromStoreId).toBe('spb');
      expect(r.priority).toBe('low');
    }
    // p2: СПб(5) → Уфа(0) и/или Центр(0)
    expect(expensive.some((r) => r.toStoreId === 'ufa')).toBe(true);
  });

  it('не обещает одну единицу дважды (сумма отправлений ≤ доступный избыток)', () => {
    for (const donorId of ['w', 'a', 'c', 'spb']) {
      const sent = recs
        .filter((r) => r.fromStoreId === donorId)
        .reduce((s, r) => s + r.quantity, 0);
      const fixture_ = fixture();
      const owned = fixture_.inventory
        .filter((i) => i.storeId === donorId && !i.notCarried)
        .reduce((s, i) => s + i.quantity, 0);
      expect(sent).toBeLessThanOrEqual(owned);
    }
  });

  it('каждая рекомендация ≤ TRANSFER_CAP и содержит текущие количества', () => {
    for (const r of recs) {
      expect(r.quantity).toBeLessThanOrEqual(TRANSFER_CAP);
      expect(r.fromQty).toBeGreaterThanOrEqual(0);
      expect(typeof r.toQty).toBe('number');
      expect(r.productLink).toBeTruthy();
    }
  });

  it('детерминированность', () => {
    expect(getTransferRecommendations(fixture())).toEqual(recs);
  });
});

describe('getOverstockPositions', () => {
  it('находит позиции ≥ STORE_EXCESS_TRIGGER с excess = qty − DONOR_KEEP', () => {
    const overstock = getOverstockPositions(fixture());
    const c42 = overstock.find((p) => p.storeId === 'c' && p.size === '42');
    expect(c42).toBeDefined();
    expect(c42!.quantity).toBe(6);
    expect(c42!.excess).toBe(6 - DONOR_KEEP);
    const w42 = overstock.find((p) => p.storeId === 'w' && p.size === '42');
    expect(w42).toBeDefined(); // склад 5 ≥ 4 — тоже переизбыток
    // a43 = 4 ≥ 4
    expect(overstock.find((p) => p.storeId === 'a' && p.size === '43')).toBeDefined();
    // spb p2 = 5
    expect(overstock.find((p) => p.storeId === 'spb')).toBeDefined();
    // b42 = 1 — не переизбыток
    expect(overstock.find((p) => p.storeId === 'b' && p.size === '42')).toBeUndefined();
  });
});

describe('getRestockRecommendations: покрытие перемещением', () => {
  it('дефицит покрывается складом/избытком → toPurchase уменьшается', () => {
    const recs = getRestockRecommendations(fixture());

    // p2/—: возят spb(5), ufa(0), a(0) → норматив 6, total 5 → needed 1
    // покрытие: склад p2 не возит; избыток spb 5≥4 → excess 1 → cover 1
    const p2 = recs.find((r) => r.productId === 'p2');
    expect(p2).toBeDefined();
    expect(p2!.totalNeeded).toBe(1);
    expect(p2!.transferCover).toBe(1);
    expect(p2!.toPurchase).toBe(0);
    expect(p2!.sizes[0]).toEqual({ size: '—', quantity: 1, transferCover: 1, toPurchase: 0 });

    // p1/43: возящих магазинОв 4 (w,a,b,c) → норматив на размер 8;
    // total(43) = 4 (a) + 0 (b) → needed 4; избыток a(4) → excess 1 → cover 1, purchase 3
    const p1 = recs.find((r) => r.productId === 'p1')!;
    expect(p1.totalNeeded).toBe(4);
    expect(p1.transferCover).toBe(1);
    expect(p1.toPurchase).toBe(3);
    expect(p1.sizes).toEqual([{ size: '43', quantity: 4, transferCover: 1, toPurchase: 3 }]);
  });

  it('склад покрывает закупку', () => {
    const data: ParsedData = {
      stores: [
        { id: 'a', name: 'Тест (Центральный)' },
        { id: 'w', name: 'Тест (Склад)' },
      ],
      products: [{ id: 'p', name: 'Мяч', brand: 'B', category: 'Мячи', price: 100 }],
      inventory: [
        { productId: 'p', storeId: 'a', size: '—', quantity: 0, lastUpdated: '' },
        { productId: 'p', storeId: 'w', size: '—', quantity: 3, lastUpdated: '' },
      ],
    };
    const recs = getRestockRecommendations(data);
    expect(recs).toHaveLength(1);
    // норматив 2×2=4, total 3 → needed 1; склад держит 3 → cover 1 → purchase 0
    expect(recs[0].totalNeeded).toBe(1);
    expect(recs[0].transferCover).toBe(1);
    expect(recs[0].toPurchase).toBe(0);
  });

  it('без покрытия — вся потребность в заказ', () => {
    const data: ParsedData = {
      stores: [
        { id: 'a', name: 'Тест (Центральный)' },
        { id: 'b', name: 'Тест (Северный)' },
      ],
      products: [{ id: 'p', name: 'Струны', brand: 'B', category: 'Теннисные струны', price: 900 }],
      inventory: [
        { productId: 'p', storeId: 'a', size: '—', quantity: 1, lastUpdated: '' },
        { productId: 'p', storeId: 'b', size: '—', quantity: 0, lastUpdated: '' },
      ],
    };
    const recs = getRestockRecommendations(data);
    expect(recs[0].totalNeeded).toBe(3); // норматив 4, есть 1
    expect(recs[0].transferCover).toBe(0);
    expect(recs[0].toPurchase).toBe(3);
    expect(recs[0].urgency).not.toBe('critical'); // товар ещё есть (1 шт)
    expect(recs[0].category).toBe('Теннисные струны');
  });

  it('critical, когда товара нет совсем; coverage детерминирован', () => {
    const data: ParsedData = {
      stores: [{ id: 'a', name: 'Тест (Центральный)' }],
      products: [{ id: 'p', name: 'X', brand: 'B', category: 'C', price: 1 }],
      inventory: [{ productId: 'p', storeId: 'a', size: '—', quantity: 0, lastUpdated: '' }],
    };
    const a = getRestockRecommendations(data);
    const b = getRestockRecommendations(data);
    expect(a).toEqual(b);
    expect(a[0].urgency).toBe('critical');
    expect(a[0].coveragePercent).toBe(0);
  });

  it('константы согласованы', () => {
    expect(STORE_EXCESS_TRIGGER).toBe(4);
    expect(DONOR_KEEP).toBe(3);
    expect(MIN_PER_STORE).toBe(2);
  });
});

describe('производительность (регрессия против O(n²))', () => {
  it('2000 товаров × 8 магазинов × 10 размеров обрабатываются быстрее 3 секунд', () => {
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
    expect(Array.isArray(transfers)).toBe(true);
    expect(Array.isArray(restocks)).toBe(true);
    expect(Array.isArray(overstock)).toBe(true);
    // Старая реализация на этом объёме выполнялась ~194 секунды
    expect(elapsed).toBeLessThan(3000);
  });
});
