import { findColumn, detectColumns, parsePrice, parseQuantity } from './xlsxParser';
import { normalizeSize, compareSizes } from './sizes';
import { detectGender, type Gender } from './productMeta';

/**
 * Анализ истории снимков остатков (датированные файлы парсинга).
 *
 * Снимок — это products.csv, сохранённый под именем YYYY-MM-DD.csv.
 * Сравнивая соседние снимки, получаем:
 * - продажи (суммарный остаток сети уменьшился);
 * - поступления (остаток вырос);
 * - перемещения (сумма по сети не изменилась, но изменилось распределение по магазинам);
 * - распроданные товары (был остаток → стал ноль либо товар исчез из каталога).
 */

export interface SnapshotProduct {
  link: string;
  article: string;
  name: string;
  brand: string;
  category: string;
  price: number;
  total: number;
  byStore: Record<string, number>;
}

export interface HistorySnapshot {
  /** Дата снимка YYYY-MM-DD */
  date: string;
  stores: string[];
  /** Ключ — ссылка на товар (стабильный уникальный идентификатор) */
  products: Map<string, SnapshotProduct>;
}

const LINK_ALIASES = ['ссылка', 'link', 'url'];
const TOTAL_ALIASES = ['всего', 'total', 'итого'];

/** Ссылка товара как стабильный ключ: trim + без хвостового слэша
 * (формат ссылок менялся между парсингами: «…-16444/» → «…-16444») */
export function normalizeLink(link: string): string {
  return link.trim().replace(/\/+$/, '');
}

/**
 * Ключ товара для сравнения снимков:
 * 1. Артикул — стабилен между парсингами (сайт меняет slug ссылок и правит
 *    названия; журнал парсера changes.csv тоже сравнивает по артикулу).
 *    Строки-дубли одного артикула внутри снимка объединяются (суммируются) —
 *    так же поступает сам парсер.
 * 2. Нормализованная ссылка / название — фолбэк для товаров без артикула.
 */
export function productIdentityKey(link: string, article: string, name: string): string {
  return article || normalizeLink(link) || name;
}

/** Парсит строки снимка (широкий формат products.csv) в HistorySnapshot */
export function parseSnapshotRows(
  rows: Record<string, unknown>[],
  date: string
): HistorySnapshot {
  if (rows.length === 0) throw new Error(`Снимок ${date}: файл пустой`);
  const headers = Object.keys(rows[0]);
  const mapping = detectColumns(headers);

  const linkCol = findColumn(headers, LINK_ALIASES);
  const totalCol = findColumn(headers, TOTAL_ALIASES);

  // Магазины: из широкого маппинга либо (для длинного формата) из значений колонки
  let storeColumns: string[] = [];
  let longStoreCol: string | null = null;
  let longQtyCol: string | null = null;
  if (mapping.format === 'wide') {
    storeColumns = mapping.storeColumns;
  } else {
    longStoreCol = mapping.storeCol;
    longQtyCol = mapping.qtyCol;
  }

  const products = new Map<string, SnapshotProduct>();
  const storesSet = new Set<string>(storeColumns);

  for (const row of rows) {
    const name = String(row[mapping.nameCol] ?? '').trim();
    if (!name) continue;
    const link = linkCol ? normalizeLink(String(row[linkCol] ?? '')) : '';
    const article = mapping.articleCol ? String(row[mapping.articleCol] ?? '').trim() : '';
    const brand = mapping.brandCol ? String(row[mapping.brandCol] ?? '').trim() : 'Неизвестно';
    const category = mapping.categoryCol ? String(row[mapping.categoryCol] ?? '').trim() : 'Другое';
    const price = mapping.priceCol ? parsePrice(row[mapping.priceCol]) : 0;
    const key = productIdentityKey(link, article, name);

    let entry = products.get(key);
    if (!entry) {
      entry = { link, article, name, brand, category, price, total: 0, byStore: {} };
      products.set(key, entry);
    }

    if (storeColumns.length > 0) {
      let rowTotal = 0;
      for (const col of storeColumns) {
        const qty = parseQuantity(row[col]) ?? 0;
        entry.byStore[col] = (entry.byStore[col] ?? 0) + qty;
        rowTotal += qty;
      }
      // Колонка «Всего» приоритетнее суммы, если present
      const declaredTotal = totalCol ? parseQuantity(row[totalCol]) : null;
      entry.total += declaredTotal ?? rowTotal;
    } else if (longStoreCol && longQtyCol) {
      const storeName = String(row[longStoreCol] ?? '').trim();
      const qty = parseQuantity(row[longQtyCol]) ?? 0;
      if (storeName) {
        storesSet.add(storeName);
        entry.byStore[storeName] = (entry.byStore[storeName] ?? 0) + qty;
        entry.total += qty;
      }
    }
  }

  return { date, stores: [...storesSet], products };
}

