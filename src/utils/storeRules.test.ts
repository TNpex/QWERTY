import { describe, it, expect } from 'vitest';
import type { Product } from '../types';
import {
  activeStoreProfiles,
  assortmentBlock,
  downloadStoreProfile,
  effectiveMinimum,
  EMPTY_STORE_PROFILE,
  isBanned,
  isProfileEmpty,
  normalizeStoreProfile,
  profileOf,
  storeAcceptsTransfer,
  storeCanDonate,
  storeProfileFileName,
  storeProfileSettings,
  storeRuleText,
  storeRuleView,
  storeRuleViews,
  storeSellsProduct,
  summarizeStoreProfiles,
  type StoreProfile,
} from './storeRules';
import { EMPTY_SETTINGS } from './settings';

/** Товары с разной ориентацией: теннис (обувь), падел, теннис (струны), прочее */
const TENNIS_SHOE: Product = {
  id: 'p1',
  name: 'Кроссовки женские Nike Vapor',
  brand: 'Nike',
  category: 'Обувь',
  price: 8990,
  article: 'NK-1',
  link: 'nk-1',
};
const PADEL_RACKET: Product = {
  id: 'p2',
  name: 'Ракетка Babolat Technical Viper для падела',
  brand: 'Babolat',
  category: 'Падел - Ракетки',
  price: 24990,
  article: 'BB-2',
  link: 'bb-2',
};
const TENNIS_STRING: Product = {
  id: 'p3',
  name: 'Струна теннисная Solinco Hyper-G',
  brand: 'Solinco',
  category: 'Теннисные струны',
  price: 1500,
  article: 'SOL-3',
  link: 'sol-3',
};
const UNIVERSAL: Product = {
  id: 'p4',
  name: 'Намотка универсальная 7/6',
  brand: '7/6',
  category: 'Аксессуары',
  price: 490,
  article: 'UNI-4',
};

const PRODUCTS = [TENNIS_SHOE, PADEL_RACKET, TENNIS_STRING, UNIVERSAL];
const STORES = [
  'Екатеринбург (Парина)',
  'Екатеринбург (Елизаветинское шоссе)',
  'Уфа',
];

function settingsWith(profiles: Record<string, Partial<StoreProfile>> = {}, minimums = {}) {
  const storeProfiles: Record<string, StoreProfile> = {};
  for (const [name, patch] of Object.entries(profiles)) {
    storeProfiles[name] = { ...EMPTY_STORE_PROFILE, ...patch };
  }
  return { ...EMPTY_SETTINGS, storeProfiles, storeMinimums: minimums };
}

describe('profileOf / normalizeStoreProfile', () => {
  it('для неизвестного магазина — профиль по умолчанию', () => {
    const profile = profileOf(EMPTY_SETTINGS, 'Уфа');
    expect(profile).toEqual(EMPTY_STORE_PROFILE);
    expect(isProfileEmpty(profile)).toBe(true);
  });

  it('пустой профиль считается неактивным, с правилами — активным', () => {
    expect(isProfileEmpty({ ...EMPTY_STORE_PROFILE, note: '   ' })).toBe(true);
    expect(isProfileEmpty({ ...EMPTY_STORE_PROFILE, defaultMinimum: 2 })).toBe(false);
    expect(isProfileEmpty({ ...EMPTY_STORE_PROFILE, bannedProducts: { a: true } })).toBe(false);
  });

  it('нормализация: только допустимые значения, дубли категорий схлопываются', () => {
    const profile = normalizeStoreProfile({
      sport: 'padel',
      hiddenCategories: ['Струны', 'Струны', 42],
      transfersDisabled: true,
      defaultMinimum: 2.6,
      bannedProducts: { 'nk-1': true, 'bb-2': false },
      note: 'точка в ТЦ',
    });
    expect(profile.sport).toBe('padel');
    expect(profile.hiddenCategories).toEqual(['Струны']);
    expect(profile.transfersDisabled).toBe(true);
    expect(profile.defaultMinimum).toBe(3);
    expect(profile.bannedProducts).toEqual({ 'nk-1': true });
  });

  it('мусор вместо профиля → значения по умолчанию', () => {
    expect(normalizeStoreProfile(null)).toEqual(EMPTY_STORE_PROFILE);
    expect(normalizeStoreProfile('строка')).toEqual(EMPTY_STORE_PROFILE);
  });
});

