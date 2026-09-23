import { describe, it, expect } from 'vitest';
import {
  parseRowsToData,
  detectColumns,
  parseQuantity,
  parsePrice,
  buildStoreResolver,
  parseSizesAndStores,
} from './xlsxParser';

// Канонические названия магазинов (как в колонках реального products.csv)
const SPB_SPORT = 'Санкт-Петербург (Спортивная)';
const SPB_YAR = 'Санкт-Петербург (Ярослава Гашека)';
const EKB_SKLAD = 'Екатеринбург (Основной склад)';
const EKB_PARINA = 'Екатеринбург (Парина)';

describe('detectColumns', () => {
  it('определяет длинный формат (Товар/Магазин/Количество)', () => {
    const mapping = detectColumns(['Товар', 'Бренд', 'Размер', 'Магазин', 'Количество', 'Цена']);
    expect(mapping.format).toBe('long');
    if (mapping.format === 'long') {
      expect(mapping.nameCol).toBe('Товар');
      expect(mapping.storeCol).toBe('Магазин');
      expect(mapping.qtyCol).toBe('Количество');
      expect(mapping.sizeCol).toBe('Размер');
    }
  });

  it('определяет широкий формат реального products.csv', () => {
    const mapping = detectColumns([
      'Категория', 'Артикул', 'Название', 'Бренд', 'Цена', 'Ссылка',
      'Размеры и наличие', 'Всего', 'Фото',
      SPB_YAR, SPB_SPORT, EKB_SKLAD, EKB_PARINA, 'Тюмень (Народная)', 'Уфа', 'Ижевск',
    ]);
    expect(mapping.format).toBe('wide');
    if (mapping.format === 'wide') {
      expect(mapping.storeColumns).toEqual([
        SPB_YAR, SPB_SPORT, EKB_SKLAD, EKB_PARINA, 'Тюмень (Народная)', 'Уфа', 'Ижевск',
      ]);
      expect(mapping.sizesTextCol).toBe('Размеры и наличие');
    }
  });

  it('НЕ создаёт фейковые магазины из служебных колонок', () => {
    const mapping = detectColumns(['Название', 'Размер', 'Количество', 'Уфа', 'Ижевск']);
    expect(mapping.format).toBe('wide');
    if (mapping.format === 'wide') {
      expect(mapping.storeColumns).toEqual(['Уфа', 'Ижевск']);
    }
  });

  it('точное совпадение приоритетнее подстрочного, «Цена со скидкой» не магазин', () => {
    const mapping = detectColumns(['Название', 'Цена со скидкой', 'Цена', 'Уфа']);
    if (mapping.format === 'wide') {
      expect(mapping.priceCol).toBe('Цена');
      expect(mapping.storeColumns).toEqual(['Уфа']);
    } else {
      throw new Error('ожидался широкий формат');
    }
  });

  it('бросает понятную ошибку без колонки названия', () => {
    expect(() => detectColumns(['Магазин', 'Количество'])).toThrow(/Не найдена колонка «Название»/);
  });

  it('бросает понятную ошибку, когда колонки магазинов не найдены', () => {
    expect(() => detectColumns(['Название', 'Бренд', 'Цена'])).toThrow(/Не найдены колонки магазинов/);
  });
});

describe('parseQuantity / parsePrice', () => {
  it('quantity: числа, текст с единицами, мусор', () => {
    expect(parseQuantity(3)).toBe(3);
    expect(parseQuantity('3 шт')).toBe(3);
    expect(parseQuantity(' 12 ')).toBe(12);
    expect(parseQuantity('-2')).toBe(0);
    expect(parseQuantity('много')).toBeNull();
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity(undefined)).toBeNull();
  });

  it('price: российские форматы', () => {
    expect(parsePrice('8990')).toBe(8990);
    expect(parsePrice('8 990 ₽')).toBe(8990);
    expect(parsePrice('4990 ₽')).toBe(4990);
    expect(parsePrice('8990,00')).toBe(8990);
    expect(parsePrice(1234.5)).toBe(1235);
    expect(parsePrice('бесплатно')).toBe(0);
  });
});

