import { describe, it, expect } from 'vitest';
import {
  parseRowsToData,
  detectColumns,
  parseQuantity,
  parsePrice,
  buildStoreResolver,
  parseSizesAndStores,
} from './xlsxParser';

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

  it('определяет широкий формат (колонки-магазины)', () => {
    const mapping = detectColumns([
      'Категория', 'Артикул', 'Название', 'Бренд', 'Цена', 'Размеры и наличие',
      'Спб_Спортивная', 'Екб_Склад',
    ]);
    expect(mapping.format).toBe('wide');
    if (mapping.format === 'wide') {
      expect(mapping.storeColumns).toEqual(['Спб_Спортивная', 'Екб_Склад']);
      expect(mapping.sizesTextCol).toBe('Размеры и наличие');
    }
  });

  it('НЕ создаёт фейковые магазины из служебных колонок', () => {
    // Защита от бага: «Размер»/«Количество» без «Магазина» не должны стать магазинами
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
    expect(parsePrice('8990,00')).toBe(8990);
    expect(parsePrice(1234.5)).toBe(1235);
    expect(parsePrice('бесплатно')).toBe(0);
  });
});

describe('buildStoreResolver', () => {
  const resolver = buildStoreResolver(['Спб_Спортивная', 'Екб_Склад', 'Уфа']);

  it('резолвит через жёсткий маппинг', () => {
    expect(resolver.resolve('Санкт-Петербург (Спортивная)')).toBe('Спб_Спортивная');
    expect(resolver.resolve('основной склад екатеринбург')).toBe('Екб_Склад');
  });

  it('резолвит точным и подстрочным совпадением с колонкой', () => {
    expect(resolver.resolve('СПБ_СПОРТИВНАЯ')).toBe('Спб_Спортивная');
    expect(resolver.resolve('магазин Уфа')).toBe('Уфа');
  });

  it('нераспознанные названия возвращает null и запоминает', () => {
    expect(resolver.resolve('Нарния')).toBeNull();
    expect(resolver.getUnknown()).toContain('Нарния');
  });
});