describe('🚫 запрет товара в магазине', () => {
  const settings = settingsWith({
    'Екатеринбург (Елизаветинское шоссе)': { bannedProducts: { 'nk-1': true } },
  });

  it('запрещён только в указанном магазине: на Парина — нет', () => {
    expect(isBanned(settings, 'Екатеринбург (Елизаветинское шоссе)', TENNIS_SHOE)).toBe(true);
    expect(isBanned(settings, 'Екатеринбург (Парина)', TENNIS_SHOE)).toBe(false);
    expect(isBanned(settings, 'Екатеринбург (Елизаветинское шоссе)', PADEL_RACKET)).toBe(false);
  });

  it('запрет сильнее всех остальных правил (спорт, категории, минимум)', () => {
    const strict = settingsWith({
      Уфа: { sport: 'padel', bannedProducts: { 'bb-2': true }, defaultMinimum: 5 },
    });
    // падел-товар подошёл бы по спорту, но запрещён индивидуально
    expect(assortmentBlock(strict, 'Уфа', PADEL_RACKET)?.reason).toBe('banned');
    expect(storeSellsProduct(strict, 'Уфа', PADEL_RACKET)).toBe(false);
    expect(storeAcceptsTransfer(strict, 'Уфа', PADEL_RACKET)).toBe(false);
  });

  it('снятие запрета одной кнопкой возвращает товар в перемещения', () => {
    const cleared = settingsWith({
      'Екатеринбург (Елизаветинское шоссе)': { bannedProducts: {} },
    });
    expect(isBanned(cleared, 'Екатеринбург (Елизаветинское шоссе)', TENNIS_SHOE)).toBe(false);
    expect(storeAcceptsTransfer(cleared, 'Екатеринбург (Елизаветинское шоссе)', TENNIS_SHOE)).toBe(
      true
    );
  });
});

describe('⛔ ассортимент точки: вид спорта и категории', () => {
  const padelOnly = settingsWith({ Уфа: { sport: 'padel' } });

  it('магазин «только падел» не получает теннисный инвентарь', () => {
    expect(storeSellsProduct(padelOnly, 'Уфа', TENNIS_STRING)).toBe(false);
    expect(assortmentBlock(padelOnly, 'Уфа', TENNIS_STRING)?.label).toBe(
      '⛔ магазин не продаёт «Теннис»'
    );
    expect(storeSellsProduct(padelOnly, 'Уфа', PADEL_RACKET)).toBe(true);
  });

  it('одежда и обувь универсальны — падел-точка их получает', () => {
    // обувь и одежда носят ориентацию «Теннис/Падел», поэтому подходят любой точке:
    // иначе магазин «только падел» терял бы весь ассортимент одежды
    expect(storeSellsProduct(padelOnly, 'Уфа', TENNIS_SHOE)).toBe(true);
    expect(assortmentBlock(padelOnly, 'Уфа', TENNIS_SHOE)).toBeNull();
  });

  it('универсальные товары («Теннис/Падел», прочее) подходят любой точке', () => {
    expect(storeSellsProduct(padelOnly, 'Уфа', UNIVERSAL)).toBe(true);
  });

  it('ручная ориентация «Теннис» возвращает товар под правило вида спорта', () => {
    const manual = {
      ...padelOnly,
      sportOverrides: { 'nk-1': 'tennis' as const },
    };
    // кроссовки помечены теннисными вручную → падел-точка их не получает
    expect(storeSellsProduct(manual, 'Уфа', TENNIS_SHOE)).toBe(false);
    expect(storeRuleView(manual, 'Уфа', TENNIS_SHOE).status).toBe('not-sold');
  });

  it('скрытая категория исключает товар, остальные не трогает', () => {
    const hidden = settingsWith({ Уфа: { hiddenCategories: ['Теннисные струны'] } });
    expect(storeSellsProduct(hidden, 'Уфа', TENNIS_STRING)).toBe(false);
    expect(storeSellsProduct(hidden, 'Уфа', TENNIS_SHOE)).toBe(true);
    expect(assortmentBlock(hidden, 'Уфа', TENNIS_STRING)?.reason).toBe('category');
  });

  it('без профиля магазин принимает всё', () => {
    for (const product of PRODUCTS) {
      expect(storeAcceptsTransfer(EMPTY_SETTINGS, 'Уфа', product)).toBe(true);
    }
  });
});

