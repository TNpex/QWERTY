import { describe, it, expect } from 'vitest';
import {
  parseSettings,
  mergeSettings,
  settingsCounts,
  settingsToJson,
  hasStoreRules,
  EMPTY_SETTINGS,
  migrateSettingsKeys,
  type ProductSettings,
} from './settings';
import { storeProfileJson, storeProfileFileName, EMPTY_STORE_PROFILE } from './storeRules';

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
      storeProfiles: {},
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
        storeProfiles: {},
      },
      {
        sportOverrides: { a: 'other' },
        excludedProducts: {},
        suppliedProducts: { s2: true },
        hotProducts: {},
        storeMinimums: { Уфа: { k2: 5 }, Ижевск: { k3: 2 } },
        storeProfiles: {},
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
      profiles: 0,
      bans: 0,
    });
    expect(
      settingsCounts({
        sportOverrides: { a: 'padel' },
        excludedProducts: { b: 'услуга', c: 'вручную' },
        suppliedProducts: { d: true },
        hotProducts: { e: true, f: true },
        storeMinimums: { Уфа: { k1: 3, k2: 2 }, Ижевск: { k3: 4 } },
        storeProfiles: {
          Уфа: { ...EMPTY_STORE_PROFILE, bannedProducts: { k1: true, k9: true } },
          Ижевск: { ...EMPTY_STORE_PROFILE, sport: 'padel', defaultMinimum: 2 },
          Тюмень: { ...EMPTY_STORE_PROFILE },
        },
      })
    ).toEqual({
      sports: 1,
      excluded: 2,
      supplied: 1,
      hot: 2,
      minimums: 3,
      // Тюмень: профиль пустой и минимумов нет — в счётчик не попадает
      profiles: 2,
      bans: 2,
    });
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
      storeProfiles: {
        Уфа: {
          sport: 'padel' as const,
          hiddenCategories: ['Струны'],
          transfersDisabled: true,
          defaultMinimum: 2,
          bannedProducts: { k1: true as const },
          note: 'мало места',
        },
      },
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

