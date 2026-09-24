import { GENDER_LABELS, type Gender } from './productMeta';

/**
 * Заявка поставщику (XLSX).
 *
 * В файле остаются только те колонки, которые нужны поставщику для сборки
 * заказа: Артикул, Название, Бренд, Категория, Пол, Размер, Заказать шт.
 * «В наличии (сеть)», «Норматив (сеть)», «Цена» и «Сумма» — ВНУТРЕННИЕ числа
 * сети (в интерфейсе сумма заявки осталась), поставщику их не отдаём.
 */

export const SUPPLIER_COLUMNS = [
  'Артикул',
  'Название',
  'Бренд',
  'Категория',
  'Пол',
  'Размер',
  'Заказать, шт.',
] as const;

/** Ширины колонок для XLSX (в символах) */
export const SUPPLIER_COLUMN_WIDTHS = [
  { wch: 14 },
  { wch: 52 },
  { wch: 12 },
  { wch: 18 },
  { wch: 10 },
  { wch: 9 },
  { wch: 13 },
];

export interface SupplierRow {
  article: string;
  name: string;
  brand: string;
  category: string;
  gender: Gender | string;
  size: string;
  /** Сколько заказать, шт. */
  toOrder: number;
}

/** Строка заявки → объект с русскими заголовками колонок (порядок = SUPPLIER_COLUMNS) */
export function supplierSheetRow(row: SupplierRow): Record<string, string | number> {
  return {
    'Артикул': row.article,
    'Название': row.name,
    'Бренд': row.brand,
    'Категория': row.category,
    'Пол': typeof row.gender === 'string' && row.gender in GENDER_LABELS
      ? GENDER_LABELS[row.gender as Gender]
      : String(row.gender ?? ''),
    'Размер': row.size,
    'Заказать, шт.': row.toOrder,
  };
}

export function supplierSheetRows(rows: SupplierRow[]): Record<string, string | number>[] {
  return rows.map(supplierSheetRow);
}

/** Имя файла заявки: Заявка_<фильтр>_<дата>.xlsx */
export function supplierFileName(label: string, date = new Date().toISOString().slice(0, 10)): string {
  const safeLabel = label.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 40) || 'все_бренды';
  return `Заявка_${safeLabel}_${date}.xlsx`;
}

/** Сумма заявки (внутренняя метрика — в XLSX не попадает) */
export function supplierTotalCost(
  rows: { toOrder: number; price: number }[]
): number {
  return rows.reduce((sum, row) => sum + row.toOrder * row.price, 0);
}