describe('📴 перемещения магазина', () => {
  it('выключенные перемещения убирают точку из получателей и доноров', () => {
    const off = settingsWith({ Уфа: { transfersDisabled: true } });
    expect(storeAcceptsTransfer(off, 'Уфа', TENNIS_SHOE)).toBe(false);
    expect(storeCanDonate(off, 'Уфа')).toBe(false);
    // ассортимент при этом не меняется (норматив дозакупки остаётся)
    expect(storeSellsProduct(off, 'Уфа', TENNIS_SHOE)).toBe(true);
  });

  it('по умолчанию магазин участвует в перемещениях', () => {
    expect(storeCanDonate(EMPTY_SETTINGS, 'Уфа')).toBe(true);
  });
});

describe('⭐ минимумы: индивидуальный перекрывает минимум магазина', () => {
  const settings = settingsWith({ Уфа: { defaultMinimum: 2 } }, { Уфа: { 'nk-1': 5 } });

  it('индивидуальный минимум товара важнее профиля', () => {
    expect(effectiveMinimum(settings, 'Уфа', 'nk-1')).toEqual({ min: 5, source: 'product' });
  });

  it('без индивидуального — минимум по умолчанию из профиля', () => {
    expect(effectiveMinimum(settings, 'Уфа', 'bb-2')).toEqual({ min: 2, source: 'store' });
  });

  it('без правил — минимума нет', () => {
    expect(effectiveMinimum(EMPTY_SETTINGS, 'Уфа', 'bb-2')).toEqual({ min: 0, source: null });
  });
});

describe('статусы в строке магазина (карточка товара)', () => {
  it('🚫 запрещено / ⭐ минимум N шт. / ✅ разрешено', () => {
    const settings = settingsWith(
      {
        'Екатеринбург (Елизаветинское шоссе)': { bannedProducts: { 'nk-1': true } },
        'Екатеринбург (Парина)': {},
      },
      { 'Екатеринбург (Парина)': { 'nk-1': 4 } }
    );
    const banned = storeRuleView(settings, 'Екатеринбург (Елизаветинское шоссе)', TENNIS_SHOE);
    expect(banned.status).toBe('banned');
    expect(banned.icon).toBe('🚫');
    expect(banned.blocked).toBe(true);

    const minimum = storeRuleView(settings, 'Екатеринбург (Парина)', TENNIS_SHOE);
    expect(minimum.status).toBe('minimum');
    expect(minimum.label).toBe('минимум 4 шт.');
    expect(minimum.icon).toBe('⭐');

    const allowed = storeRuleView(settings, 'Уфа', TENNIS_SHOE);
    expect(allowed.status).toBe('allowed');
    expect(storeRuleText(allowed)).toBe('✅ перемещение разрешено');
  });

  it('⛔ магазин не продаёт «Теннис»', () => {
    const settings = settingsWith({ Уфа: { sport: 'padel' } });
    const view = storeRuleView(settings, 'Уфа', TENNIS_STRING);
    expect(view.status).toBe('not-sold');
    expect(view.label).toBe('магазин не продаёт «Теннис»');
    expect(storeRuleText(view)).toBe('⛔ магазин не продаёт «Теннис»');
  });

  it('⛔ скрытая категория и 📴 выключенные перемещения', () => {
    const byCategory = storeRuleView(
      settingsWith({ Уфа: { hiddenCategories: ['Теннисные струны'] } }),
      'Уфа',
      TENNIS_STRING
    );
    expect(byCategory.status).toBe('category-hidden');

    const transfersOff = storeRuleView(
      settingsWith({ Уфа: { transfersDisabled: true } }),
      'Уфа',
      TENNIS_SHOE
    );
    expect(transfersOff.status).toBe('transfers-off');
    expect(storeRuleText(transfersOff)).toBe('📴 перемещения магазина выключены');
  });

  it('приоритет статусов: запрет важнее спорта, спорт важнее перемещений', () => {
    const settings = settingsWith({
      Уфа: { sport: 'padel', transfersDisabled: true, bannedProducts: { 'nk-1': true } },
    });
    expect(storeRuleView(settings, 'Уфа', TENNIS_SHOE).status).toBe('banned');
    expect(storeRuleView(settings, 'Уфа', TENNIS_STRING).status).toBe('not-sold');
    expect(storeRuleView(settings, 'Уфа', PADEL_RACKET).status).toBe('transfers-off');
    expect(storeRuleView(settings, 'Уфа', UNIVERSAL).status).toBe('transfers-off');
  });

  it('storeRuleViews отдаёт строку на каждый магазин', () => {
    const views = storeRuleViews(EMPTY_SETTINGS, STORES, TENNIS_SHOE);
    expect(views.map((v) => v.storeName)).toEqual(STORES);
    expect(views.every((v) => v.status === 'allowed')).toBe(true);
  });
});

