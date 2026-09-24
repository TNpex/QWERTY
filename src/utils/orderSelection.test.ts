import { describe, it, expect } from 'vitest';
import {
  addLines,
  buildOrder,
  clampQty,
  dropLines,
  MAX_QTY,
  MIN_QTY,
  removeLine,
  setLineQty,
  summarizeKeys,
  summarizeSelection,
  toggleLine,
  type OrderSelection,
} from './orderSelection';
import { parseCartMap, type CartMap } from './cart';

/**
 * Регрессия «кол-во: 1».
 *
 * Раньше окно заказа хранило снимок списка (готовую ссылку и числа), а
 * плавающая панель корзины лежала поверх окна: правка количества в ссылку для
 * закладки уже не попадала, и на saletennis.com уезжало 1 шт. Теперь заказ
 * собирается из ТЕКУЩЕГО выбора (buildOrder) — эти тесты держат поведение.
 */

const CART_MAP: CartMap | null = parseCartMap(
  JSON.stringify({
    generatedAt: '2026-09-24 06:17:31',
    items: {
      'https://saletennis.com/catalog/product/krossovki-7-6-17063': {
        itemId: '17063',
        article: 'TS76-BKWH',
        sizes: { '42,5': '38495', '43': '38496' },
      },
    },
  })
);

const LINK = 'https://saletennis.com/catalog/product/krossovki-7-6-17063';

function line(key: string, size: string, quantity: number, toStore: string) {
  return {
    key,
    name: 'Кроссовки 7/6 TS76',
    link: LINK,
    size,
    quantity,
    toStore,
  };
}

/** Расшифровать список из hash-ссылки (то же читает кнопка-закладка на сайте) */
function decodeHash(url: string): [string, string, number][] {
  const hash = url.split('#stcart=')[1];
  expect(hash, 'в ссылке должен быть #stcart=').toBeTruthy();
  const parsed = JSON.parse(atob(hash)) as { v: number; items: [string, string, number][] };
  expect(parsed.v).toBe(1);
  return parsed.items;
}

describe('количество в заказе доезжает до сайта', () => {
  it('РЕГРЕССИЯ: 4 шт. доезжают до hash-ссылки для закладки', () => {
    const selection = toggleLine(new Map(), line('g1', '42,5', 4, 'Екатеринбург (Парина)'));
    const order = buildOrder(CART_MAP, selection);
    expect(order.items).toHaveLength(1);
    expect(order.items[0].count).toBe(4);
    expect(order.units).toBe(4);
    expect(decodeHash(order.url)).toEqual([['17063', '38495', 4]]);
  });

  it('РЕГРЕССИЯ: 4 шт. доезжают до текста списка', () => {
    const selection = toggleLine(new Map(), line('g1', '42,5', 4, 'Екатеринбург (Парина)'));
    const order = buildOrder(CART_MAP, selection);
    expect(order.text).toContain('Кол-во: 4');
    expect(order.text).toContain('Размер: 42,5');
    expect(order.text).toContain('Магазин: Екатеринбург (Парина)');
  });

  it('РЕГРЕССИЯ: правка количества после «снимка» меняет и ссылку, и текст', () => {
    // ровно тот сценарий: заказ «открыт» с 1 шт., затем количество правят в панели
    let selection: OrderSelection = toggleLine(new Map(), line('g1', '42,5', 1, 'Уфа'));
    const before = buildOrder(CART_MAP, selection);
    expect(decodeHash(before.url)).toEqual([['17063', '38495', 1]]);

    selection = setLineQty(selection, 'g1', 4);
    const after = buildOrder(CART_MAP, selection);
    expect(decodeHash(after.url)).toEqual([['17063', '38495', 4]]);
    expect(after.text).toContain('Кол-во: 4');
    // старый «снимок» при этом не портится — он просто больше не используется
    expect(decodeHash(before.url)).toEqual([['17063', '38495', 1]]);
  });

  it('РЕГРЕССИЯ: 1 + 3 в два магазина сливаются в 4', () => {
    const selection = toggleLine(
      toggleLine(new Map(), line('g1', '42,5', 1, 'Екатеринбург (Парина)')),
      line('g2', '42,5', 3, 'Екатеринбург (Елизаветинское шоссе)')
    );
    const order = buildOrder(CART_MAP, selection);
    expect(order.items).toHaveLength(1); // один itemId+размер сайта
    expect(order.items[0].count).toBe(4);
    expect(order.count).toBe(1);
    expect(order.units).toBe(4);
    expect(decodeHash(order.url)).toEqual([['17063', '38495', 4]]);
    // в текстовом списке обе строки остаются — видно, кому какие штуки
    expect(order.text.split('\n')).toHaveLength(2);
    expect(order.text).toContain('Кол-во: 1');
    expect(order.text).toContain('Кол-во: 3');
  });
});

