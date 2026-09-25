import { describe, it, expect } from 'vitest';
import type { InventoryItem, ParsedData, Product, Store } from '../types';
import {
  ALL_SCOPE,
  computeOverview,
  shareLabel,
  sharePercent,
  totalsRow,
} from './storeScope';
import { EMPTY_SETTINGS } from './settings';
import { EMPTY_STORE_PROFILE } from './storeRules';

/**
 * Фикстура «Обзора»: 4 артикула (один распродан, один вообще без остатков),
 * 4 магазина, одна позиция «магазин не возит» (—) — в знаменатель не попадает.
 */
const STORES: Store[] = [
  { id: 'spb1', name: 'Санкт-Петербург (Спортивная)' },
  { id: 'ekb1', name: 'Екатеринбург (Парина)' },
  { id: 'ekb2', name: 'Екатеринбург (Елизаветинское шоссе)' },
  { id: 'w', name: 'Екатеринбург (Основной склад)' },
];

const PRODUCTS: Product[] = [
  { id: 'p1', name: 'Кроссовки женские Nike', brand: 'Nike', category: 'Обувь', price: 1000 },
  { id: 'p2', name: 'Ракетка для падела Babolat', brand: 'Babolat', category: 'Падел - Ракетки', price: 2000 },
  { id: 'p3', name: 'Мячи для тенниса Head', brand: 'Head', category: 'Мячи для тенниса', price: 500 },
  { id: 'p4', name: 'Снято с продажи', brand: 'Wilson', category: 'Обувь', price: 700 },
];

function item(
  productId: string,
  storeId: string,
  size: string,
  quantity: number,
  notCarried = false
): InventoryItem {
  return {
    productId,
    storeId,
    size,
    quantity,
    ...(notCarried ? { notCarried: true } : {}),
    lastUpdated: '',
  };
}

const INVENTORY: InventoryItem[] = [
  item('p1', 'spb1', '39', 2),
  item('p1', 'ekb1', '39', 0),
  item('p1', 'ekb2', '39', 1),
  item('p1', 'w', '39', 5),
  // «—»: магазин не возит этот размер → в знаменатель не попадает
  item('p1', 'ekb2', '40', 0, true),
  item('p2', 'spb1', '—', 1),
  item('p2', 'ekb1', '—', 0),
  item('p3', 'spb1', '—', 0),
  item('p3', 'ekb1', '—', 0),
  // p4 — ни одной строчки остатков (распродан/снят)
];

const DATA: ParsedData = {
  stores: STORES,
  products: PRODUCTS,
  inventory: INVENTORY,
  asOf: '2026-09-24T06:17:31.000Z',
};

describe('computeOverview: 🌐 вся сеть', () => {
  const all = computeOverview(DATA);

  it('позиция = товар × размер × магазин, который товар возит', () => {
    // p1: 4 позиции (39 в четырёх точках), p2: 2, p3: 2 — «—» не считаем
    expect(all.positions).toEqual({ carried: 8, inStock: 4, outOfStock: 4 });
    expect(all.hiddenByProfile).toBe(0);
    expect(all.isStore).toBe(false);
    expect(all.scopeLabel).toBe('🌐 Вся сеть');
  });

  it('остаток и стоимость — только по возящим позициям', () => {
    expect(all.stock).toBe(9);
    expect(all.value).toBe(10000); // 8×1000 (p1) + 1×2000 (p2)
  });

  it('распроданный артикул — нет ни одной штуки (включая товары без строк)', () => {
    expect(all.products).toBe(4);
    expect(all.productsInStock).toBe(2);
    expect(all.soldOutProducts).toBe(2); // p3 (нули) и p4 (нет строк)
  });

  it('разрез по магазинам и итоговая строка', () => {
    const ekb1 = all.stores.find((s) => s.storeId === 'ekb1')!;
    expect(ekb1).toMatchObject({ carried: 3, inStock: 0, outOfStock: 3, stock: 0, products: 3 });
    expect(ekb1.soldOutProducts).toBe(3);

    const ekb2 = all.stores.find((s) => s.storeId === 'ekb2')!;
    expect(ekb2.carried).toBe(1); // «—» не попала в знаменатель
    expect(ekb2.inStock).toBe(1);

    const totals = totalsRow(all.stores);
    expect(totals.carried).toBe(8);
    expect(totals.inStock).toBe(4);
    expect(totals.stock).toBe(9);
    expect(totals.storeName).toBe('Итого по сети');
  });

  it('стековая диаграмма: с наличием / без наличия по категориям', () => {
    const shoe = all.categories.find((c) => c.category === 'Обувь')!;
    expect(shoe).toEqual({ category: 'Обувь', inStock: 3, outOfStock: 1, carried: 4 });
    const balls = all.categories.find((c) => c.category === 'Мячи для тенниса')!;
    expect(balls).toEqual({ category: 'Мячи для тенниса', inStock: 0, outOfStock: 2, carried: 2 });
  });

  it('дата снимка передаётся в обзор', () => {
    expect(all.asOf).toBe('2026-09-24T06:17:31.000Z');
  });
});