describe('сводка профилей (плашка в «Перемещениях»)', () => {
  it('считает, сколько товаров отсекает каждая точка и почему', () => {
    const settings = settingsWith({
      'Екатеринбург (Парина)': { sport: 'padel' },
      Уфа: { hiddenCategories: ['Теннисные струны'], bannedProducts: { 'nk-1': true } },
    });
    const summary = summarizeStoreProfiles(PRODUCTS, settings, STORES);
    const parina = summary.find((s) => s.storeName === 'Екатеринбург (Парина)')!;
    // теннисными остались только струны: обувь и аксессуары — «Теннис/Падел»
    expect(parina.excluded.sport).toBe(1);
    expect(parina.excluded.total).toBe(1);
    expect(parina.products).toBe(4);

    const ufa = summary.find((s) => s.storeName === 'Уфа')!;
    expect(ufa.excluded.category).toBe(1);
    expect(ufa.excluded.banned).toBe(1);
    expect(ufa.excluded.total).toBe(2);

    const liz = summary.find((s) => s.storeName === 'Екатеринбург (Елизаветинское шоссе)')!;
    expect(liz.active).toBe(false);
    expect(liz.excluded.total).toBe(0);
  });

  it('activeStoreProfiles оставляет только точки с правилами', () => {
    const settings = settingsWith({
      Уфа: { transfersDisabled: true },
      'Екатеринбург (Парина)': { defaultMinimum: 2 },
    });
    const active = activeStoreProfiles(PRODUCTS, settings, STORES);
    expect(active.map((s) => s.storeName).sort()).toEqual(
      ['Уфа', 'Екатеринбург (Парина)'].sort()
    );
  });
});

describe('экспорт профиля магазина', () => {
  it('профиль — это product-settings.json только с данными точки', () => {
    const settings = settingsWith(
      { Уфа: { sport: 'padel', bannedProducts: { 'nk-1': true } } },
      { Уфа: { 'bb-2': 3 }, 'Екатеринбург (Парина)': { 'nk-1': 2 } }
    );
    const exported = storeProfileSettings(settings, 'Уфа');
    expect(exported.storeProfiles).toEqual({
      Уфа: { ...EMPTY_STORE_PROFILE, sport: 'padel', bannedProducts: { 'nk-1': true } },
    });
    expect(exported.storeMinimums).toEqual({ Уфа: { 'bb-2': 3 } });
    expect(exported.sportOverrides).toEqual({});
  });

  it('имя файла безопасное и узнаваемое', () => {
    expect(storeProfileFileName('Уфа')).toBe('product-settings-уфа.json');
    expect(storeProfileFileName('Санкт-Петербург (Ярослава Гашека)')).toBe(
      'product-settings-санкт-петербург-ярослава-гашека.json'
    );
    expect(storeProfileFileName('  ')).toBe('product-settings-store.json');
  });

  it('downloadStoreProfile вне браузера не падает и возвращает имя файла', () => {
    expect(downloadStoreProfile(EMPTY_SETTINGS, 'Уфа')).toBe('product-settings-уфа.json');
  });
});