describe('storeProfiles в настройках', () => {
  it('разбирает профиль магазина, мусор отбрасывает', () => {
    const parsed = parseSettings(
      JSON.stringify({
        storeProfiles: {
          'Екатеринбург (Парина)': {
            sport: 'padel',
            hiddenCategories: ['Струны', 'Струны', '  ', 5],
            transfersDisabled: 'yes',
            defaultMinimum: '3',
            bannedProducts: { 'ts76-bkwh': true, 'other': false },
            note: '  точка в ТЦ  ',
          },
          Уфа: 'не объект',
        },
      })
    );
    expect(Object.keys(parsed!.storeProfiles)).toEqual(['Екатеринбург (Парина)']);
    expect(parsed!.storeProfiles['Екатеринбург (Парина)']).toEqual({
      sport: 'padel',
      hiddenCategories: ['Струны'],
      transfersDisabled: false,
      defaultMinimum: 3,
      bannedProducts: { 'ts76-bkwh': true },
      note: '  точка в ТЦ  ',
    });
  });

  it('неизвестный вид спорта → all', () => {
    const parsed = parseSettings(
      JSON.stringify({ storeProfiles: { Уфа: { sport: 'футбол' } } })
    );
    expect(parsed!.storeProfiles['Уфа'].sport).toBe('all');
  });

  it('импорт профиля магазина заменяет профиль и его минимумы целиком', () => {
    const merged = mergeSettings(
      {
        ...EMPTY_SETTINGS,
        storeMinimums: { Уфа: { k1: 3, k2: 2 } },
        storeProfiles: {
          Уфа: { ...EMPTY_STORE_PROFILE, bannedProducts: { k9: true }, note: 'старая' },
        },
      },
      {
        ...EMPTY_SETTINGS,
        storeMinimums: { Уфа: { k1: 5 } },
        storeProfiles: { Уфа: { ...EMPTY_STORE_PROFILE, sport: 'padel' } },
      }
    );
    // магазин из входящего файла важнее: старый запрет и снятый минимум не воскресают
    expect(merged.storeProfiles['Уфа'].sport).toBe('padel');
    expect(merged.storeProfiles['Уфа'].bannedProducts).toEqual({});
    expect(merged.storeMinimums).toEqual({ Уфа: { k1: 5 } });
  });

  it('магазин без профиля во входящем файле сохраняется как был', () => {
    const merged = mergeSettings(
      { ...EMPTY_SETTINGS, storeMinimums: { Ижевск: { k3: 4 } }, storeProfiles: {} },
      { ...EMPTY_SETTINGS, storeProfiles: { Уфа: { ...EMPTY_STORE_PROFILE, sport: 'padel' } } }
    );
    expect(merged.storeMinimums).toEqual({ Ижевск: { k3: 4 } });
  });

  it('профиль магазина выгружается файлом формата product-settings.json', () => {
    const settings = {
      ...EMPTY_SETTINGS,
      sportOverrides: { 'общий-товар': 'padel' as const },
      storeMinimums: { Уфа: { k1: 3 }, Ижевск: { k2: 2 } },
      storeProfiles: {
        Уфа: { ...EMPTY_STORE_PROFILE, bannedProducts: { k1: true as const }, defaultMinimum: 2 },
      },
    };
    const json = storeProfileJson(settings, 'Уфа');
    const parsed = parseSettings(json);
    expect(parsed).not.toBeNull();
    // формат совместим: те же поля, но только данные этого магазина
    expect(parsed!.storeProfiles).toEqual(settings.storeProfiles);
    expect(parsed!.storeMinimums).toEqual({ Уфа: { k1: 3 } });
    expect(parsed!.sportOverrides).toEqual({});
    // импорт своего же профиля ничего не ломает
    expect(mergeSettings(settings, parsed!).storeProfiles['Уфа'].bannedProducts).toEqual({ k1: true });
    expect(storeProfileFileName('Екатеринбург (Елизаветинское шоссе)')).toBe(
      'product-settings-екатеринбург-елизаветинское-шоссе.json'
    );
  });

  it('hasStoreRules: пусто без правил по магазинам', () => {
    expect(hasStoreRules(EMPTY_SETTINGS)).toBe(false);
    expect(
      hasStoreRules({ ...EMPTY_SETTINGS, storeMinimums: { Уфа: { k1: 2 } } })
    ).toBe(true);
    expect(
      hasStoreRules({
        ...EMPTY_SETTINGS,
        storeProfiles: { Уфа: { ...EMPTY_STORE_PROFILE, bannedProducts: { k1: true } } },
      })
    ).toBe(true);
  });
});

describe('migrateSettingsKeys', () => {
  const products = [
    { article: 'WR100', link: 'https://site/a', name: 'Куртка красная' },
    { article: 'WR100', link: 'https://site/b', name: 'Куртка синяя' },
    { article: 'WR200', link: 'https://site/c', name: 'Футболка' },
  ];

  it('старые артикульные ключи разливаются на все позиции с тем артикулом', () => {
    const migrated = migrateSettingsKeys(
      {
        ...EMPTY_SETTINGS,
        sportOverrides: { wr100: 'padel' },
        hotProducts: { wr200: true },
      },
      products
    );
    expect(migrated.sportOverrides).toEqual({
      'https://site/a': 'padel',
      'https://site/b': 'padel',
    });
    expect(migrated.hotProducts).toEqual({ 'https://site/c': true });
  });

  it('новые ключи не трогают; без изменений возвращается тот же объект', () => {
    const settings: ProductSettings = {
      ...EMPTY_SETTINGS,
      sportOverrides: { 'https://site/a': 'tennis' },
    };
    expect(migrateSettingsKeys(settings, products)).toBe(settings);
  });

  it('минимумы и запреты профилей мигрируют так же', () => {
    const migrated = migrateSettingsKeys(
      {
        ...EMPTY_SETTINGS,
        storeMinimums: { Уфа: { wr200: 3 } },
        storeProfiles: {
          Уфа: { ...EMPTY_STORE_PROFILE, bannedProducts: { wr100: true } },
        },
      },
      products
    );
    expect(migrated.storeMinimums['Уфа']).toEqual({ 'https://site/c': 3 });
    expect(Object.keys(migrated.storeProfiles['Уфа'].bannedProducts).sort()).toEqual([
      'https://site/a',
      'https://site/b',
    ]);
  });
});
