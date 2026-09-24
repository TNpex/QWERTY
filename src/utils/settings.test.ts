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
      { sportOverrides: { a: 'tennis', b: 'padel' }, excludedProducts: { x: 'услуга' } },
      { sportOverrides: { a: 'other' }, excludedProducts: {} }
    );
    expect(merged.sportOverrides).toEqual({ a: 'other', b: 'padel' });
    expect(merged.excludedProducts).toEqual({ x: 'услуга' });
  });
});

describe('settingsCounts / roundtrip', () => {
  it('считает правки и исключения', () => {
    expect(settingsCounts(EMPTY_SETTINGS)).toEqual({ sports: 0, excluded: 0 });
    expect(
      settingsCounts({
        sportOverrides: { a: 'padel' },
        excludedProducts: { b: 'услуга', c: 'вручную' },
      })
    ).toEqual({ sports: 1, excluded: 2 });
  });

  it('JSON → parse даёт исходные настройки', () => {
    const settings = {
      sportOverrides: { a: 'padel' as const },
      excludedProducts: { b: 'услуга' },
    };
    expect(parseSettings(settingsToJson(settings))).toEqual(settings);
  });
});
