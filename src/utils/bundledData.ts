import type { ParsedData, Store, Product, InventoryItem } from '../types';
import { parseCSVText } from './csv';
import { normalizeSize } from './sizes';
import { detectColumns, findColumn, parsePrice, parseQuantity, buildStoreResolver } from './xlsxParser';
import { parseSnapshotRows, type HistorySnapshot } from './historyCore';

/**
 * Загрузка встроенного набора данных из public/data/:
 * - products.csv — каталог (широкий формат: магазины-колонки);
 * - sizes.csv — остатки по размерам (длинный формат: Размер/Магазин/Количество);
 * - history/ — датированные снимки парсинга (YYYY-MM-DD.csv) + manifest.json.
 *
 * Остатки берутся из sizes.csv (точнее: с размерами). Каталог — из products.csv.
 * Для каждого товара материализуются нулевые строки отсутствующих размеров в
 * магазинах, которые этот товар возят — так метрика «нет в наличии» и
 * рекомендации по перемещению видят реальные дыры в размерных сетках.
 */

const LINK_ALIASES = ['ссылка', 'link', 'url'];

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
}

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

  // Магазины — из колонок products.csv (канонические полные названия)
  let storeColumns: string[];
  if (mapping.format === 'wide') {
    storeColumns = mapping.storeColumns;
  } else {
    // products.csv неожиданно в длинном формате — берём магазины из sizes.csv
    storeColumns = [];
  }
  if (storeColumns.length === 0 && sizesRows.length > 0) {
    const sizesHeaders = Object.keys(sizesRows[0]);
    const storeCol = findColumn(sizesHeaders, ['магазин', 'store', 'точка']);
    if (storeCol) {
      storeColumns = [...new Set(sizesRows.map((r) => String(r[storeCol] ?? '').trim()).filter(Boolean))];
    }
  }
  if (storeColumns.length === 0) {
    throw new Error('Не удалось определить список магазинов');
  }

  const stores: Store[] = storeColumns.map((name, index) => ({
    id: `store_${index + 1}`,
    name,
  }));
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
    const link = linkCol ? String(row[linkCol] ?? '').trim() : '';
    const article = mapping.articleCol ? String(row[mapping.articleCol] ?? '').trim() : '';
    const brand = mapping.brandCol ? String(row[mapping.brandCol] ?? '').trim() || 'Неизвестно' : 'Неизвестно';
    const category = mapping.categoryCol ? String(row[mapping.categoryCol] ?? '').trim() || 'Другое' : 'Другое';
    const price = mapping.priceCol ? parsePrice(row[mapping.priceCol]) : 0;

    // Артикул НЕ уникален (варианты цветов одной модели) — ключом служит ссылка
    const id = `p_${hashString(link || `${article}|${name}`)}`;
    if (productById.has(id)) continue;

    const product: Product = { id, name, brand, category, price, article, ...(link ? { link } : {}) };
    products.push(product);
    productById.set(id, product);
    if (link) byLink.set(link, product);
    byArticleName.set(`${article}|${name}`, product);
  }

  // ---- Остатки из sizes.csv ----
  const aggregated = new Map<string, InventoryItem>(); // pid|sid|size → item
  let skippedSizes = 0;

  if (sizesRows.length > 0) {
    const sizesHeaders = Object.keys(sizesRows[0]);
    const sizeCol = findColumn(sizesHeaders, ['размер', 'size', 'р-р']);
    const storeCol = findColumn(sizesHeaders, ['магазин', 'store', 'точка']);
    const qtyCol = findColumn(sizesHeaders, ['количество', 'кол-во', 'quantity', 'остаток']);
    const linkColS = findColumn(sizesHeaders, LINK_ALIASES);
    const articleColS = findColumn(sizesHeaders, ['артикул', 'article', 'sku']);
    const nameColS = findColumn(sizesHeaders, ['название', 'товар', 'наименование']);

    if (!storeCol || !qtyCol) {
      throw new Error('sizes.csv: не найдены колонки «Магазин» или «Количество»');
    }

    for (const row of sizesRows) {
      const link = linkColS ? String(row[linkColS] ?? '').trim() : '';
      const article = articleColS ? String(row[articleColS] ?? '').trim() : '';
      const name = nameColS ? String(row[nameColS] ?? '').trim() : '';

      let product = link ? byLink.get(link) : undefined;
      if (!product) product = byArticleName.get(`${article}|${name}`);
      if (!product) {
        // Товар не найден в каталоге — добавляем (защита от рассинхрона файлов)
        const id = `p_${hashString(link || `${article}|${name}`)}`;
        product = productById.get(id);
        if (!product) {
          product = {
            id,
            name: name || article || 'Неизвестный товар',
            brand: 'Неизвестно',
            category: 'Другое',
            price: 0,
            article,
            ...(link ? { link } : {}),
          };
          products.push(product);
          productById.set(id, product);
          if (link) byLink.set(link, product);
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
    }
  }

  // ---- Материализация нулей: отсутствующий размер в возящем магазине = «нет в наличии» ----
  const sizesByProductStore = new Map<string, Set<string>>(); // pid → размеры
  const storesByProduct = new Map<string, Set<string>>(); // pid → возящие магазины
  for (const item of aggregated.values()) {
    let sizes = sizesByProductStore.get(item.productId);
    if (!sizes) {
      sizes = new Set();
      sizesByProductStore.set(item.productId, sizes);
    }
    sizes.add(item.size);

    let prodStores = storesByProduct.get(item.productId);
    if (!prodStores) {
      prodStores = new Set();
      storesByProduct.set(item.productId, prodStores);
    }
    prodStores.add(item.storeId);
  }

  const inventory: InventoryItem[] = [...aggregated.values()];
  for (const [productId, prodStores] of storesByProduct) {
    const sizes = sizesByProductStore.get(productId)!;
    for (const storeId of prodStores) {
      for (const size of sizes) {
        if (!aggregated.has(`${productId}|${storeId}|${size}`)) {
          inventory.push({ productId, storeId, size, quantity: 0, lastUpdated: now });
        }
      }
    }
  }

  if (skippedSizes > 0) {
    warnings.push(`sizes.csv: пропущено строк: ${skippedSizes} (не распознан магазин или количество).`);
  }
  const unknownStores = resolver.getUnknown();
  if (unknownStores.length > 0) {
    warnings.push(`Нераспознанные магазины в sizes.csv: ${unknownStores.slice(0, 10).join(', ')}.`);
  }
  const soldOutCount = products.filter((p) => !storesByProduct.has(p.id)).length;
  if (soldOutCount > 0) {
    warnings.push(`Товаров без остатков (распроданы во всей сети): ${soldOutCount}.`);
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

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`Не удалось загрузить ${url}: HTTP ${response.status}`);
  }
  return response.text();
}

