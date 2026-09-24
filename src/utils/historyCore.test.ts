import { describe, it, expect } from 'vitest';
import { parseSnapshotRows, analyzeSales, lastKnownSizes, collectDelistedProducts, type HistorySnapshot, type SnapshotProduct } from './historyCore';

const SPB = 'Санкт-Петербург (Спортивная)';
const EKB = 'Екатеринбург (Основной склад)';
const UFA = 'Уфа';

function snapProduct(
  link: string,
  name: string,
  byStore: Record<string, number>,
  extra: Partial<SnapshotProduct> = {}
): SnapshotProduct {
  const total = Object.values(byStore).reduce((a, b) => a + b, 0);
  return { link, article: link, name, brand: 'B', category: 'C', price: 100, total, byStore, ...extra };
}

function snapshot(date: string, products: SnapshotProduct[]): HistorySnapshot {
  return { date, stores: [SPB, EKB, UFA], products: new Map(products.map((p) => [p.link, p])) };
}

describe('parseSnapshotRows', () => {
  it('парсит широкий формат снимка (Всего + колонки магазинов)', () => {
    const rows = [
      {
        Категория: 'Обувь', Артикул: 'A1', Название: 'Кроссовки', Бренд: 'Nike',
        Цена: '100 ₽', Ссылка: 'link1', Всего: '5',
        [UFA]: '3', [EKB]: '2',
      },
      {
        Категория: 'Обувь', Артикул: 'A2', Название: 'Кеды', Бренд: 'Asics',
        Цена: '200 ₽', Ссылка: 'link2', Всего: '',
        [UFA]: '1', [EKB]: '',
      },
    ];
    const snap = parseSnapshotRows(rows, '2026-09-23');
    expect(snap.date).toBe('2026-09-23');
    expect(snap.products.size).toBe(2);
    // Ключ снимка — уникальный артикул (при дублях — артикул+название)
    const p1 = snap.products.get('A1')!;
    expect(p1.link).toBe('link1');
    expect(p1.total).toBe(5); // из колонки «Всего»
    expect(p1.byStore[UFA]).toBe(3);
    expect(p1.byStore[EKB]).toBe(2);
    const p2 = snap.products.get('A2')!;
    expect(p2.total).toBe(1); // сумма колонок, «Всего» пустое
  });
});

describe('analyzeSales', () => {
  it('меньше двух снимков → null', () => {
    expect(analyzeSales([])).toBeNull();
    expect(analyzeSales([snapshot('2026-09-23', [])])).toBeNull();
  });

  const day1 = snapshot('2026-09-22', [
    snapProduct('p1', 'Кроссовки', { [UFA]: 3, [EKB]: 2 }),   // продадут 2 (Уфа)
    snapProduct('p2', 'Кеды', { [UFA]: 2 }),                    // распродадут
    snapProduct('p3', 'Струны', { [UFA]: 4 }),                  // переместят в Екб
    snapProduct('p5', 'Мяч', { [UFA]: 1 }),                     // исчезнет из каталога
  ]);
  const day2 = snapshot('2026-09-24', [
    snapProduct('p1', 'Кроссовки', { [UFA]: 1, [EKB]: 2 }),
    snapProduct('p2', 'Кеды', { [UFA]: 0 }),
    snapProduct('p3', 'Струны', { [EKB]: 4 }),
    snapProduct('p4', 'Напульсник', { [SPB]: 3 }),              // новый товар
  ]);

  const report = analyzeSales([day1, day2])!;

  it('период и дни', () => {
    expect(report).not.toBeNull();
    expect(report.fromDate).toBe('2026-09-22');
    expect(report.toDate).toBe('2026-09-24');
    expect(report.days).toBe(2);
    expect(report.snapshotsCount).toBe(2);
  });

  it('продажи: снижение суммарного остатка', () => {
    expect(report.totalSold).toBe(2 + 2 + 1); // p1: 2, p2: 2, p5 (исчез): 1
    const p1 = report.topSold.find((m) => m.link === 'p1')!;
    expect(p1.sold).toBe(2);
    expect(p1.currentTotal).toBe(3);
    // атрибуция по магазинам: Уфа
    expect(report.byStore.find((s) => s.store === UFA)!.sold).toBe(2 + 2 + 1);
  });

  it('распроданные товары', () => {
    const soldOutLinks = report.soldOutProducts.map((m) => m.link);
    expect(soldOutLinks).toContain('p2'); // остаток стал 0
    expect(soldOutLinks).toContain('p5'); // исчез из каталога
    const p5 = report.soldOutProducts.find((m) => m.link === 'p5')!;
    expect(p5.disappeared).toBe(true);
    expect(report.removedProducts).toBe(1);
  });

  it('перемещения: сумма не изменилась, остатки «переехали»', () => {
    expect(report.totalTransferred).toBe(4);
    // p3 не считается ни продажей, ни поступлением
    expect(report.topSold.find((m) => m.link === 'p3')).toBeUndefined();
    expect(report.restockedProducts.find((m) => m.link === 'p3')).toBeUndefined();
  });

  it('новые товары не считаются продажей или поступлением', () => {
    expect(report.newProducts).toBe(1);
    expect(report.totalRestocked).toBe(0);
  });
});

