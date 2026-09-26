import { describe, it, expect } from 'vitest';
import type { ParsedData } from '../types';
import {
  applyDiscounts,
  computePercent,
  discountFor,
  discountSummary,
  itemIdFromLink,
  parseDiscounts,
} from './discounts';

const JSON_OK = JSON.stringify({
  generatedAt: '2026-09-25 09:05:37',
  source: 'https://saletennis.com/catalog/sale/',
  items: {
    '19166': {
      percent: 25,
      price: 8993,
      oldPrice: 11990,
      name: 'Сумка для падел Black Crown Thunder - Negro',
      link: 'https://saletennis.com/catalog/product/sumka-thunder-negro-19166/',
    },
    '17063': { percent: 50, price: 1500, oldPrice: 3000, link: 'https://saletennis.com/catalog/product/krossovki-17063/' },
    // мусор: без процента, без цен, не объект
    '99999': { percent: 0, price: 100, oldPrice: 100 },
    '88888': { percent: 30 },
    '77777': 'строка',
  },
});

describe('parseDiscounts', () => {
  it('разбирает файл, отбрасывает записи без процента', () => {
    const map = parseDiscounts(JSON_OK);
    expect(map).not.toBeNull();
    expect(Object.keys(map!.items).sort()).toEqual(['17063', '19166', '88888'].sort());
    expect(map!.items['19166']).toEqual({
      itemId: '19166',
      percent: 25,
      price: 8993,
      oldPrice: 11990,
      name: 'Сумка для падел Black Crown Thunder - Negro',
      link: 'https://saletennis.com/catalog/product/sumka-thunder-negro-19166/',
    });
    expect(map!.generatedAt).toBe('2026-09-25 09:05:37');
  });

  it('без процента, но с ценами — процент считается по ценам', () => {
    const map = parseDiscounts(JSON.stringify({ items: { a: { price: 700, oldPrice: 1000 } } }));
    expect(map!.items['a'].percent).toBe(30);
  });

  it('битый JSON и мусор → null', () => {
    expect(parseDiscounts('{oops')).toBeNull();
    expect(parseDiscounts('[]')).toBeNull();
    expect(parseDiscounts(JSON.stringify({ items: 'не объект' }))).toBeNull();
  });

  it('computePercent: границы', () => {
    expect(computePercent(25, 750, 1000)).toBe(25);
    expect(computePercent(0, 750, 1000)).toBe(25); // процент не пришёл — считаем по ценам
    expect(computePercent(0, 1000, 1000)).toBe(0); // цены равны — скидки нет
    expect(computePercent(0, 1200, 1000)).toBe(0); // «скидка» дороже — не скидка
    expect(computePercent(150, 100, 1000)).toBe(90); // недостоверный процент (150) → считаем по ценам
  });
});

describe('itemIdFromLink', () => {
  it('числовой хвост ссылки — это itemId сайта', () => {
    expect(itemIdFromLink('https://saletennis.com/catalog/product/sumka-19166/')).toBe('19166');
    expect(itemIdFromLink('https://saletennis.com/catalog/product/sumka-19166')).toBe('19166');
    expect(itemIdFromLink('/catalog/product/krossovki-7-6-17063')).toBe('17063');
  });

  it('без хвоста — null', () => {
    expect(itemIdFromLink('https://saletennis.com/catalog/sale/')).toBeNull();
    expect(itemIdFromLink('')).toBeNull();
    expect(itemIdFromLink(undefined)).toBeNull();
  });
});

describe('discountFor / applyDiscounts', () => {
  const map = parseDiscounts(JSON_OK)!;

  it('находит скидку по itemId из ссылки, затем по совпадению ссылки', () => {
    expect(
      discountFor(map, { link: 'https://saletennis.com/catalog/product/sumka-thunder-negro-19166' })?.percent
    ).toBe(25);
    expect(discountFor(map, { link: 'https://saletennis.com/catalog/product/krossovki-17063/' })?.percent).toBe(50);
    expect(discountFor(map, { link: 'https://saletennis.com/catalog/product/net-takogo-1' })).toBeNull();
    expect(discountFor(null, { link: 'x-19166' })).toBeNull();
  });

  it('проставляет товарам старую цену и процент (price уже со скидкой)', () => {
    const data: ParsedData = {
      stores: [{ id: 's1', name: 'Уфа' }],
      products: [
        { id: 'p1', name: 'Сумка Thunder', brand: 'Black Crown', category: 'Сумки и чехлы', price: 8993, link: 'https://saletennis.com/catalog/product/sumka-thunder-negro-19166/' },
        { id: 'p2', name: 'Кроссовки', brand: '7/6', category: 'Обувь', price: 1500, link: 'https://saletennis.com/catalog/product/krossovki-17063/' },
        { id: 'p3', name: 'Без скидки', brand: 'Head', category: 'Обувь', price: 5000, link: 'https://saletennis.com/catalog/product/bez-skidki-11111/' },
      ],
      inventory: [],
    };
    const withDiscounts = applyDiscounts(data, map);
    const byId = new Map(withDiscounts.products.map((p) => [p.id, p]));
    expect(byId.get('p1')).toMatchObject({ price: 8993, oldPrice: 11990, discountPercent: 25 });
    expect(byId.get('p2')).toMatchObject({ oldPrice: 3000, discountPercent: 50 });
    expect(byId.get('p3')?.discountPercent).toBeUndefined();
    // пустая карта не трогает данные
    expect(applyDiscounts(data, null)).toBe(data);
  });

  it('сводка для подписей', () => {
    expect(discountSummary(map)).toEqual({ count: 3, maxPercent: 50, avgPercent: 35 });
    expect(discountSummary(null)).toEqual({ count: 0, maxPercent: 0, avgPercent: 0 });
  });
});

describe('applyDiscounts: скидка из парсера против раздела «Распродажа»', () => {
  it('больший процент побеждает', () => {
    const data: ParsedData = {
      stores: [{ id: 's', name: 'Уфа' }],
      products: [
        { id: 'p', name: 'Т', brand: 'B', category: 'Обувь', price: 4000, oldPrice: 5000, discountPercent: 20, link: 'l1' },
      ],
      inventory: [],
    };
    const map = {
      items: { i1: { itemId: 'i1', price: 4400, oldPrice: 5000, percent: 10, link: 'l1' } },
    };
    const applied = applyDiscounts(data, map);
    expect(applied.products[0].discountPercent).toBe(20);
  });
});