describe('computeOverview: область магазина', () => {
  const ekb1 = computeOverview(DATA, { scope: 'Екатеринбург (Парина)' });

  it('считает только позиции своего магазина', () => {
    expect(ekb1.isStore).toBe(true);
    expect(ekb1.scopeLabel).toBe('Екатеринбург (Парина)');
    expect(ekb1.positions).toEqual({ carried: 3, inStock: 0, outOfStock: 3 });
    expect(ekb1.stock).toBe(0);
    expect(ekb1.products).toBe(3);
    expect(ekb1.soldOutProducts).toBe(3);
    // разрез по магазинам остаётся полным — это таблица сравнения
    expect(ekb1.stores).toHaveLength(4);
  });

  it('артикулы без строк в этом магазине не считаются распроданными', () => {
    // p4 не возит никто, p2/p3/p1 в Парине есть — всего 3 артикула
    expect(ekb1.products).toBe(3);
  });

  it('профиль магазина сужает ассортимент: позиции вне его не в знаменателе', () => {
    const scoped = computeOverview(DATA, {
      scope: 'Екатеринбург (Парина)',
      settings: {
        ...EMPTY_SETTINGS,
        storeProfiles: {
          'Екатеринбург (Парина)': { ...EMPTY_STORE_PROFILE, sport: 'padel' },
        },
      },
    });
    // профиль «только падел» скрывает теннисные мячи; кроссовки остались —
    // обувь и одежда универсальны («Теннис/Падел») и подходят падел-точке
    expect(scoped.positions).toEqual({ carried: 2, inStock: 0, outOfStock: 2 });
    expect(scoped.hiddenByProfile).toBe(1);
    expect(scoped.products).toBe(2);
  });

  it('скрытые категории профиля тоже убирают позиции из обзора', () => {
    const scoped = computeOverview(DATA, {
      scope: 'Санкт-Петербург (Спортивная)',
      settings: {
        ...EMPTY_SETTINGS,
        storeProfiles: {
          'Санкт-Петербург (Спортивная)': {
            ...EMPTY_STORE_PROFILE,
            hiddenCategories: ['Мячи для тенниса'],
          },
        },
      },
    });
    expect(scoped.positions.carried).toBe(2);
    expect(scoped.hiddenByProfile).toBe(1);
  });

  it('неизвестный магазин в области — как вся сеть, но без позиций', () => {
    const unknown = computeOverview(DATA, { scope: 'Такого магазина нет' });
    expect(unknown.positions.carried).toBe(0);
    expect(unknown.products).toBe(0);
  });
});

describe('доли и подписи', () => {
  it('sharePercent: округление и пустой знаменатель', () => {
    expect(sharePercent(86, 100)).toBe(86);
    expect(sharePercent(1, 3)).toBe(33);
    expect(sharePercent(2, 3)).toBe(67);
    expect(sharePercent(5, 0)).toBe(0);
  });

  it('shareLabel: «86 из 100»', () => {
    expect(shareLabel(86, 100)).toBe('86 из 100');
  });

  it('РЕГРЕССИЯ: пустая область («Вся сеть (не выбран)») — это вся сеть, а не нули', () => {
    // '' приходило из сайдбара, когда «Мой магазин» не выбран: область считалась
    // магазином с пустым названием, и весь «Обзор» показывал нули
    const empty = computeOverview(DATA, { scope: '' });
    const all = computeOverview(DATA);
    expect(empty.positions).toEqual(all.positions);
    expect(empty.stock).toBe(all.stock);
    expect(empty.products).toBe(all.products);
    expect(empty.scopeLabel).toBe('🌐 Вся сеть');
    expect(computeOverview(DATA, { scope: undefined }).positions).toEqual(all.positions);
  });

  it('ALL_SCOPE — это «вся сеть»', () => {
    expect(ALL_SCOPE).toBe('all');
    expect(computeOverview(DATA, { scope: ALL_SCOPE }).scopeLabel).toBe('🌐 Вся сеть');
  });
});