interface ManifestEntry {
  file: string;
  date: string;
}

/** Загружает встроенные данные и историю снимков. Бросает ошибку, если данных нет. */
export async function loadBundledDataset(): Promise<BundledDataset> {
  const base = `${import.meta.env.BASE_URL ?? '/'}data/`;

  const [productsText, sizesText] = await Promise.all([
    fetchText(`${base}products.csv`),
    fetchText(`${base}sizes.csv`).catch(() => ''),
  ]);

  const productsRows = parseCSVText(productsText);
  const sizesRows = sizesText ? parseCSVText(sizesText) : [];

  // История снимков (опциональна)
  let history: HistorySnapshot[] = [];
  try {
    const manifest = JSON.parse(await fetchText(`${base}history/manifest.json`)) as {
      snapshots?: ManifestEntry[];
    };
    const entries = (manifest.snapshots ?? []).filter((s) => s && s.file);
    const texts = await Promise.all(
      entries.map((entry) => fetchText(`${base}history/${entry.file}`).catch(() => null))
    );
    history = texts
      .map((text, i) => {
        if (!text) return null;
        const date = entries[i].date || entries[i].file.replace(/\.csv$/i, '');
        try {
          return parseSnapshotRows(parseCSVText(text), date);
        } catch {
          return null;
        }
      })
      .filter((snapshot): snapshot is HistorySnapshot => snapshot !== null)
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    // Истории нет — не критично
  }

  const asOf = history.length > 0 ? history[history.length - 1].date : undefined;
  const data = parseBundledRows(productsRows, sizesRows, { asOf });
  return { data, history };
}
