import { describe, it, expect } from 'vitest';
import {
  parseSettings,
  mergeSettings,
  settingsCounts,
  settingsToJson,
  EMPTY_SETTINGS,
} from './settings';

describe('parseSettings', () => {
  it('разбирает валидный JSON, отсеивая мусор и недопустимые значения', () => {
    const parsed = parseSettings(
      JSON.stringify({
        sportOverrides: { a1: 'padel', a2: 'футбол', a3: 5, '': 'tennis' },
        excludedProducts: { '700': 'услуга' },
        junk: 1,
      })
    );
    expect(parsed).toEqual({
      sportOverrides: { a1: 'padel' },
      excludedProducts: { '700': 'услуга' },
      suppliedProducts: {},
      hotProducts: {},
      storeMinimums: {},
    });
  });

  it('невалидный JSON → null', () => {
    expect(parseSettings('{oops')).toBeNull();
    expect(parseSettings('[]')).toBeNull();
  });
});

describe('mergeSettings', () => {
  it('импорт перекрывает совпадающие ключи, остальные сохраняет', () => {
    const merged = mergeSettings(
      {
        sportOverrides: { a: 'tennis', b: 'padel' },
        excludedProducts: { x: 'услуга' },
        suppliedProducts: { s1: true },
        hotProducts: { h1: true },
        storeMinimums: { Уфа: { k1: 3 } },
      },
      {
        sportOverrides: { a: 'other' },
        excludedProducts: {},
        suppliedProducts: { s2: true },
        hotProducts: {},
        storeMinimums: { Уфа: { k2: 5 }, Ижевск: { k3: 2 } },
      }
    );
    expect(merged.sportOverrides).toEqual({ a: 'other', b: 'padel' });
    expect(merged.excludedProducts).toEqual({ x: 'услуга' });
    expect(merged.suppliedProducts).toEqual({ s1: true, s2: true });
    expect(merged.hotProducts).toEqual({ h1: true });
    expect(merged.storeMinimums).toEqual({ Уфа: { k1: 3, k2: 5 }, Ижевск: { k3: 2 } });
  });
});

describe('settingsCounts / roundtrip', () => {
  it('считает правки, исключения, поставки и ходовые', () => {
    expect(settingsCounts(EMPTY_SETTINGS)).toEqual({
      sports: 0,
      excluded: 0,
      supplied: 0,
      hot: 0,
      minimums: 0,
    });
    expect(
      settingsCounts({
        sportOverrides: { a: 'padel' },
        excludedProducts: { b: 'услуга', c: 'вручную' },
        suppliedProducts: { d: true },
        hotProducts: { e: true, f: true },
        storeMinimums: { Уфа: { k1: 3, k2: 2 }, Ижевск: { k3: 4 } },
      })
    ).toEqual({ sports: 1, excluded: 2, supplied: 1, hot: 2, minimums: 3 });
  });

  it('флаги «Поставляется»/«Ходовой»: принимает только true', () => {
    const parsed = parseSettings(
      JSON.stringify({
        suppliedProducts: { a: true, b: false, c: 'yes' },
        hotProducts: { d: true, e: 1 },
      })
    );
    expect(parsed?.suppliedProducts).toEqual({ a: true });
    expect(parsed?.hotProducts).toEqual({ d: true });
  });

  it('JSON → parse даёт исходные настройки', () => {
    const settings = {
      sportOverrides: { a: 'padel' as const },
      excludedProducts: { b: 'услуга' },
      suppliedProducts: { c: true },
      hotProducts: { d: true },
      storeMinimums: { Уфа: { k1: 3 } },
    };
    expect(parseSettings(settingsToJson(settings))).toEqual(settings);
  });

  it('минимумы: принимает только положительные числа, мусор отбрасывает', () => {
    const parsed = parseSettings(
      JSON.stringify({
        storeMinimums: {
          Уфа: { a: 3, b: -1, c: 0, d: '4', e: 'много', f: null },
          '  ': { x: 1 },
          Ижевск: 'не объект',
        },
      })
    );
    expect(parsed?.storeMinimums).toEqual({ Уфа: { a: 3, d: 4 } });
  });
});
