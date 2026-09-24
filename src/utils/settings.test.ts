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
      },
      {
        sportOverrides: { a: 'other' },
        excludedProducts: {},
        suppliedProducts: { s2: true },
        hotProducts: {},
      }
    );
    expect(merged.sportOverrides).toEqual({ a: 'other', b: 'padel' });
    expect(merged.excludedProducts).toEqual({ x: 'услуга' });
    expect(merged.suppliedProducts).toEqual({ s1: true, s2: true });
    expect(merged.hotProducts).toEqual({ h1: true });
  });
});

describe('settingsCounts / roundtrip', () => {
  it('считает правки, исключения, поставки и ходовые', () => {
    expect(settingsCounts(EMPTY_SETTINGS)).toEqual({
      sports: 0,
      excluded: 0,
      supplied: 0,
      hot: 0,
    });
    expect(
      settingsCounts({
        sportOverrides: { a: 'padel' },
        excludedProducts: { b: 'услуга', c: 'вручную' },
        suppliedProducts: { d: true },
        hotProducts: { e: true, f: true },
      })
    ).toEqual({ sports: 1, excluded: 2, supplied: 1, hot: 2 });
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
    };
    expect(parseSettings(settingsToJson(settings))).toEqual(settings);
  });
});