describe('analyzeSales: поступления', () => {
  it('рост остатка → поступление, атрибуция магазину', () => {
    const day1 = snapshot('2026-09-01', [snapProduct('p1', 'Кроссовки', { [UFA]: 2 })]);
    const day2 = snapshot('2026-09-04', [snapProduct('p1', 'Кроссовки', { [UFA]: 5, [EKB]: 2 })]);
    const report = analyzeSales([day1, day2])!;
    expect(report.totalRestocked).toBe(5);
    expect(report.totalSold).toBe(0);
    expect(report.days).toBe(3);
    expect(report.byStore.find((s) => s.store === UFA)!.restocked).toBe(3);
    expect(report.byStore.find((s) => s.store === EKB)!.restocked).toBe(2);
    expect(report.restockedProducts[0].link).toBe('p1');
  });
});

// ============ Продажи по размерам ============

import { parseSizeSnapshotRows, analyzeSizeSales, type SizeSnapshot } from './historyCore';

function sizeSnap(date: string, rows: Record<string, unknown>[]): SizeSnapshot {
  return parseSizeSnapshotRows(rows, date);
}

describe('analyzeSizeSales', () => {
  const day1 = sizeSnap('2026-09-23', [
    { Размер: 'S', Магазин: 'Уфа', Количество: '5', Артикул: 'A1', Название: 'Юбка женская Test', Категория: 'Одежда', Бренд: '7/6' },
    { Размер: 'M', Магазин: 'Уфа', Количество: '3', Артикул: 'A1', Название: 'Юбка женская Test', Категория: 'Одежда', Бренд: '7/6' },
    { Размер: '42', Магазин: 'Уфа', Количество: '2', Артикул: 'B1', Название: 'Кроссовки мужские Test', Категория: 'Обувь', Бренд: 'Nike' },
    { Размер: '375', Магазин: 'Уфа', Количество: '4', Артикул: 'C1', Название: 'Кроссовки женские Test', Категория: 'Обувь', Бренд: 'Asics' },
  ]);
  const day2 = sizeSnap('2026-09-24', [
    { Размер: 'S', Магазин: 'Уфа', Количество: '3', Артикул: 'A1', Название: 'Юбка женская Test', Категория: 'Одежда', Бренд: '7/6' },
    { Размер: 'M', Магазин: 'Уфа', Количество: '3', Артикул: 'A1', Название: 'Юбка женская Test', Категория: 'Одежда', Бренд: '7/6' },
    { Размер: '42', Магазин: 'Уфа', Количество: '1', Артикул: 'B1', Название: 'Кроссовки мужские Test', Категория: 'Обувь', Бренд: 'Nike' },
    { Размер: '375', Магазин: 'Уфа', Количество: '4', Артикул: 'C1', Название: 'Кроссовки женские Test', Категория: 'Обувь', Бренд: 'Asics' },
  ]);

  it('меньше двух снимков → null', () => {
    expect(analyzeSizeSales([day1])).toBeNull();
  });

  it('находит продажи по размерам с полом и нормализацией', () => {
    const report = analyzeSizeSales([day1, day2])!;
    // Юбка S: 5→3 (−2, женский), Кроссовки мужские 42: 2→1 (−1, мужской), женские 37,5: без изменений
    expect(report.entries.find((e) => e.article === 'A1' && e.size === 'S')?.sold).toBe(2);
    expect(report.entries.find((e) => e.article === 'A1' && e.size === 'S')?.gender).toBe('female');
    expect(report.entries.find((e) => e.article === 'B1')?.sold).toBe(1);
    expect(report.entries.find((e) => e.article === 'B1')?.gender).toBe('male');
    expect(report.entries.some((e) => e.article === 'C1')).toBe(false);
    // агрегат по полу
    const female = report.byGender.find((g) => g.gender === 'female');
    expect(female?.rows.find((r) => r.size === 'S')?.sold).toBe(2);
  });

  it('нормализует «375» → «37,5» в снимках размеров', () => {
    expect([...day1.products.get('C1')!.sizes.keys()]).toContain('37,5');
  });
});