describe('buildStoreResolver', () => {
  const resolver = buildStoreResolver([SPB_SPORT, EKB_SKLAD, 'Уфа', 'Тюмень (Народная)']);

  it('резолвит полное название точно (скобки игнорируются)', () => {
    expect(resolver.resolve('Санкт-Петербург (Спортивная)')).toBe(SPB_SPORT);
    expect(resolver.resolve('санкт-петербург спортивная')).toBe(SPB_SPORT);
  });

  it('резолвит через жёсткий маппинг', () => {
    expect(resolver.resolve('основной склад екатеринбург')).toBe(EKB_SKLAD);
    expect(resolver.resolve('Основной склад')).toBe(EKB_SKLAD);
  });

  it('резолвит короткие названия из текста «Размеры и наличие»', () => {
    expect(resolver.resolve('Спортивная')).toBe(SPB_SPORT);
    expect(resolver.resolve('Тюмень (Народная)')).toBe('Тюмень (Народная)');
    expect(resolver.resolve('народная')).toBe('Тюмень (Народная)');
  });

  it('устаревшие короткие колонки тоже резолвятся (обратная совместимость)', () => {
    const legacy = buildStoreResolver(['Спб_Спортивная', 'Екб_Склад']);
    expect(legacy.resolve('спб_спортивная')).toBe('Спб_Спортивная');
    expect(legacy.resolve('Санкт-Петербург (Спортивная)')).toBeNull(); // маппинг указывает на отсутствующую колонку → fallback не сработал
  });

  it('нераспознанные названия возвращает null и запоминает', () => {
    expect(resolver.resolve('Нарния')).toBeNull();
    expect(resolver.getUnknown()).toContain('Нарния');
  });

  it('probe не записывает в нераспознанные', () => {
    expect(resolver.probe('43')).toBeNull();
    expect(resolver.getUnknown()).not.toContain('43');
  });
});

describe('parseSizesAndStores', () => {
  it('формат «размер: магазин - N шт» с продолжениями', () => {
    const resolver = buildStoreResolver([SPB_SPORT, EKB_SKLAD]);
    const result = parseSizesAndStores(
      `43: ${SPB_SPORT} - 2 шт | Основной склад Екатеринбург - 4 | 44: Спб_Спортивная - 1 пар`,
      resolver
    );
    expect(result.get(SPB_SPORT)?.get('43')).toBe(2);
    expect(result.get(SPB_SPORT)?.get('44')).toBe(1);
    expect(result.get(EKB_SKLAD)?.get('43')).toBe(4);
  });

  it('формат реальных данных: «37,5: Парина - 1 пар | 38: ... »', () => {
    const resolver = buildStoreResolver([EKB_PARINA, SPB_SPORT, 'Ижевск']);
    const result = parseSizesAndStores(
      `37,5: Парина - 1 пар | 38: Парина - 1 пар | ${SPB_SPORT} - 1 пар | 38,5: Ижевск - 1 пар`,
      resolver
    );
    expect(result.get(EKB_PARINA)?.get('37,5')).toBe(1);
    expect(result.get(EKB_PARINA)?.get('38')).toBe(1);
    expect(result.get(SPB_SPORT)?.get('38')).toBe(1);
    expect(result.get('Ижевск')?.get('38,5')).toBe(1);
  });

  it('безразмерный формат «Магазин: N шт» (через двоеточие)', () => {
    const resolver = buildStoreResolver(['Уфа', SPB_SPORT, 'Тюмень (Народная)', 'Ижевск']);
    const result = parseSizesAndStores(
      `Уфа: 4 шт | ${SPB_SPORT}: 8 шт | Тюмень (Народная): 2 шт | Ижевск: 4 шт`,
      resolver
    );
    expect(result.get('Уфа')?.get('—')).toBe(4);
    expect(result.get(SPB_SPORT)?.get('—')).toBe(8);
    expect(result.get('Тюмень (Народная)')?.get('—')).toBe(2);
    expect(result.get('Ижевск')?.get('—')).toBe(4);
  });

  it('числовой префикс не считается магазином (не загрязняет unknown)', () => {
    const resolver = buildStoreResolver(['Уфа']);
    parseSizesAndStores('43: 2 шт', resolver);
    expect(resolver.getUnknown()).toEqual([]);
  });

  it('суммирует повторяющиеся размер+магазин', () => {
    const resolver = buildStoreResolver(['Уфа']);
    const result = parseSizesAndStores('42: Уфа - 1 | Уфа - 2', resolver);
    expect(result.get('Уфа')?.get('42')).toBe(3);
  });

  it('пустое значение → пустая Map', () => {
    const resolver = buildStoreResolver(['Уфа']);
    expect(parseSizesAndStores('', resolver).size).toBe(0);
    expect(parseSizesAndStores(null, resolver).size).toBe(0);
  });
});

