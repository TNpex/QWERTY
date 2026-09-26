import type { ParsedData, Store, Product, InventoryItem } from '../types';
import { parseCSVText } from './csv';
import { normalizeSize } from './sizes';
import { detectColumns, findColumn, parsePrice, parseQuantity, buildStoreResolver } from './xlsxParser';
import {
  parseSnapshotRows,
  type HistorySnapshot,
  parseChangesCsv,
  type ParserChange,
  parseSizeSnapshotRows,
  type SizeSnapshot,
  normalizeLink,
} from './historyCore';
import { sortStoresForDisplay } from './storeGroups';
import { photoFileName } from './images';
import { parseSettings, type ProductSettings } from './settings';
import { parseCartMap, type CartMap } from './cart';
import { applyDiscounts, parseDiscounts, type DiscountMap } from './discounts';
import { productMeta, cleanBrand } from './productMeta';

/**
 * Загрузка встроенного набора данных из public/data/:
 * - products.csv — каталог (широкий формат: магазины-колонки);
 * - sizes.csv — остатки по размерам (длинный формат: Размер/Магазин/Количество);
 * - changes.csv — журнал изменений от парсера;
 * - hot-products.json — ходовые товары с индивидуальным нормативом;
 * - history/ — датированные снимки парсинга + manifest.json.
 *
 * Важные правила слияния:
 * - Явное число (включая 0) в колонке магазина products.csv = магазин ВОЗИТ товар
 *   (ноль = «нет в наличии»); пустая ячейка = не возит. Так магазин с нулём
 *   попадает в получатели перемещений.
 * - sizes.csv может содержать товары, которых нет в каталоге (сайт дублирует
 *   артикулы для разных вариантов) — они добавляются и наследуют бренд/категорию
 *   одноартикульных товаров каталога.
 * - Бренды-мусор («37078», «Не определен») восстанавливаются из названия
 *   (cleanBrand) и наследованием по артикулу.
 */

const LINK_ALIASES = ['ссылка', 'link', 'url'];
const PHOTO_ALIASES = ['фото', 'photo', 'изображение', 'картинка', 'image'];

export interface HotProductConfig {
  article: string;
  /** Минимум единиц на каждый розничный магазин (суммарно по размерам) */
  minPerStore: number;
  note?: string;
}