describe('lastKnownSizes — последние размеры распроданного товара', () => {
  const sizeSnap = (date: string, products: [string, Record<string, number>][]) => ({
    date,
    products: new Map(
      products.map(([key, sizes]) => [
        key,
        { article: key, name: key, brand: 'B', category: 'C', link: '', sizes: new Map(Object.entries(sizes)) },
      ])
    ),
  });

  const snapshots = [
    sizeSnap('2026-09-20', [['OLD', { '40': 1 }], ['A1', { '42': 2, '43': 0 }]]),
    sizeSnap('2026-09-23', [['A1', { '42': 0, '43': 1, '42,5': 2 }]]),
  ];

  it('берёт самый свежий снимок, нулевые остатки отбрасывает, размеры сортирует', () => {
    expect(lastKnownSizes(snapshots, { article: 'A1' })).toEqual({
      date: '2026-09-23',
      sizes: ['42,5', '43'],
    });
  });

  it('товара нет в свежем снимке — уходит в более старый', () => {
    expect(lastKnownSizes(snapshots, { article: 'OLD' })).toEqual({
      date: '2026-09-20',
      sizes: ['40'],
    });
  });

  it('нет снимков или товара нигде нет → null', () => {
    expect(lastKnownSizes([], { article: 'A1' })).toBeNull();
    expect(lastKnownSizes(snapshots, { article: 'NOPE', name: 'NOPE' })).toBeNull();
  });

  it('ищет по артикулу, ссылке или названию', () => {
    expect(lastKnownSizes(snapshots, { name: 'A1' })?.sizes).toEqual(['42,5', '43']);
  });
});

describe('collectDelistedProducts — товары, исчезнувшие с сайта', () => {
  // в реальных снимках (parseSnapshotRows) ключ карты = артикул (productIdentityKey)
  const snapByArticle = (date: string, products: SnapshotProduct[]): HistorySnapshot => ({
    date,
    stores: [SPB],
    products: new Map(products.map((p) => [p.article || p.link, p])),
  });

  const hist: HistorySnapshot[] = [
    snapByArticle('2026-09-20', [
      snapProduct('https://s/1', 'Кроссовки A', { [SPB]: 2 }, { article: 'A1' }),
      snapProduct('https://s/2', 'Кроссовки B', { [SPB]: 1 }, { article: 'B1' }),
    ]),
    snapByArticle('2026-09-23', [
      snapProduct('https://s/2', 'Кроссовки B', { [SPB]: 0 }, { article: 'B1' }),
    ]),
  ];

  it('товар из старого снимка отсутствует в каталоге → распродан/убран', () => {
    const delisted = collectDelistedProducts(hist, new Set(['B1']));
    expect(delisted).toHaveLength(1);
    expect(delisted[0]).toMatchObject({
      key: 'A1',
      article: 'A1',
      name: 'Кроссовки A',
      lastTotal: 2,
      lastSeen: '2026-09-20',
    });
  });

  it('товар вернулся в каталог → не считается исчезнувшим', () => {
    expect(collectDelistedProducts(hist, new Set(['A1', 'B1']))).toHaveLength(0);
  });

  it('без истории список пуст', () => {
    expect(collectDelistedProducts([], new Set())).toHaveLength(0);
  });
});