describe('parseRowsToData: длинный формат (как sizes.csv)', () => {
  const rows = [
    { Размер: 'Без размера', Магазин: 'Уфа', Количество: '4', Артикул: 'ORS-1', Название: 'Чехол 7/6', Бренд: '7/6', Цена: '4990 ₽', Категория: 'Сумки и чехлы' },
    { Размер: '375', Магазин: 'Уфа', Количество: '1', Артикул: 'HQ1', Название: 'Кроссовки Nike', Бренд: 'Nike', Цена: '8990 ₽', Категория: 'Обувь' },
    { Размер: '38', Магазин: 'Ижевск', Количество: '2', Артикул: 'HQ1', Название: 'Кроссовки Nike', Бренд: 'Nike', Цена: '8990 ₽', Категория: 'Обувь' },
    // дубль — суммируется
    { Размер: '38', Магазин: 'Ижевск', Количество: '1', Артикул: 'HQ1', Название: 'Кроссовки Nike', Бренд: 'Nike', Цена: '8990 ₽', Категория: 'Обувь' },
    // мусор
    { Размер: '', Магазин: '', Количество: '2', Название: 'X' },
    { Размер: 'M', Магазин: 'Уфа', Количество: 'много', Название: 'Y' },
  ];

  const parsed = parseRowsToData(rows);

  it('формат long, магазины и товары', () => {
    expect(parsed.format).toBe('long');
    expect(parsed.stores.map((s) => s.name)).toEqual(['Уфа', 'Ижевск']);
    expect(parsed.products).toHaveLength(2);
  });

  it('нормализует размеры: «Без размера» → «—», «375» → «37,5»', () => {
    const sizes = parsed.inventory.map((i) => i.size).sort();
    expect(sizes).toContain('—');
    expect(sizes).toContain('37,5');
    expect(sizes).not.toContain('375');
    expect(sizes).not.toContain('Без размера');
  });

  it('дубликаты строк суммируются, мусор пропускается с предупреждением', () => {
    const izhevsk = parsed.stores.find((s) => s.name === 'Ижевск')!;
    const nike = parsed.products.find((p) => p.name === 'Кроссовки Nike')!;
    const item = parsed.inventory.find((i) => i.productId === nike.id && i.storeId === izhevsk.id && i.size === '38');
    expect(item?.quantity).toBe(3);
    expect(parsed.warnings?.join(' ')).toMatch(/Пропущено строк: 2/);
  });

  it('цена с символом ₽ парсится', () => {
    expect(parsed.products.find((p) => p.article === 'ORS-1')?.price).toBe(4990);
  });
});

