import { describe, it, expect } from 'vitest';
import type { ParserChange } from './historyCore';
import {
  changeTime,
  collectNewProducts,
  isNewProduct,
  NEW_PRODUCT_DAYS,
  newProductArticles,
} from './newProducts';

function change(article: string, date: string, changeType = 'Новый товар'): ParserChange {
  return { date, article, name: `Товар ${article}`, category: 'Одежда', changeType, oldValue: '', newValue: '', diff: 0 };
}

describe('collectNewProducts', () => {
  it('первый парсинг журнала — базовый срез, в новинки не попадает', () => {
    const changes = [
      // 23.09 — «базовый» парсинг: 3 из 4 событий (75%) → исключаем дату целиком
      change('a1', '2026-09-23 06:17:31'),
      change('a2', '2026-09-23 06:17:31'),
      change('a3', '2026-09-23 06:17:31'),
      change('b1', '2026-09-24 06:17:31'),
    ];
    const map = collectNewProducts(changes);
    expect([...map.keys()]).toEqual(['b1']);
    expect(map.get('b1')?.firstSeen).toBe('2026-09-24 06:17:31');
  });

  it('первая дата НЕ базовая, если на неё меньше половины событий', () => {
    const changes = [
      change('a1', '2026-09-23 06:17:31'),
      change('b1', '2026-09-24 06:17:31'),
      change('b2', '2026-09-24 06:17:31'),
      change('b3', '2026-09-24 06:17:31'),
    ];
    // 23.09 — 1 событие из 4 (25% < 50%) → это не базовый срез, учитываются все
    expect([...collectNewProducts(changes).keys()].sort()).toEqual(['a1', 'b1', 'b2', 'b3']);
  });

  it('поровну событий по дням — первая дата всё равно считается базовым срезом', () => {
    // на первом парсинге нельзя отличить «появился» от «был всегда»
    const changes = [change('a1', '2026-09-23 06:17:31'), change('b1', '2026-09-24 06:17:31')];
    expect([...collectNewProducts(changes).keys()]).toEqual(['b1']);
  });

  it('берёт ПЕРВОЕ появление товара и учитывает «Товар появился»', () => {
    const changes = [
      change('a1', '2026-09-20 06:00:00'),
      change('a1', '2026-09-24 06:00:00'),
      change('a2', '2026-09-24 06:00:00', 'Товар появился'),
      change('a3', '2026-09-24 06:00:00', 'Изменение количества'),
      change('a4', '2026-09-24 06:00:00', 'Товар закончился'),
    ];
    const map = collectNewProducts(changes);
    expect(map.get('a1')?.firstSeen).toBe('2026-09-20 06:00:00');
    expect(map.has('a2')).toBe(true);
    expect(map.has('a3')).toBe(false); // изменение количества — не новинка
    expect(map.has('a4')).toBe(false);
  });

  it('артикул нормализуется (регистр/пробелы), пустые события игнорируются', () => {
    const map = collectNewProducts([change('  TS76-BKWH ', '2026-09-24 06:00:00'), change('', '2026-09-24 06:00:00')]);
    expect([...map.keys()]).toEqual(['ts76-bkwh']);
  });

  it('порог базового среза настраивается', () => {
    const changes = [change('a1', '2026-09-23 06:00:00'), change('b1', '2026-09-24 06:00:00')];
    expect([...collectNewProducts(changes, { baselineShare: 0.4 }).keys()]).toEqual(['b1']);
  });
});

describe('isNewProduct / newProductArticles', () => {
  const asOf = '2026-09-25T06:00:00';

  it('новинка — первое появление не раньше N дней от даты снимка', () => {
    expect(isNewProduct({ firstSeen: '2026-09-24 06:17:31' }, asOf)).toBe(true);
    expect(isNewProduct({ firstSeen: '2026-09-15 06:17:31' }, asOf)).toBe(true); // 10 дней
    expect(isNewProduct({ firstSeen: '2026-08-01 06:17:31' }, asOf)).toBe(false); // 55 дней
    expect(isNewProduct({ firstSeen: '2026-09-20 06:17:31' }, asOf, 1)).toBe(false); // окно 1 день
    expect(isNewProduct(undefined, asOf)).toBe(false);
    expect(isNewProduct({ firstSeen: 'не дата' }, asOf)).toBe(false);
  });

  it('окно по умолчанию — 14 дней', () => {
    expect(NEW_PRODUCT_DAYS).toBe(14);
  });

  it('newProductArticles: множество артикулов-новинок на дату снимка', () => {
    const changes = [
      change('old', '2026-08-01 06:00:00'),
      change('fresh', '2026-09-24 06:00:00'),
    ];
    const set = newProductArticles(changes, asOf);
    expect([...set]).toEqual(['fresh']);
  });

  it('changeTime понимает и ISO, и «ГГГГ-ММ-ДД ЧЧ:ММ:СС»', () => {
    expect(changeTime('2026-09-24T06:17:31')).toBe(changeTime('2026-09-24 06:17:31'));
    expect(changeTime('мусор')).toBe(0);
  });
});