// ============ Журнал изменений от парсера (changes.csv) ============

export interface ParserChange {
  /** ISO-дата/время изменения */
  date: string;
  article: string;
  name: string;
  category: string;
  /** Тип изменения из парсера: «Изменение количества», «Новый товар», «Товар закончился», «Товар удалён с сайта» */
  changeType: string;
  oldValue: string;
  newValue: string;
  /** Разница (число); для продаж — отрицательная */
  diff: number;
}

/**
 * Excel-серийная дата (46288.7028…) → ISO-строка.
 * Эпоха Excel: 30.12.1899; 25569 дней до 01.01.1970.
 */
export function excelSerialToDate(serial: number): string {
  if (!isFinite(serial)) return '';
  const ms = Math.round((serial - 25569) * 86_400_000);
  const date = new Date(ms);
  return isNaN(date.getTime()) ? '' : date.toISOString();
}

/** Парсит changes.csv (журнал изменений между парсингами) */
export function parseChangesCsv(rows: Record<string, unknown>[]): ParserChange[] {
  const findCol = (names: string[]): string | null => {
    if (rows.length === 0) return null;
    const headers = Object.keys(rows[0]);
    for (const name of names) {
      const hit = headers.find((h) => h.toLowerCase().includes(name));
      if (hit) return hit;
    }
    return null;
  };
  const dateCol = findCol(['дата']);
  const articleCol = findCol(['артикул']);
  const nameCol = findCol(['название']);
  const categoryCol = findCol(['категория']);
  const typeCol = findCol(['тип изменения', 'тип']);
  const oldCol = findCol(['старое']);
  const newCol = findCol(['новое']);
  const diffCol = findCol(['разница']);
  if (!nameCol || !typeCol) return [];

  const changes: ParserChange[] = [];
  for (const row of rows) {
    const rawDate = dateCol ? row[dateCol] : '';
    let date = '';
    const serial = Number(String(rawDate).replace(',', '.'));
    if (isFinite(serial) && serial > 20000 && serial < 80000) {
      date = excelSerialToDate(serial);
    } else if (rawDate) {
      const parsed = Date.parse(String(rawDate));
      if (isFinite(parsed)) date = new Date(parsed).toISOString();
    }
    const diff = diffCol ? Number(String(row[diffCol] ?? '').replace(',', '.')) || 0 : 0;
    changes.push({
      date,
      article: articleCol ? String(row[articleCol] ?? '').trim() : '',
      name: String(row[nameCol] ?? '').trim(),
      category: categoryCol ? String(row[categoryCol] ?? '').trim() : '',
      changeType: String(row[typeCol] ?? '').trim(),
      oldValue: oldCol ? String(row[oldCol] ?? '').trim() : '',
      newValue: newCol ? String(row[newCol] ?? '').trim() : '',
      diff,
    });
  }
  return changes.sort((a, b) => b.date.localeCompare(a.date));
}

// ============ Сравнение снимков ============

export interface ProductMovement {
  link: string;
  article: string;
  name: string;
  brand: string;
  category: string;
  /** Продано единиц за период (уменьшение суммарного остатка) */
  sold: number;
  /** Поступило единиц (увеличение остатка) */
  restocked: number;
  /** Перемещено между магазинами (при неизменном суммарном остатке) */
  transferred: number;
  firstTotal: number;
  lastTotal: number;
  currentTotal: number;
  /** Товар распродан: остаток был > 0 и стал 0 (или товар исчез из каталога) */
  soldOut: boolean;
  /** Товар впервые появился в каталоге */
  isNew: boolean;
  disappeared: boolean;
}

export interface StoreMovement {
  store: string;
  sold: number;
  restocked: number;
}

export interface SalesReport {
  fromDate: string;
  toDate: string;
  days: number;
  snapshotsCount: number;
  totalSold: number;
  totalRestocked: number;
  totalTransferred: number;
  /** Распроданные товары (остаток → 0) */
  soldOutProducts: ProductMovement[];
  /** Лидеры продаж */
  topSold: ProductMovement[];
  /** Поступления */
  restockedProducts: ProductMovement[];
  byStore: StoreMovement[];
  newProducts: number;
  removedProducts: number;
}