describe('parseRowsToData: широкий формат (как products.csv)', () => {
  it('текст «Размеры и наличие» + явные нули и пустые ячейки в колонках', () => {
    const rows = [
      {
        Категория: 'Обувь', Артикул: 'HQ1', Название: 'Кроссовки Nike', Бренд: 'Nike',
        Цена: '8990 ₽', Ссылка: 'https://example.com/1',
        'Размеры и наличие': `43: ${SPB_SPORT} - 2 шт | 44: ${SPB_SPORT} - 1 шт`,
        Всего: '3', Фото: 'data\\product_images\\x.png',
        [SPB_SPORT]: '3', [EKB_SKLAD]: '0', ['Уфа']: '',
      },
    ];
    const parsed = parseRowsToData(rows);
    const spb = parsed.stores.find((s) => s.name === SPB_SPORT)!;
    const ekb = parsed.stores.find((s) => s.name === EKB_SKLAD)!;
    const ufa = parsed.stores.find((s) => s.name === 'Уфа')!;
    const inv = (sid: string, size: string) =>
      parsed.inventory.find((i) => i.storeId === sid && i.size === size);

    expect(inv(spb.id, '43')?.quantity).toBe(2);
    expect(inv(spb.id, '44')?.quantity).toBe(1);
    // Явный «0» в колонке → возит, но нет в наличии
    expect(inv(ekb.id, '43')?.quantity).toBe(0);
    expect(inv(ekb.id, '43')?.notCarried).toBeUndefined();
    expect(inv(ekb.id, '44')?.quantity).toBe(0);
    // Пустая ячейка → не возит
    expect(inv(ufa.id, '43')?.notCarried).toBe(true);
    expect(inv(ufa.id, '44')?.notCarried).toBe(true);
  });

  it('безразмерный текст «Магазин: N шт» (формат реальных данных)', () => {
    const rows = [
      {
        Категория: 'Сумки и чехлы', Артикул: 'ORS-1', Название: 'Чехол 7/6', Бренд: '7/6',
        Цена: '4990 ₽', 'Размеры и наличие': `Уфа: 4 шт | Ижевск: 2 шт`,
        Всего: '6', Фото: '', 'Уфа': '4', 'Ижевск': '2', [SPB_SPORT]: '0',
      },
    ];
    const parsed = parseRowsToData(rows);
    const ufa = parsed.stores.find((s) => s.name === 'Уфа')!;
    const spb = parsed.stores.find((s) => s.name === SPB_SPORT)!;
    const inv = (sid: string) => parsed.inventory.find((i) => i.storeId === sid);

    expect(inv(ufa.id)?.quantity).toBe(4);
    expect(inv(ufa.id)?.size).toBe('—');
    // СПб не упомянут в тексте, но в колонке явный 0 → возит, но нет в наличии
    expect(inv(spb.id)?.quantity).toBe(0);
    expect(inv(spb.id)?.notCarried).toBeUndefined();
  });

  it('числовые колонки без текста: пусто → notCarried, «0» → OOS', () => {
    const rows = [{ Название: 'Мяч Wilson', [SPB_SPORT]: '4', [EKB_SKLAD]: '', ['Уфа']: '0' }];
    const parsed = parseRowsToData(rows);
    const inv = (name: string) =>
      parsed.inventory.find((i) => i.storeId === parsed.stores.find((s) => s.name === name)!.id)!;

    expect(inv(SPB_SPORT).quantity).toBe(4);
    expect(inv(EKB_SKLAD).notCarried).toBe(true);
    expect(inv('Уфа').quantity).toBe(0);
    expect(inv('Уфа').notCarried).toBeUndefined();
  });
});

describe('parseRowsToData: ошибки и предупреждения', () => {
  it('пустой файл → ошибка', () => {
    expect(() => parseRowsToData([])).toThrow(/Файл пустой/);
  });

  it('нераспознанный магазин в тексте → предупреждение', () => {
    const rows = [
      { Название: 'Кроссовки', 'Размеры и наличие': '43: Нарния - 2 шт', [SPB_SPORT]: '1' },
    ];
    const parsed = parseRowsToData(rows);
    expect(parsed.warnings?.join(' ')).toMatch(/Нераспознанные магазины.*Нарния/);
  });

  it('uploadedAt проставляется', () => {
    const rows = [{ Товар: 'X', Магазин: 'Y', Количество: '1' }];
    const parsed = parseRowsToData(rows);
    expect(parsed.uploadedAt).toBeTruthy();
    expect(new Date(parsed.uploadedAt!).getTime()).not.toBeNaN();
  });
});
