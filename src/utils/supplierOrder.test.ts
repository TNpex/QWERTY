import { describe, it, expect } from 'vitest';
import {
  SUPPLIER_COLUMNS,
  SUPPLIER_COLUMN_WIDTHS,
  supplierFileName,
  supplierSheetRow,
  supplierSheetRows,
  supplierTotalCost,
  type SupplierRow,
} from './supplierOrder';

/**
 * Состав заявки поставщику: в XLSX остаются только Артикул, Название, Бренд,
 * Категория, Пол, Размер, Заказать шт. Внутренние числа сети (остатки,
 * нормативы, цены, сумма) в файл не попадают — сумма видна в интерфейсе.
 */

const ROW: SupplierRow = {
  article: 'TS76-BKWH',
  name: 'Кроссовки 7/6 TS76 Black/White',
  brand: '7/6',
  category: 'Обувь',
  gender: 'female',
  size: '42,5',
  toOrder: 4,
};

const FORBIDDEN = ['В наличии (сеть)', 'Норматив (сеть)', 'Цена, ₽', 'Сумма, ₽'];

describe('заявка поставщику: состав колонок', () => {
  it('ровно семь нужных колонок в нужном порядке', () => {
    expect([...SUPPLIER_COLUMNS]).toEqual([
      'Артикул',
      'Название',
      'Бренд',
      'Категория',
      'Пол',
      'Размер',
      'Заказать, шт.',
    ]);
    expect(Object.keys(supplierSheetRow(ROW))).toEqual([...SUPPLIER_COLUMNS]);
    expect(SUPPLIER_COLUMN_WIDTHS).toHaveLength(SUPPLIER_COLUMNS.length);
  });

  it('внутренние числа сети в файл не попадают', () => {
    const row = supplierSheetRow(ROW);
    for (const column of FORBIDDEN) {
      expect(column in row, `в заявке не должно быть колонки «${column}»`).toBe(false);
    }
    expect(JSON.stringify(supplierSheetRows([ROW, ROW]))).not.toContain('Цена');
    expect(JSON.stringify(supplierSheetRows([ROW]))).not.toContain('Сумма');
  });

  it('значения переносятся как есть, пол — человекочитаемо', () => {
    expect(supplierSheetRow(ROW)).toEqual({
      'Артикул': 'TS76-BKWH',
      'Название': 'Кроссовки 7/6 TS76 Black/White',
      'Бренд': '7/6',
      'Категория': 'Обувь',
      'Пол': 'Женская',
      'Размер': '42,5',
      'Заказать, шт.': 4,
    });
    // уже подписанный пол (из GENDER_LABELS) не портится
    expect(supplierSheetRow({ ...ROW, gender: 'Мужская' })['Пол']).toBe('Мужская');
    expect(supplierSheetRow({ ...ROW, gender: 'unisex' })['Пол']).toBe('Унисекс');
  });

  it('построчно по размерам: сколько строк — столько и позиций', () => {
    const rows = supplierSheetRows([
      ROW,
      { ...ROW, size: '43', toOrder: 2 },
      { ...ROW, article: 'BB-2', name: 'Ракетка Babolat', toOrder: 1 },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r['Заказать, шт.'])).toEqual([4, 2, 1]);
  });
});

describe('имя файла и сумма заявки', () => {
  it('имя файла: безопасный ярлык и дата', () => {
    expect(supplierFileName('Nike/Обувь', '2026-09-25')).toBe('Заявка_Nike_Обувь_2026-09-25.xlsx');
    expect(supplierFileName('', '2026-09-25')).toBe('Заявка_все_бренды_2026-09-25.xlsx');
    expect(supplierFileName('Очень длинный ярлык фильтра', '2026-09-25').length).toBeLessThan(70);
  });

  it('сумма заявки считается для интерфейса (в файл не идёт)', () => {
    expect(
      supplierTotalCost([
        { toOrder: 4, price: 8990 },
        { toOrder: 2, price: 1500 },
      ])
    ).toBe(38960);
    expect(supplierTotalCost([])).toBe(0);
  });
});