function daysBetween(from: string, to: string): number {
  const ms = Date.parse(to) - Date.parse(from);
  if (!isFinite(ms) || ms <= 0) return 1;
  return Math.max(1, Math.round(ms / 86_400_000));
}

/**
 * Агрегирует движение товаров по всем последовательным парам снимков.
 * Возвращает null, если снимков меньше двух (сравнивать не с чем).
 *
 * Правила атрибуции (v1, документированы для прозрачности):
 * - сумма по сети уменьшилась → продажа; по магазинам распределяется пропорционально
 *   убыванию остатков (не больше общего снижения);
 * - сумма не изменилась, но остатки «переехали» → перемещение между магазинами;
 * - сумма выросла → поступление.
 */
export function analyzeSales(snapshots: HistorySnapshot[]): SalesReport | null {
  if (snapshots.length < 2) return null;

  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const movements = new Map<string, ProductMovement>();
  const storeAgg = new Map<string, StoreMovement>();
  let totalSold = 0;
  let totalRestocked = 0;
  let totalTransferred = 0;
  let newProducts = 0;
  let removedProducts = 0;
  let days = 0;

  const ensureStore = (name: string): StoreMovement => {
    let agg = storeAgg.get(name);
    if (!agg) {
      agg = { store: name, sold: 0, restocked: 0 };
      storeAgg.set(name, agg);
    }
    return agg;
  };

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    days += daysBetween(prev.date, curr.date);
    for (const s of [...prev.stores, ...curr.stores]) ensureStore(s);

    const keys = new Set([...prev.products.keys(), ...curr.products.keys()]);
    for (const key of keys) {
      const p = prev.products.get(key);
      const c = curr.products.get(key);
      const meta = (c ?? p)!;

      let mv = movements.get(key);
      if (!mv) {
        mv = {
          link: meta.link,
          article: meta.article,
          name: meta.name,
          brand: meta.brand,
          category: meta.category,
          sold: 0,
          restocked: 0,
          transferred: 0,
          firstTotal: p?.total ?? c?.total ?? 0,
          lastTotal: 0,
          currentTotal: 0,
          soldOut: false,
          isNew: false,
          disappeared: false,
        };
        movements.set(key, mv);
      }

      // Товар исчез из каталога — считаем распродажей остатка
      if (p && !c) {
        removedProducts++;
        mv.disappeared = true;
        mv.sold += p.total;
        totalSold += p.total;
        mv.lastTotal = 0;
        for (const [store, qty] of Object.entries(p.byStore)) {
          ensureStore(store).sold += qty;
        }
        continue;
      }

      // Новый товар в каталоге — поступление, продажей не считается
      if (!p && c) {
        newProducts++;
        mv.isNew = true;
        mv.firstTotal = c.total;
        mv.lastTotal = c.total;
        continue;
      }

      const prevTotal = p!.total;
      const currTotal = c!.total;
      const delta = prevTotal - currTotal;
      mv.lastTotal = currTotal;

      if (delta > 0) {
        mv.sold += delta;
        totalSold += delta;
        // Распределение продаж по магазинам: сначала те, у кого остаток уменьшился сильнее
        let remaining = delta;
        const decreases = Object.keys({ ...p!.byStore, ...c!.byStore })
          .map((store) => ({ store, drop: (p!.byStore[store] ?? 0) - (c!.byStore[store] ?? 0) }))
          .filter((x) => x.drop > 0)
          .sort((a, b) => b.drop - a.drop);
        for (const { store, drop } of decreases) {
          if (remaining <= 0) break;
          const attributed = Math.min(drop, remaining);
          ensureStore(store).sold += attributed;
          remaining -= attributed;
        }
      } else if (delta < 0) {
        mv.restocked += -delta;
        totalRestocked += -delta;
        let remaining = -delta;
        const increases = Object.keys({ ...p!.byStore, ...c!.byStore })
          .map((store) => ({ store, gain: (c!.byStore[store] ?? 0) - (p!.byStore[store] ?? 0) }))
          .filter((x) => x.gain > 0)
          .sort((a, b) => b.gain - a.gain);
        for (const { store, gain } of increases) {
          if (remaining <= 0) break;
          const attributed = Math.min(gain, remaining);
          ensureStore(store).restocked += attributed;
          remaining -= attributed;
        }
      } else {
        // Сумма не изменилась: считаем объём перемещений между магазинами
        let moved = 0;
        for (const store of Object.keys({ ...p!.byStore, ...c!.byStore })) {
          const sd = (p!.byStore[store] ?? 0) - (c!.byStore[store] ?? 0);
          if (sd > 0) moved += sd;
        }
        if (moved > 0) {
          mv.transferred += moved;
          totalTransferred += moved;
        }
      }
    }
  }

  for (const mv of movements.values()) {
    mv.currentTotal = mv.lastTotal;
    mv.soldOut = !mv.isNew && (mv.firstTotal > 0 || mv.sold > 0) && mv.currentTotal === 0;
  }

  const all = [...movements.values()];
  return {
    fromDate: sorted[0].date,
    toDate: sorted[sorted.length - 1].date,
    days,
    snapshotsCount: sorted.length,
    totalSold,
    totalRestocked,
    totalTransferred,
    soldOutProducts: all
      .filter((m) => m.soldOut)
      .sort((a, b) => b.sold - a.sold || a.name.localeCompare(b.name, 'ru')),
    topSold: all
      .filter((m) => m.sold > 0)
      .sort((a, b) => b.sold - a.sold || a.name.localeCompare(b.name, 'ru')),
    restockedProducts: all
      .filter((m) => m.restocked > 0)
      .sort((a, b) => b.restocked - a.restocked || a.name.localeCompare(b.name, 'ru')),
    byStore: [...storeAgg.values()].sort((a, b) => b.sold - a.sold),
    newProducts,
    removedProducts,
  };
}

