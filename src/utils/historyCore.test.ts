import { describe, it, expect } from 'vitest';
import { parseSnapshotRows, analyzeSales, type HistorySnapshot, type SnapshotProduct } from './historyCore';

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