/** Стабильный детерминированный id товара из его ссылки (djb2-хэш) */
export function hashString(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

export interface BundledDataset {
  data: ParsedData;
  history: HistorySnapshot[];
  /** Журнал изменений от парсера (changes.csv), если файл есть */
  changes: ParserChange[];
  /** Снимки остатков по размерам (для анализа продаж размеров) */
  sizeSnapshots: SizeSnapshot[];
  /** Ходовые товары (hot-products.json) */
  hotProducts: HotProductConfig[];
  /** Общие настройки товаров из public/data/product-settings.json (если есть) */
  settings: ProductSettings | null;
  /** Данные корзины saletennis.com (public/data/cart-map.json, собирает парсер) */
  cartMap: CartMap | null;
  /** Скидки из раздела «Распродажа» (public/data/discounts.json, собирает парсер) */
  discounts: DiscountMap | null;
}

const isBadBrandValue = (brand: string): boolean =>
  !brand || brand === 'Не определен' || brand === 'Неизвестно' || /^\d+$/.test(brand);

/**
 * Чистая функция слияния строк products.csv и sizes.csv в ParsedData.
 * Экспортируется для unit-тестов.
 */
export function parseBundledRows(
  productsRows: Record<string, unknown>[],
  sizesRows: Record<string, unknown>[],
  options: { asOf?: string } = {}
): ParsedData {
  const warnings: string[] = [];
  const now = new Date().toISOString();

  if (productsRows.length === 0) {
    throw new Error('products.csv пустой или не распознан');
  }

  // ---- Колонки каталога ----
  const productHeaders = Object.keys(productsRows[0]);
  const mapping = detectColumns(productHeaders);
  const linkCol = findColumn(productHeaders, LINK_ALIASES);
  const photoCol = findColumn(productHeaders, PHOTO_ALIASES);
  const catalogStoreColumns = mapping.format === 'wide' ? mapping.storeColumns : [];

  // Магазины — из колонок products.csv (канонические полные названия)
  let storeColumns: string[] = catalogStoreColumns;
  if (storeColumns.length === 0 && sizesRows.length > 0) {
    const sizesHeaders = Object.keys(sizesRows[0]);
    const storeCol = findColumn(sizesHeaders, ['магазин', 'store', 'точка']);
    if (storeCol) {
      storeColumns = [
        ...new Set(sizesRows.map((r) => String(r[storeCol] ?? '').trim()).filter(Boolean)),
      ];
    }
  }
  if (storeColumns.length === 0) {
    throw new Error('Не удалось определить список магазинов');
  }

  const stores: Store[] = sortStoresForDisplay(
    storeColumns.map((name, index) => ({ id: `store_${index + 1}`, name }))
  );
  const storeIdByName = new Map(stores.map((s) => [s.name, s.id]));
  const resolver = buildStoreResolver(storeColumns);

  // ---- Товары из каталога ----
  const products: Product[] = [];
  const productById = new Map<string, Product>();
  const byLink = new Map<string, Product>();
  const byArticleName = new Map<string, Product>();

  for (const row of productsRows) {
    const name = String(row[mapping.nameCol] ?? '').trim();
    if (!name) continue;
    const link = linkCol ? normalizeLink(String(row[linkCol] ?? '')) : '';
    const article = mapping.articleCol ? String(row[mapping.articleCol] ?? '').trim() : '';
    const rawBrand = mapping.brandCol ? String(row[mapping.brandCol] ?? '').trim() : '';
    const brand = cleanBrand(name, article, rawBrand);
    const category = mapping.categoryCol
      ? String(row[mapping.categoryCol] ?? '').trim() || 'Другое'
      : 'Другое';
    const price = mapping.priceCol ? parsePrice(row[mapping.priceCol]) : 0;

    // Артикул НЕ уникален (варианты цветов одной модели) — ключом служит ссылка
    const id = `p_${hashString(link || `${article}|${name}`)}`;
    if (productById.has(id)) continue;

    const photo = photoCol ? photoFileName(row[photoCol]) : undefined;
    const meta = productMeta(name, category);
    const product: Product = {
      id,
      name,
      brand,
      category,
      price,
      article,
      ...(link ? { link } : {}),
      ...(photo ? { photo } : {}),
      gender: meta.gender,
      ...(meta.subtype ? { subtype: meta.subtype } : {}),
    };
    products.push(product);
    productById.set(id, product);
    if (link) byLink.set(link, product);
    byArticleName.set(`${article}|${name}`, product);
  }

  // ---- Остатки из sizes.csv ----
  const aggregated = new Map<string, InventoryItem>(); // pid|sid|size → item
  const carriedFromSizes = new Map<string, Set<string>>(); // pid → storeIds
  const extraFromSizes = new Map<string, string>(); // pid → артикул (нет в каталоге)
  let skippedSizes = 0;

  if (sizesRows.length > 0) {
    const sizesHeaders = Object.keys(sizesRows[0]);
    const sizeCol = findColumn(sizesHeaders, ['размер', 'size', 'р-р']);
    const storeCol = findColumn(sizesHeaders, ['магазин', 'store', 'точка']);
    const qtyCol = findColumn(sizesHeaders, ['количество', 'кол-во', 'quantity', 'остаток']);
    const linkColS = findColumn(sizesHeaders, LINK_ALIASES);
    const articleColS = findColumn(sizesHeaders, ['артикул', 'article', 'sku']);
    const nameColS = findColumn(sizesHeaders, ['название', 'товар', 'наименование']);
    const brandColS = findColumn(sizesHeaders, ['бренд', 'brand']);
    const categoryColS = findColumn(sizesHeaders, ['категория', 'category']);
    const priceColS = findColumn(sizesHeaders, ['цена', 'price']);

    if (!storeCol || !qtyCol) {
      throw new Error('sizes.csv: не найдены колонки «Магазин» или «Количество»');
    }

    for (const row of sizesRows) {
      const link = linkColS ? normalizeLink(String(row[linkColS] ?? '')) : '';
      const article = articleColS ? String(row[articleColS] ?? '').trim() : '';
      const name = nameColS ? String(row[nameColS] ?? '').trim() : '';

      let product = link ? byLink.get(link) : undefined;
      if (!product) product = byArticleName.get(`${article}|${name}`);
      if (!product) {
        // Сайт дублирует артикулы для разных вариантов (напр. «Майка женская»
        // и «Майка детская» Bidi Badu) — товар добавляется отдельной позицией
        const id = `p_${hashString(link || `${article}|${name}`)}`;
        product = productById.get(id);
        if (!product) {
          const rawBrand = brandColS ? String(row[brandColS] ?? '').trim() : '';
          const rowCategory = categoryColS
            ? String(row[categoryColS] ?? '').trim() || 'Другое'
            : 'Другое';
          const rowPrice = priceColS ? parsePrice(row[priceColS]) : 0;
          const meta = productMeta(name || article, rowCategory);
          product = {
            id,
            name: name || article || 'Неизвестный товар',
            brand: cleanBrand(name, article, rawBrand),
            category: rowCategory,
            price: rowPrice,
            article,
            ...(link ? { link } : {}),
            gender: meta.gender,
            ...(meta.subtype ? { subtype: meta.subtype } : {}),
          };
          products.push(product);
          productById.set(id, product);
          if (link) byLink.set(link, product);
          extraFromSizes.set(id, article || name);
        }
      }

      const storeName = String(row[storeCol] ?? '').trim();
      let storeId: string | null = storeIdByName.get(storeName) ?? null;
      if (!storeId && storeName) {
        const resolvedColumn = resolver.resolve(storeName);
        if (resolvedColumn) storeId = storeIdByName.get(resolvedColumn) ?? null;
      }
      const quantity = parseQuantity(row[qtyCol]);

      if (!storeId || quantity === null) {
        skippedSizes++;
        continue;
      }

      const size = sizeCol ? normalizeSize(row[sizeCol]) : '—';
      const key = `${product.id}|${storeId}|${size}`;
      const existing = aggregated.get(key);
      if (existing) {
        existing.quantity += quantity;
      } else {
        aggregated.set(key, {
          productId: product.id,
          storeId,
          size,
          quantity,
          lastUpdated: now,
        });
      }
      let carried = carriedFromSizes.get(product.id);
      if (!carried) {
        carried = new Set();
        carriedFromSizes.set(product.id, carried);
      }
      carried.add(storeId);
    }
  }

  // ---- Наследование бренда/категории по артикулу ----
  // (у дублей артикулов одна часть может иметь бренд, другая — «Не определен»)
  const brandByArticle = new Map<string, { brand: string; category: string; price: number }>();
  for (const product of products) {
    const article = (product.article ?? '').trim();
    if (!article) continue;
    if (!isBadBrandValue(product.brand) && !brandByArticle.has(article)) {
      brandByArticle.set(article, {
        brand: product.brand,
        category: product.category,
        price: product.price,
      });
    }
  }
  let inherited = 0;
  for (const product of products) {
    const article = (product.article ?? '').trim();
    if (!article || !isBadBrandValue(product.brand)) continue;
    const donor = brandByArticle.get(article);
    if (donor) {
      product.brand = donor.brand;
      if (product.category === 'Другое') product.category = donor.category;
      if (product.price === 0) product.price = donor.price;
      inherited++;
    }
  }

  // ---- Магазины, которые возят товар, по числовым колонкам каталога ----
  // Явное число (включая 0) = возит; пустая ячейка = не возит.
  const carriedFromCatalog = new Map<string, Set<string>>();
  if (catalogStoreColumns.length > 0) {
    for (const row of productsRows) {
      const name = String(row[mapping.nameCol] ?? '').trim();
      if (!name) continue;
      const link = linkCol ? normalizeLink(String(row[linkCol] ?? '')) : '';
      const article = mapping.articleCol ? String(row[mapping.articleCol] ?? '').trim() : '';
      const product =
        (link ? byLink.get(link) : undefined) ?? byArticleName.get(`${article}|${name}`);
      if (!product) continue;
      let carried = carriedFromCatalog.get(product.id);
      for (const colName of catalogStoreColumns) {
        const cell = String(row[colName] ?? '').trim();
        if (cell === '' || parseQuantity(cell) === null) continue;
        const storeId = storeIdByName.get(colName);
        if (!storeId) continue;
        if (!carried) {
          carried = new Set();
          carriedFromCatalog.set(product.id, carried);
        }
        carried.add(storeId);
      }
    }
  }

  // ---- Материализация нулей: возящий магазин без размера = «нет в наличии» ----
  const sizesByProduct = new Map<string, Set<string>>();
  for (const item of aggregated.values()) {
    let sizes = sizesByProduct.get(item.productId);
    if (!sizes) {
      sizes = new Set();
      sizesByProduct.set(item.productId, sizes);
    }
    sizes.add(item.size);
  }

  const inventory: InventoryItem[] = [...aggregated.values()];
  const allProductIds = new Set<string>([
    ...products.map((p) => p.id),
  ]);
  for (const productId of allProductIds) {
    const carried = new Set<string>([
      ...(carriedFromSizes.get(productId) ?? []),
      ...(carriedFromCatalog.get(productId) ?? []),
    ]);
    if (carried.size === 0) continue; // никто не возит / распродан без данных
    let sizes = sizesByProduct.get(productId);
    if (!sizes || sizes.size === 0) {
      // Остатков нет нигде, но товар в ассортименте магазинов — позиция «—»
      sizes = new Set(['—']);
      sizesByProduct.set(productId, sizes);
    }
    for (const storeId of carried) {
      for (const size of sizes) {
        if (!aggregated.has(`${productId}|${storeId}|${size}`)) {
          inventory.push({ productId, storeId, size, quantity: 0, lastUpdated: now });
        }
      }
    }
  }

  // ---- Предупреждения ----
  if (skippedSizes > 0) {
    warnings.push(
      `sizes.csv: пропущено строк: ${skippedSizes} (не распознан магазин или количество).`
    );
  }
  const unknownStores = resolver.getUnknown();
  if (unknownStores.length > 0) {
    warnings.push(
      `Нераспознанные магазины в sizes.csv: ${unknownStores.slice(0, 10).join(', ')}.`
    );
  }
  if (extraFromSizes.size > 0) {
    warnings.push(
      `Добавлено из sizes.csv: ${extraFromSizes.size} вариантов товаров, которых нет в каталоге ` +
        `(сайт использует одинаковые артикулы для разных позиций — они учтены отдельно` +
        (inherited > 0 ? `, бренд унаследован по артикулу у ${inherited}` : '') +
        `).`
    );
  }

  // ---- Товары без остатков (распроданы или парсер не нашёл таблицу наличия) ----
  const sizesTextCol = findColumn(productHeaders, ['размеры и наличие', 'наличие по размерам']);
  const noInfoArticles: string[] = [];
  if (sizesTextCol) {
    for (const row of productsRows) {
      const text = String(row[sizesTextCol] ?? '').toLowerCase();
      if (text.includes('нет информации')) {
        const article = mapping.articleCol ? String(row[mapping.articleCol] ?? '').trim() : '';
        if (article) noInfoArticles.push(article);
      }
    }
  }
  if (noInfoArticles.length > 0) {
    warnings.push(
      `Нет таблицы наличия у ${noInfoArticles.length} товаров — они полностью распроданы, либо сайт отдал страницу без таблицы (сбой кэша; парсер повторяет запрос автоматически): ` +
        `${noInfoArticles.slice(0, 10).join(', ')}${noInfoArticles.length > 10 ? ' …' : ''}`
    );
  }

  return {
    stores,
    products,
    inventory,
    uploadedAt: now,
    format: 'long',
    warnings: warnings.length > 0 ? warnings : undefined,
    source: 'bundled',
    ...(options.asOf ? { asOf: options.asOf } : {}),
  };
}

// ============ Загрузка из public/data/ (fetch) ============

/**
 * Загрузка текста с повторами: сайт отдаёт данные с Vercel, и на нестабильном
 * канале (или при подмене ответа провайдером) файл может не доехать — тогда
 * вместо «пустого дашборда» делаем ещё две попытки. 404 не повторяем: файла
 * действительно нет (например, product-settings.json ещё не заведён).
 */
async function fetchText(url: string, attempts = 3): Promise<string> {
  let lastError = '';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { cache: 'no-cache' });
      if (response.status === 404) {
        throw new Error(`HTTP 404 (файла нет)`);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (!text.trim()) throw new Error('пустой ответ');
      return text;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt === attempts || lastError.includes('404')) break;
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
  throw new Error(`Не удалось загрузить ${url}: ${lastError}`);
}