// ============ Снимки размеров и продажи по размерам ============

export interface SizeSnapshotProduct {
  article: string;
  name: string;
  brand: string;
  category: string;
  link: string;
  /** размер → суммарный остаток по всей сети */
  sizes: Map<string, number>;
}

export interface SizeSnapshot {
  date: string;
  products: Map<string, SizeSnapshotProduct>;
}

/** Парсит снимок sizes.csv (длинный формат) → остатки по размерам на дату */
export function parseSizeSnapshotRows(
  rows: Record<string, unknown>[],
  date: string
): SizeSnapshot {
  if (rows.length === 0) throw new Error(`Снимок размеров ${date}: файл пустой`);
  const headers = Object.keys(rows[0]);
  const sizeCol = findColumn(headers, ['размер', 'size', 'р-р']);
  const qtyCol = findColumn(headers, ['количество', 'кол-во', 'quantity', 'остаток']);
  const articleCol = findColumn(headers, ['артикул', 'article', 'sku']);
  const nameCol = findColumn(headers, ['название', 'товар', 'наименование']);
  const brandCol = findColumn(headers, ['бренд', 'brand']);
  const categoryCol = findColumn(headers, ['категория', 'category']);
  const linkCol = findColumn(headers, ['ссылка', 'link', 'url']);
  if (!qtyCol || !nameCol) throw new Error('Снимок размеров: нет колонок «Количество»/«Название»');

  const products = new Map<string, SizeSnapshotProduct>();
  for (const row of rows) {
    const name = String(row[nameCol] ?? '').trim();
    if (!name) continue;
    const article = articleCol ? String(row[articleCol] ?? '').trim() : '';
    const link = linkCol ? normalizeLink(String(row[linkCol] ?? '')) : '';
    const key = article || link || name;
    const quantity = parseQuantity(row[qtyCol]);
    if (quantity === null) continue;
    const size = sizeCol ? normalizeSize(row[sizeCol]) : '—';

    let entry = products.get(key);
    if (!entry) {
      entry = {
        article,
        name,
        brand: brandCol ? String(row[brandCol] ?? '').trim() : '',
        category: categoryCol ? String(row[categoryCol] ?? '').trim() : '',
        link,
        sizes: new Map(),
      };
      products.set(key, entry);
    }
    entry.sizes.set(size, (entry.sizes.get(size) ?? 0) + quantity);
  }
  return { date, products };
}

export interface SizeSaleEntry {
  key: string;
  article: string;
  name: string;
  brand: string;
  category: string;
  link: string;
  gender: Gender;
  size: string;
  sold: number;
}

export interface SizeSalesReport {
  fromDate: string;
  toDate: string;
  entries: SizeSaleEntry[];
  /** Продажи по размерам в разрезе пола (женский/мужской размерный ряд) */
  byGender: { gender: Gender; rows: { size: string; sold: number }[] }[];
}

/**
 * Продажи по размерам: сравнивает соседние снимки sizes и агрегирует
 * уменьшения остатков по (товар, размер). Используется для анализа
 * популярности размерного ряда у мужчин и женщин.
 */
