import { describe, it, expect } from 'vitest';
import {
  parseCartMap,
  sizeIdFor,
  resolveCartItems,
  cartLinesToText,
  type CartLine,
  type CartMap,
} from './cart';

const MAP_JSON = JSON.stringify({
  generatedAt: '2026-09-24 06:17:31',
  items: {
    'https://saletennis.com/catalog/product/krossovki-7-6-17063': {
      itemId: '17063',
      article: 'TS76-BKWH',
      sizes: { '42,5': '38495', '43': '38496' },
    },
    'https://saletennis.com/catalog/product/struna-head-8073': {
      itemId: '8073',
      article: '281023-16LSI',
      sizes: {},
    },
    'https://saletennis.com/catalog/product/bitaya-zapis': { itemId: '' },
  },
});

describe('parseCartMap', () => {
  it('разбирает карту, отбрасывает записи без itemId', () => {
    const map = parseCartMap(MAP_JSON);
    expect(map).not.toBeNull();
    expect(Object.keys(map!.items)).toHaveLength(2);
    expect(map!.items['https://saletennis.com/catalog/product/krossovki-7-6-17063'].sizes['42,5']).toBe('38495');
  });

  it('мусор и битый JSON → null', () => {
    expect(parseCartMap('{oops')).toBeNull();
    expect(parseCartMap('[]')).toBeNull();
    expect(parseCartMap(JSON.stringify({ items: 'not-an-object' }))).toBeNull();
  });
});

describe('sizeIdFor', () => {
  const entry = { itemId: '17063', sizes: { '42,5': '38495', '43': '38496' } };

  it('точное совпадение и варианты точки/запятой', () => {
    expect(sizeIdFor(entry, '42,5')).toBe('38495');
    expect(sizeIdFor(entry, '42.5')).toBe('38495');
    expect(sizeIdFor(entry, ' 43 ')).toBe('38496');
  });

  it('безразмерные значения → «0»', () => {
    expect(sizeIdFor(entry, '—')).toBe('0');
    expect(sizeIdFor({ itemId: '1', sizes: {} }, 'Без размера')).toBe('0');
  });

  it('неизвестный размер → null', () => {
    expect(sizeIdFor(entry, '45')).toBeNull();
  });
});

describe('resolveCartItems', () => {
  const map: CartMap | null = parseCartMap(MAP_JSON);

  it('собирает payload и сливает одинаковые itemId+size', () => {
    const lines: CartLine[] = [
      { key: 'g1', name: 'Кроссовки 7/6', link: 'https://saletennis.com/catalog/product/krossovki-7-6-17063/', size: '42,5', quantity: 1, toStore: 'Уфа' },
      { key: 'g2', name: 'Кроссовки 7/6', link: 'https://saletennis.com/catalog/product/krossovki-7-6-17063', size: '42.5', quantity: 2, toStore: 'Ижевск' },
      { key: 'g3', name: 'Струна Head', link: 'https://saletennis.com/catalog/product/struna-head-8073', size: '—', quantity: 3, toStore: 'Тюмень' },
    ];
    const { items, missing } = resolveCartItems(map, lines);
    expect(missing).toHaveLength(0);
    expect(items).toHaveLength(2);
    const shoes = items.find((i) => i.itemId === '17063');
    expect(shoes?.count).toBe(3); // 1 + 2 объединены
    expect(shoes?.size).toBe('38495');
    const strings = items.find((i) => i.itemId === '8073');
    expect(strings?.size).toBe('0');
    expect(strings?.count).toBe(3);
  });

  it('позиции без данных карты попадают в missing с причиной', () => {
    const lines: CartLine[] = [
      { key: 'g1', name: 'Неизвестное', link: 'https://saletennis.com/catalog/product/net-takogo', size: 'M', quantity: 1, toStore: 'Уфа' },
      { key: 'g2', name: 'Кроссовки 7/6', link: 'https://saletennis.com/catalog/product/krossovki-7-6-17063', size: '45', quantity: 1, toStore: 'Уфа' },
    ];
    const { items, missing } = resolveCartItems(map, lines);
    expect(items).toHaveLength(0);
    expect(missing).toHaveLength(2);
    expect(missing[0].reason).toContain('не найден в данных корзины');
    expect(missing[1].reason).toContain('45');
  });

  it('без карты все позиции — missing', () => {
    const { items, missing } = resolveCartItems(null, [
      { key: 'g1', name: 'X', link: 'https://saletennis.com/p', size: 'M', quantity: 1, toStore: 'Уфа' },
    ]);
    expect(items).toHaveLength(0);
    expect(missing).toHaveLength(1);
  });
});

describe('cartLinesToText', () => {
  it('форматирует список для буфера обмена', () => {
    const text = cartLinesToText([
      { key: 'g1', name: 'Кроссовки 7/6', size: '42,5', quantity: 2, toStore: 'Уфа' },
    ]);
    expect(text).toBe('Кроссовки 7/6 | Размер: 42,5 | Кол-во: 2 | Магазин: Уфа');
  });
});