interface ManifestEntry {
  file: string;
  date: string;
}

/** «2026-09-23_16-52-05» → «2026-09-23T16:52:05»; «2026-09-23» → без изменений */
export function snapshotFileToDate(fileName: string): string {
  const base = fileName.replace(/\.(csv|xlsx|xls)$/i, '');
  const match = base.match(/^(\d{4}-\d{2}-\d{2})(?:[_T](\d{2})[-_]?(\d{2})[-_]?(\d{2}))?/);
  if (!match) return base;
  return match[2] ? `${match[1]}T${match[2]}:${match[3]}:${match[4]}` : match[1];
}

async function fetchSnapshotRows(url: string): Promise<Record<string, unknown>[]> {
  if (/\.xlsx?$/i.test(url)) {
    const XLSX = await import('xlsx');
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[];
  }
  return parseCSVText(await fetchText(url));
}

/** Загружает встроенные данные, историю снимков, журнал изменений и ходовые товары */
/**
 * История снимков и size-снимки из public/data/history — самая тяжёлая часть
 * загрузки (десятки МБ). Вынесена отдельно, чтобы интерфейс мог показать
 * данные сразу, а историю дотянуть фоном (см. DataContext).
 */
export async function loadBundledHistory(): Promise<{
  history: HistorySnapshot[];
  sizeSnapshots: SizeSnapshot[];
  lastDate?: string;
}> {
  const base = `${import.meta.env.BASE_URL ?? '/'}data/`;
  let history: HistorySnapshot[] = [];
  let sizeSnapshots: SizeSnapshot[] = [];
  try {
    const manifest = JSON.parse(await fetchText(`${base}history/manifest.json`)) as {
      snapshots?: ManifestEntry[];
      sizeSnapshots?: ManifestEntry[];
    };
    const entries = (manifest.snapshots ?? []).filter((s) => s && s.file);
    const rowSets = await Promise.all(
      entries.map((entry) => fetchSnapshotRows(`${base}history/${entry.file}`).catch(() => null))
    );
    history = rowSets
      .map((rows, i) => {
        if (!rows) return null;
        const date = entries[i].date || snapshotFileToDate(entries[i].file);
        try {
          return parseSnapshotRows(rows, date);
        } catch {
          return null;
        }
      })
      .filter((snapshot): snapshot is HistorySnapshot => snapshot !== null)
      .sort((a, b) => a.date.localeCompare(b.date));

    const sizeEntries = (manifest.sizeSnapshots ?? []).filter((s) => s && s.file);
    const sizeRowSets = await Promise.all(
      sizeEntries.map((entry) =>
        fetchSnapshotRows(`${base}history/${entry.file}`).catch(() => null)
      )
    );
    sizeSnapshots = sizeRowSets
      .map((rows, i) => {
        if (!rows) return null;
        const date = sizeEntries[i].date || snapshotFileToDate(sizeEntries[i].file);
        try {
          return parseSizeSnapshotRows(rows, date);
        } catch {
          return null;
        }
      })
      .filter((snapshot): snapshot is SizeSnapshot => snapshot !== null)
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    // Истории нет — не критично
  }
  const lastDate = history.length > 0 ? history[history.length - 1].date : undefined;
  return { history, sizeSnapshots, lastDate };
}