export function analyzeSizeSales(snapshots: SizeSnapshot[]): SizeSalesReport | null {
  if (snapshots.length < 2) return null;
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));

  const soldByKey = new Map<string, SizeSaleEntry>();
  const genderSize = new Map<string, Map<string, number>>();

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    for (const [key, prevProduct] of prev.products) {
      const currProduct = curr.products.get(key);
      for (const [size, prevQty] of prevProduct.sizes) {
        const currQty = currProduct?.sizes.get(size) ?? 0;
        const sold = prevQty - currQty;
        if (sold <= 0) continue;

        const entryKey = `${key}|${size}`;
        const existing = soldByKey.get(entryKey);
        if (existing) {
          existing.sold += sold;
        } else {
          const gender = detectGender(prevProduct.name, prevProduct.category);
          soldByKey.set(entryKey, {
            key,
            article: prevProduct.article,
            name: prevProduct.name,
            brand: prevProduct.brand,
            category: prevProduct.category,
            link: prevProduct.link,
            gender,
            size,
            sold,
          });
          let sizes = genderSize.get(gender);
          if (!sizes) {
            sizes = new Map();
            genderSize.set(gender, sizes);
          }
        }
        const sizes = genderSize.get(
          soldByKey.get(entryKey)!.gender
        )!;
        sizes.set(size, (sizes.get(size) ?? 0) + sold);
      }
    }
  }

  const byGender = [...genderSize.entries()]
    .map(([gender, sizes]) => ({
      gender: gender as Gender,
      rows: [...sizes.entries()]
        .map(([size, sold]) => ({ size, sold }))
        .sort((a, b) => b.sold - a.sold),
    }))
    .filter((g) => g.rows.length > 0);

  return {
    fromDate: sorted[0].date,
    toDate: sorted[sorted.length - 1].date,
    entries: [...soldByKey.values()].sort((a, b) => b.sold - a.sold),
    byGender,
  };
}

// ============ Последние размеры и исчезнувшие товары ============

export interface LastKnownSizes {
  /** Дата снимка, в котором товар последний раз был в наличии */
  date: string;
  /** Размеры с остатком > 0 на ту дату (отсортированы по размерному ряду) */
  sizes: string[];
}

/**
 * Последние размеры товара, которые сайт показывал в наличии — для
 * распроданных и исчезнувших позиций («какой именно размер купили»).
 * Ищет от самого свежего снимка размеров к старым; товар опознаётся по
 * артикулу → ссылке → названию (как в самих снимках).
 */
export function lastKnownSizes(
  snapshots: SizeSnapshot[],
  product: { article?: string; link?: string; name?: string }
): LastKnownSizes | null {
  if (snapshots.length === 0) return null;
  const keys = [
    (product.article ?? '').trim(),
    normalizeLink(product.link ?? ''),
    (product.name ?? '').trim(),
  ].filter((k) => k.length > 0);
  if (keys.length === 0) return null;

  const sorted = [...snapshots].sort((a, b) => b.date.localeCompare(a.date));
  for (const snapshot of sorted) {
    for (const key of keys) {
      const entry = snapshot.products.get(key);
      if (!entry) continue;
      const sizes = [...entry.sizes.entries()]
        .filter(([, qty]) => qty > 0)
        .map(([size]) => size)
        .sort(compareSizes);
      if (sizes.length > 0) return { date: snapshot.date, sizes };
    }
  }
  return null;
}

export interface DelistedProduct {
  /** Ключ идентичности (артикул / ссылка / название) — как в снимках истории */
  key: string;
  article: string;
  name: string;
  brand: string;
  category: string;
  link: string;
  price: number;
  /** Остаток по сети на момент, когда товар последний раз был виден */
  lastTotal: number;
  /** Дата последнего снимка, где товар присутствовал */
  lastSeen: string;
}

/**
 * Товары, которые были в снимках истории, но исчезли из текущего каталога
 * (сайт убрал позицию = она распродана). Вкладка «Инвентарь» показывает их
 * в фильтре «Распроданные», чтобы sold-out товар не пропадал бесследно.
 * Если товар снова появился в каталоге — из списка он исключается.
 */
export function collectDelistedProducts(
  history: HistorySnapshot[],
  currentKeys: Set<string>
): DelistedProduct[] {
  const result = new Map<string, DelistedProduct>();
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  for (const snapshot of sorted) {
    for (const [key, p] of snapshot.products) {
      if (currentKeys.has(key)) {
        result.delete(key); // товар вернулся в каталог
        continue;
      }
      result.set(key, {
        key,
        article: p.article,
        name: p.name,
        brand: p.brand,
        category: p.category,
        link: p.link,
        price: p.price,
        lastTotal: p.total,
        lastSeen: snapshot.date,
      });
    }
  }
  return [...result.values()];
}