describe('parseSizesAndStores', () => {
  it('парсит текст «43: Магазин - 2 шт | 44: Магазин - 1 пар»', () => {
    const resolver = buildStoreResolver(['Спб_Спортивная', 'Екб_Склад']);
    const result = parseSizesAndStores(
      '43: Санкт-Петербург (Спортивная) - 2 шт | Екб_Склад - 4 | 44: Спб_Спортивная - 1 пар',
      resolver
    );
    expect(result.get('Спб_Спортивная')?.get('43')).toBe(2);
    expect(result.get('Спб_Спортивная')?.get('44')).toBe(1);
    expect(result.get('Екб_Склад')?.get('43')).toBe(4);
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

describe('parseRowsToData: длинный формат', () => {
  const rows = [
    { Товар: 'Кроссовки Nike', Бренд: 'Nike', Размер: '42', Магазин: 'ТЦ Европа', Количество: '3', Цена: '8990', Категория: 'Обувь' },
    { Товар: 'Кроссовки Nike', Бренд: 'Nike', Размер: '43', Магазин: 'ТЦ Европа', Количество: '0' },
    { Товар: 'Кроссовки Nike', Бренд: 'Nike', Размер: '42', Магазин: 'Склад', Количество: '5' },
    // дубль — должен суммироваться с первой строкой
    { Товар: 'Кроссовки Nike', Бренд: 'Nike', Размер: '42', Магазин: 'ТЦ Европа', Количество: '1' },
    // мусорные строки — должны пропускаться с предупреждением
    { Товар: '', Бренд: '', Размер: '', Магазин: 'Склад', Количество: '2' },
    { Товар: 'Мяч', Бренд: '', Размер: '', Магазин: 'Склад', Количество: 'много' },
  ];

  const parsed = parseRowsToData(rows);

  it('формат определён как long', () => {
    expect(parsed.format).toBe('long');
  });

  it('создаёт магазины, товары и остатки корректно', () => {
    expect(parsed.stores).toHaveLength(2);
    expect(parsed.products).toHaveLength(1);
    expect(parsed.products[0].name).toBe('Кроссовки Nike');
    expect(parsed.products[0].price).toBe(8990);
    // 42@Европа (3+1), 43@Европа (0), 42@Склад (5)
    expect(parsed.inventory).toHaveLength(3);
    const nike42europa = parsed.inventory.find(
      (i) => i.size === '42' && i.storeId === parsed.stores.find((s) => s.name === 'ТЦ Европа')!.id
    );
    expect(nike42europa?.quantity).toBe(4);
  });

  it('предупреждает о пропущенных строках', () => {
    expect(parsed.warnings?.join(' ')).toMatch(/Пропущено строк: 2/);
  });

  it('не помечает ничего как notCarried (отсутствие строки = не возит)', () => {
    expect(parsed.inventory.every((i) => !i.notCarried)).toBe(true);
  });
});

describe('parseRowsToData: широкий формат с текстом «Размеры и наличие»', () => {
  const rows = [
    {
      Категория: 'Обувь',
      Артикул: 'NK-1',
      Название: 'Кроссовки Nike',
      Бренд: 'Nike',
      Цена: '8990',
      'Размеры и наличие': '43: Санкт-Петербург (Спортивная) - 2 шт | 44: Екб_Склад - 1 пар',
      Спб_Спортивная: '',
      Екб_Склад: '',
    },
  ];

  const parsed = parseRowsToData(rows);

  it('магазин из текста → его размеры; отсутствующий размер у упомянутого магазина = OOS (не notCarried)', () => {
    const spb = parsed.stores.find((s) => s.name === 'Спб_Спортивная')!;
    const ekb = parsed.stores.find((s) => s.name === 'Екб_Склад')!;
    const inv = (storeId: string, size: string) =>
      parsed.inventory.find((i) => i.storeId === storeId && i.size === size);

    expect(inv(spb.id, '43')?.quantity).toBe(2);
    expect(inv(spb.id, '43')?.notCarried).toBeUndefined();
    // Спб упомянут в данных товара → размер 44 у него «возит, но ноль»
    expect(inv(spb.id, '44')?.quantity).toBe(0);
    expect(inv(spb.id, '44')?.notCarried).toBeUndefined();
    expect(inv(ekb.id, '44')?.quantity).toBe(1);
    expect(inv(ekb.id, '43')?.quantity).toBe(0);
  });
});

describe('parseRowsToData: широкий формат, числовые колонки', () => {
  const rows = [
    { Название: 'Мяч Wilson', Спб_Спортивная: '4', Екб_Склад: '', Уфа: '0' },
  ];

  const parsed = parseRowsToData(rows);

  it('число → carried; пустая ячейка → notCarried; «0» → carried OOS', () => {
    const spb = parsed.stores.find((s) => s.name === 'Спб_Спортивная')!;
    const ekb = parsed.stores.find((s) => s.name === 'Екб_Склад')!;
    const ufa = parsed.stores.find((s) => s.name === 'Уфа')!;
    const inv = (storeId: string) => parsed.inventory.find((i) => i.storeId === storeId)!;

    expect(inv(spb.id).quantity).toBe(4);
    expect(inv(spb.id).notCarried).toBeUndefined();

    expect(inv(ekb.id).notCarried).toBe(true);
    expect(inv(ekb.id).quantity).toBe(0);

    expect(inv(ufa.id).quantity).toBe(0);
    expect(inv(ufa.id).notCarried).toBeUndefined(); // явный ноль — это «нет в наличии»
  });
});

describe('parseRowsToData: ошибки и предупреждения', () => {
  it('пустой файл → ошибка', () => {
    expect(() => parseRowsToData([])).toThrow(/Файл пустой/);
  });

  it('нераспознанный магазин в тексте → предупреждение', () => {
    const rows = [
      {
        Название: 'Кроссовки',
        'Размеры и наличие': '43: Нарния - 2 шт',
        Спб_Спортивная: '1',
      },
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