/** Дата последнего снимка из манифеста — дёшево, без загрузки самих снимков */
export async function loadBundledHistoryLastDate(): Promise<string | undefined> {
  const base = `${import.meta.env.BASE_URL ?? '/'}data/`;
  try {
    const manifest = JSON.parse(await fetchText(`${base}history/manifest.json`)) as {
      snapshots?: ManifestEntry[];
    };
    const dates = (manifest.snapshots ?? [])
      .map((entry) => (entry && entry.file ? entry.date || snapshotFileToDate(entry.file) : ''))
      .filter(Boolean)
      .sort();
    return dates.length > 0 ? dates[dates.length - 1] : undefined;
  } catch {
    return undefined;
  }
}

export async function loadBundledDataset(opts?: { skipHistory?: boolean }): Promise<BundledDataset> {
  const base = `${import.meta.env.BASE_URL ?? '/'}data/`;

  const [productsText, sizesText, changesText, hotText, settingsText, cartMapText, discountsText] =
    await Promise.all([
      fetchText(`${base}products.csv`),
      fetchText(`${base}sizes.csv`).catch(() => ''),
      fetchText(`${base}changes.csv`).catch(() => ''),
      fetchText(`${base}hot-products.json`).catch(() => ''),
      fetchText(`${base}product-settings.json`).catch(() => ''),
      fetchText(`${base}cart-map.json`).catch(() => ''),
      fetchText(`${base}discounts.json`).catch(() => ''),
    ]);

  const productsRows = parseCSVText(productsText);
  const sizesRows = sizesText ? parseCSVText(sizesText) : [];
  const changes = changesText ? parseChangesCsv(parseCSVText(changesText)) : [];

  let hotProducts: HotProductConfig[] = [];
  if (hotText) {
    try {
      const parsed = JSON.parse(hotText) as { articles?: HotProductConfig[] };
      hotProducts = (parsed.articles ?? []).filter(
        (h) => h && typeof h.article === 'string' && Number(h.minPerStore) > 0
      );
    } catch {
      /* повреждённый hot-products.json — работаем без ходовых */
    }
  }

  let history: HistorySnapshot[] = [];
  let sizeSnapshots: SizeSnapshot[] = [];
  let asOf: string | undefined;
  if (opts?.skipHistory) {
    // Первый экран без тяжёлой истории: дату снимка берём из манифеста
    asOf = await loadBundledHistoryLastDate();
  } else {
    const loaded = await loadBundledHistory();
    history = loaded.history;
    sizeSnapshots = loaded.sizeSnapshots;
    asOf = loaded.lastDate;
  }

  const discounts = discountsText ? parseDiscounts(discountsText) : null;
  // Скидки проставляются товарам сразу: price в каталоге уже «со скидкой»,
  // поэтому добавляем только старую цену и процент
  const data = applyDiscounts(parseBundledRows(productsRows, sizesRows, { asOf }), discounts);
  const settings = settingsText ? parseSettings(settingsText) : null;
  const cartMap = cartMapText ? parseCartMap(cartMapText) : null;
  return { data, history, changes, sizeSnapshots, hotProducts, settings, cartMap, discounts };
}
