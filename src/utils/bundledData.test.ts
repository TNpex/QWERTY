import { describe, it, expect } from 'vitest';
import { parseBundledRows, hashString } from './bundledData';
import { getMetrics } from './analyticsCore';
import { photoFileName } from './images';

const SPB_SPORT = 'Санкт-Петербург (Спортивная)';
const EKB_SKLAD = 'Екатеринбург (Основной склад)';

function catalogRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Категория: 'Обувь',
    Артикул: 'HQ1',
    Название: 'Кроссовки Nike',
    Бренд: 'Nike',
    Цена: '8990 ₽',
    Ссылка: 'https://saletennis.com/product/1/',
    'Размеры и наличие': '',
    Всего: '3',
    Фото: 'data\\product_images\\x.png',
    [SPB_SPORT]: '2',
    [EKB_SKLAD]: '1',
    ...overrides,
  };
}

function sizeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Размер: '42',
    Магазин: SPB_SPORT,
    Количество: '2',
    Артикул: 'HQ1',
    Категория: 'Обувь',
    Название: 'Кроссовки Nike',
    Бренд: 'Nike',
    Цена: '8990 ₽',
    Ссылка: 'https://saletennis.com/product/1/',
    ...overrides,
  };
}

describe('parseBundledRows', () => {
  const products = parseBundledRows([catalogRow()], [
    sizeRow(),
    sizeRow({ Размер: '43', Количество: '1', Магазин: EKB_SKLAD }),
  ]);

  it('магазины — из колонок каталога', () => {
    expect(products.stores.map((s) => s.name)).toEqual([SPB_SPORT, EKB_SKLAD]);
    expect(products.source).toBe('bundled');
  });

  it('товар получает стабильный id из ссылки и сохраняет link/price', () => {
    expect(products.products).toHaveLength(1);
    const p = products.products[0];
    // Ссылка нормализуется (хвостовой слэш отбрасывается) — id стабилен между парсингами
    expect(p.id).toBe(`p_${hashString('https://saletennis.com/product/1')}`);
    expect(p.link).toBe('https://saletennis.com/product/1');
    expect(p.price).toBe(8990);
    expect(p.article).toBe('HQ1');
    // идемпотентность: повторный парсинг даёт те же id; вариант со слэшем — тоже
    const again = parseBundledRows([catalogRow()], [sizeRow()]);
    expect(again.products[0].id).toBe(p.id);
    const withSlash = parseBundledRows(
      [catalogRow({ Ссылка: 'https://saletennis.com/product/1/' })],
      [sizeRow({ Ссылка: 'https://saletennis.com/product/1/' })]
    );
    expect(withSlash.products[0].id).toBe(p.id);
  });

  it('материализует отсутствующие размеры как нули в возящих магазинах', () => {
    // Размеры: 42 (СПб) и 43 (склад) → у СПб должен появиться 43:0, у склада 42:0
    const inv = (store: string, size: string) =>
      products.inventory.find(
        (i) => i.storeId === products.stores.find((s) => s.name === store)!.id && i.size === size
      );
    expect(inv(SPB_SPORT, '42')?.quantity).toBe(2);
    expect(inv(SPB_SPORT, '43')?.quantity).toBe(0);
    expect(inv(SPB_SPORT, '43')?.notCarried).toBeUndefined(); // именно «нет в наличии», не «не возит»
    expect(inv(EKB_SKLAD, '43')?.quantity).toBe(1);
    expect(inv(EKB_SKLAD, '42')?.quantity).toBe(0);
  });

  it('дубликаты артикулов (разные цвета) — разные товары по ссылке', () => {
    const parsed = parseBundledRows(
      [
        catalogRow({ Название: 'Капри - Black', Ссылка: 'https://s/1/', Всего: '5' }),
        catalogRow({ Название: 'Капри - Pink', Ссылка: 'https://s/2/', Всего: '1' }),
      ],
      [
        sizeRow({ Название: 'Капри - Black', Ссылка: 'https://s/1/', Количество: '5' }),
        sizeRow({ Название: 'Капри - Pink', Ссылка: 'https://s/2/', Количество: '1' }),
      ]
    );
    expect(parsed.products).toHaveLength(2);
    expect(parsed.products[0].id).not.toBe(parsed.products[1].id);
  });

  it('товар без строк в sizes.csv остаётся в каталоге (распродан)', () => {
    const parsed = parseBundledRows(
      [catalogRow(), catalogRow({ Артикул: 'SOLD', Название: 'Распродано', Ссылка: 'https://s/sold/', Всего: '0' })],
      [sizeRow()]
    );
    expect(parsed.products).toHaveLength(2);
    const soldOut = parsed.products.find((p) => p.article === 'SOLD')!;
    expect(parsed.inventory.some((i) => i.productId === soldOut.id)).toBe(false);
    expect(parsed.warnings?.join(' ')).toMatch(/распроданы/i);
    // метрики считают его распроданным
    const metrics = getMetrics(parsed);
    expect(metrics.soldOutProducts).toBe(1);
  });

  it('нормализует размеры из sizes.csv: 375 → 37,5, «Без размера» → «—»', () => {
    const parsed = parseBundledRows([catalogRow()], [
      sizeRow({ Размер: '375' }),
      sizeRow({ Размер: 'Без размера', Количество: '1', Магазин: EKB_SKLAD }),
    ]);
    const sizes = [...new Set(parsed.inventory.map((i) => i.size))].sort();
    expect(sizes).toContain('37,5');
    expect(sizes).toContain('—');
    expect(sizes).not.toContain('375');
  });

  it('неизвестный магазин в sizes.csv → предупреждение, строка пропускается', () => {
    const parsed = parseBundledRows([catalogRow()], [
      sizeRow(),
      sizeRow({ Магазин: 'Нарния', Размер: '44' }),
    ]);
    expect(parsed.warnings?.join(' ')).toMatch(/Нераспознанные магазины.*Нарния/);
    expect(parsed.inventory.some((i) => i.size === '44')).toBe(false);
  });

  it('asOf пробрасывается в ParsedData', () => {
    const parsed = parseBundledRows([catalogRow()], [sizeRow()], { asOf: '2026-09-23' });
    expect(parsed.asOf).toBe('2026-09-23');
  });

  it('извлекает имя фото из колонки «Фото» (windows-путь → basename)', () => {
    const parsed = parseBundledRows([catalogRow()], [sizeRow()]);
    expect(parsed.products[0].photo).toBe('x.png');
  });
});

describe('photoFileName', () => {
  it('нормализует windows-пути из CSV', () => {
    expect(photoFileName('data\\product_images\\943ea3091107.png')).toBe('943ea3091107.png');
    expect(photoFileName('data/product_images/abc.JPG')).toBe('abc.JPG');
    expect(photoFileName('  img.webp  ')).toBe('img.webp');
  });

  it('мусор и пустые значения → undefined', () => {
    expect(photoFileName('')).toBeUndefined();
    expect(photoFileName(null)).toBeUndefined();
    expect(photoFileName('нет фото')).toBeUndefined();
    expect(photoFileName('data\\product_images\\')).toBeUndefined();
  });
});

describe('hashString', () => {
  it('детерминированный и разный для разных строк', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
    expect(hashString('')).toBeTruthy();
  });
});