describe('selection: отметка, количество, удаление', () => {
  it('toggleLine: отметил — снял; количество при отметке = рекомендованное', () => {
    const selected = toggleLine(new Map(), line('g1', '43', 2, 'Уфа'));
    expect(selected.get('g1')?.quantity).toBe(2);
    expect(summarizeSelection(selected)).toEqual({ positions: 1, units: 2 });
    expect(toggleLine(selected, line('g1', '43', 2, 'Уфа')).size).toBe(0);
  });

  it('setLineQty ограничивает 1..99 и не ломает чужие позиции', () => {
    let selection: OrderSelection = toggleLine(new Map(), line('g1', '43', 1, 'Уфа'));
    selection = toggleLine(selection, line('g2', '42,5', 2, 'Ижевск'));
    expect(setLineQty(selection, 'g1', 5).get('g1')?.quantity).toBe(5);
    expect(setLineQty(selection, 'g1', 0).get('g1')?.quantity).toBe(MIN_QTY);
    expect(setLineQty(selection, 'g1', 1000).get('g1')?.quantity).toBe(MAX_QTY);
    expect(setLineQty(selection, 'g1', NaN).get('g1')?.quantity).toBe(MIN_QTY);
    expect(setLineQty(selection, 'g1', 5).get('g2')?.quantity).toBe(2);
    // несуществующий ключ — выбор не меняется
    expect(setLineQty(selection, 'nope', 3).size).toBe(2);
  });

  it('clampQty: округление и границы', () => {
    expect(clampQty(2.4)).toBe(2);
    expect(clampQty(2.6)).toBe(3);
    expect(clampQty(-5)).toBe(MIN_QTY);
    expect(clampQty(1e6)).toBe(MAX_QTY);
  });

  it('removeLine убирает позицию из заказа', () => {
    let selection: OrderSelection = toggleLine(new Map(), line('g1', '43', 3, 'Уфа'));
    selection = toggleLine(selection, line('g2', '42,5', 1, 'Ижевск'));
    const next = removeLine(selection, 'g1');
    expect(next.size).toBe(1);
    expect(summarizeSelection(next)).toEqual({ positions: 1, units: 1 });
  });

  it('addLines/dropLines: весь товар сразу (карточный вид)', () => {
    const lines = [line('g1', '43', 2, 'Уфа'), line('g2', '42,5', 1, 'Ижевск')];
    const added = addLines(new Map(), lines);
    expect(summarizeSelection(added)).toEqual({ positions: 2, units: 3 });
    // повторное добавление не дублирует и не сбрасывает количество
    const withQty = setLineQty(added, 'g1', 5);
    expect(summarizeSelection(addLines(withQty, lines))).toEqual({ positions: 2, units: 6 });
    expect(dropLines(withQty, ['g1', 'g2']).size).toBe(0);
  });

  it('summarizeKeys: «✓ N поз. · M шт. уже в заказе» для карточки товара', () => {
    let selection: OrderSelection = toggleLine(new Map(), line('g1', '43', 2, 'Уфа'));
    selection = toggleLine(selection, line('g2', '42,5', 3, 'Ижевск'));
    selection = toggleLine(selection, line('other', '43', 1, 'Уфа'));
    expect(summarizeKeys(selection, ['g1', 'g2'])).toEqual({ positions: 2, units: 5 });
    expect(summarizeKeys(selection, ['g3'])).toEqual({ positions: 0, units: 0 });
  });
});

describe('buildOrder без данных корзины', () => {
  it('пусто: нечего заказывать', () => {
    const order = buildOrder(CART_MAP, new Map());
    expect(order.empty).toBe(true);
    expect(order.count).toBe(0);
    expect(order.items).toEqual([]);
  });

  it('нет cart-map: позиция уходит в missing с причиной', () => {
    const selection = toggleLine(new Map(), line('g1', '42,5', 4, 'Уфа'));
    const order = buildOrder(null, selection);
    expect(order.items).toEqual([]);
    expect(order.missingCount).toBe(1);
    expect(order.missing[0].reason).toContain('cart-map.json');
    // текст списка доступен и без данных корзины — его можно скопировать
    expect(order.text).toContain('Кол-во: 4');
  });

  it('размер не найден в карте — позиция в missing, остальные доезжают', () => {
    let selection: OrderSelection = toggleLine(new Map(), line('g1', '42,5', 4, 'Уфа'));
    selection = toggleLine(selection, line('g2', '48', 2, 'Уфа'));
    const order = buildOrder(CART_MAP, selection);
    expect(order.items).toHaveLength(1);
    expect(order.items[0].count).toBe(4);
    expect(order.missingCount).toBe(1);
    expect(order.missing[0].reason).toContain('48');
  });
});
