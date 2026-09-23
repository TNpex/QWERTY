import type { ParsedData, Store, Product, InventoryItem } from '../types';
import { parseCSVText } from './csv';
import { compareSizes } from './sizes';

// Динамический импорт xlsx: тяжёлая библиотека грузится только при загрузке файла
let xlsxModule: typeof import('xlsx') | null = null;
async function loadXLSX(): Promise<typeof import('xlsx')> {
  if (!xlsxModule) {
    xlsxModule = await import('xlsx');
  }
  return xlsxModule;
}

// ============ Словари названий колонок ============

const NAME_ALIASES = ['название', 'товар', 'наименование', 'name', 'product'];
const BRAND_ALIASES = ['бренд', 'brand', 'производитель'];
const CATEGORY_ALIASES = ['категория', 'category', 'тип', 'группа'];
const PRICE_ALIASES = ['цена', 'price', 'стоимость'];
const ARTICLE_ALIASES = ['артикул', 'article', 'sku', 'код'];
const SIZES_TEXT_ALIASES = ['размеры и наличие', 'наличие по размерам', 'sizes'];
const SIZE_ALIASES = ['размер', 'size', 'р-р'];
const STORE_ALIASES = ['магазин', 'store', 'точка', 'филиал'];
const QTY_ALIASES = ['количество', 'кол-во', 'quantity', 'остаток', 'qty'];

/**
 * Колонки, которые НИКОГДА не считаются магазинами в широком формате.
 * Включает поля «длинного» формата (размер/магазин/количество) — защита от
 * ситуации, когда файл в длинном формате создаёт фейковые «магазины».
 */
const STANDARD_COLUMNS = [
  'категория', 'артикул', 'название', 'товар', 'наименование', 'бренд', 'цена',
  'ссылка', 'размеры и наличие', 'всего', 'фото', 'размер', 'размеры', 'р-р',
  'магазин', 'точка', 'количество', 'кол-во', 'остаток', 'описание', 'description',
];

/** Маппинг свободных названий магазинов из текста «Размеры и наличие» к колонкам файла */
const STORE_NAME_MAPPING: Record<string, string> = {
  'санкт-петербург (спортивная)': 'Спб_Спортивная',
  'спб_спортивная': 'Спб_Спортивная',
  'спортивная': 'Спб_Спортивная',
  'санкт-петербург (ярослава)': 'Спб_Ярослава',
  'санкт-петербург (ярослава гашека)': 'Спб_Ярослава',
  'спб_ярослава': 'Спб_Ярослава',
  'ярослава': 'Спб_Ярослава',
  'ярослава гашека': 'Спб_Ярослава',
  'екб_склад': 'Екб_Склад',
  'основной склад екатеринбург': 'Екб_Склад',
  'склад': 'Екб_Склад',
  'екб_соболева': 'Екб_Соболева',
  'соболева': 'Екб_Соболева',
  'уфа': 'Уфа',
  'ижевск': 'Ижевск',
  'тюмень (народная)': 'Тюмень_Народная',
  'тюмень_народная': 'Тюмень_Народная',
  'народная': 'Тюмень_Народная',
  'тюмень': 'Тюмень_Народная',
  'екб_бисертская': 'Екб_Бисертская',
  'бисертская': 'Екб_Бисертская',
  'екб_парина': 'Екб_Парина',
  'парина': 'Екб_Парина',
  'екб_елизавет': 'Екб_Елизавет',
  'елизаветенское шоссе': 'Екб_Елизавет',
  'елизавет': 'Екб_Елизавет',
};

// ============ Нормализация и поиск колонок ============

export function normalize(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[\s.]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Поиск колонки по списку синонимов. Сначала точное совпадение по всем
 * синонимам, затем подстрочное — так «Цена со скидкой» не перехватит «Цену»,
 * если в файле есть отдельная точная колонка «Цена».
 */
export function findColumn(headers: string[], aliases: string[]): string | null {
  const normalized = headers.map(normalize);
  for (const alias of aliases) {
    const n = normalize(alias);
    const exact = normalized.findIndex((h) => h === n);
    if (exact !== -1) return headers[exact];
  }
  for (const alias of aliases) {
    const n = normalize(alias);
    const partial = normalized.findIndex((h) => h.includes(n) || n.includes(h));
    if (partial !== -1) return headers[partial];
  }
  return null;
}

function isStandardColumn(header: string): boolean {
  return STANDARD_COLUMNS.includes(normalize(header));
}

/**
 * Слова-маркеры служебных колонок. Колонка, содержащая такое слово
 * (напр. «Цена со скидкой», «Скидка», «Ссылка на фото»), никогда
 * не считается магазином даже при подстрочном совпадении.
 */
const NON_STORE_MARKERS = [
  'цена', 'стоимость', 'скидк', 'ссылк', 'фото', 'описан', 'всего', 'итого',
  'бренд', 'производит', 'категор', 'группа', 'артикул', 'наименован',
  'назван', 'товар', 'размер', 'количеств', 'кол_во', 'остаток', 'налич',
];

function looksLikeServiceColumn(header: string): boolean {
  const n = normalize(header);
  return NON_STORE_MARKERS.some((marker) => n.includes(marker));
}

// ============ Определение формата файла ============

interface CommonColumns {
  nameCol: string;
  brandCol: string | null;
  categoryCol: string | null;
  priceCol: string | null;
  articleCol: string | null;
}

export type ColumnMapping =
  | (CommonColumns & {
      format: 'long';
      storeCol: string;
      qtyCol: string;
      sizeCol: string | null;
    })
  | (CommonColumns & {
      format: 'wide';
      storeColumns: string[];
      sizesTextCol: string | null;
    });

export function detectColumns(headers: string[]): ColumnMapping {
  const nameCol = findColumn(headers, NAME_ALIASES);
  if (!nameCol) {
    throw new Error(
      `Не найдена колонка «Название»/«Товар». Колонки в файле: ${headers.join(', ')}. ` +
        'Поддерживаются два формата: «длинный» (Товар, Размер, Магазин, Количество) ' +
        'и «широкий» (колонки магазинов + «Размеры и наличие»).'
    );
  }

  const common: CommonColumns = {
    nameCol,
    brandCol: findColumn(headers, BRAND_ALIASES),
    categoryCol: findColumn(headers, CATEGORY_ALIASES),
    priceCol: findColumn(headers, PRICE_ALIASES),
    articleCol: findColumn(headers, ARTICLE_ALIASES),
  };

  const storeCol = findColumn(headers, STORE_ALIASES);
  const qtyCol = findColumn(headers, QTY_ALIASES);

  // «Длинный» формат: есть колонки «Магазин» и «Количество»
  if (storeCol && qtyCol) {
    return {
      ...common,
      format: 'long',
      storeCol,
      qtyCol,
      sizeCol: findColumn(headers, SIZE_ALIASES),
    };
  }

  // «Широкий» формат: магазины — это колонки, не входящие в стандартные
  const knownCols = new Set(
    [common.nameCol, common.brandCol, common.categoryCol, common.priceCol, common.articleCol]
      .filter((c): c is string => Boolean(c))
      .map(normalize)
  );
  const sizesTextCol = findColumn(headers, SIZES_TEXT_ALIASES);
  if (sizesTextCol) knownCols.add(normalize(sizesTextCol));

  const storeColumns = headers.filter(
    (h) => !isStandardColumn(h) && !looksLikeServiceColumn(h) && !knownCols.has(normalize(h))
  );

  if (storeColumns.length === 0) {
    throw new Error(
      `Не найдены колонки магазинов. Колонки в файле: ${headers.join(', ')}. ` +
        (storeCol && !qtyCol
          ? 'Есть колонка «Магазин», но нет колонки «Количество»/«Остаток» — добавьте её (длиный формат). '
          : '') +
        'Либо используйте широкий формат: одна колонка на каждый магазин с числами.'
    );
  }

  return { ...common, format: 'wide', storeColumns, sizesTextCol };
}

// ============ Парсинг чисел ============

/** Целое количество: «3», «3 шт», «-2» → 0; мусор → null */
export function parseQuantity(raw: unknown): number | null {
  if (typeof raw === 'number') return isFinite(raw) ? Math.max(0, Math.round(raw)) : null;
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const match = text.replace(/\u00a0/g, ' ').match(/-?\d+/);
  if (!match) return null;
  return Math.max(0, parseInt(match[0], 10));
}

/** Цена: «8 990 ₽», «8990,00» → 8990 */
export function parsePrice(raw: unknown): number {
  if (typeof raw === 'number') return isFinite(raw) ? Math.max(0, Math.round(raw)) : 0;
  const text = String(raw ?? '').replace(/\u00a0/g, '').replace(/[^\d.,-]/g, '');
  if (!text) return 0;
  // Запятая как десятичный разделитель; несколько точек — разделители тысяч
  const normalizedText = text.includes(',')
    ? text.replace(/\./g, '').replace(',', '.')
    : text;
  const value = parseFloat(normalizedText);
  return isFinite(value) && value > 0 ? Math.round(value) : 0;
}

// ============ «Размеры и наличие»: резолвер магазинов ============

interface StoreResolver {
  resolve: (rawName: string) => string | null;
  getUnknown: () => string[];
}

/**
 * Сопоставляет название магазина из текста с колонкой файла:
 * 1) жёсткий маппинг STORE_NAME_MAPPING;
 * 2) точное совпадение с названием колонки (нормализованное);
 * 3) подстрочное совпадение в обе стороны (побеждает наиболее длинное).
 * Нераспознанные названия собираются для предупреждения пользователю.
 */
export function buildStoreResolver(storeColumns: string[]): StoreResolver {
  const normalizedMapping = new Map<string, string>();
  for (const [key, value] of Object.entries(STORE_NAME_MAPPING)) {
    normalizedMapping.set(normalize(key), value);
  }
  const normalizedColumns = storeColumns.map((col) => ({ col, n: normalize(col) }));
  const cache = new Map<string, string | null>();
  const unknown = new Set<string>();

  const resolve = (rawName: string): string | null => {
    const key = normalize(rawName);
    if (!key) return null;
    if (cache.has(key)) return cache.get(key)!;

    let result: string | null = null;

    // 1. Жёсткий маппинг (если целевая колонка реально есть в файле)
    const mapped = normalizedMapping.get(key);
    if (mapped && storeColumns.includes(mapped)) {
      result = mapped;
    }

    // 2. Точное совпадение с колонкой
    if (!result) {
      const exact = normalizedColumns.find((c) => c.n === key);
      if (exact) result = exact.col;
    }

    // 3. Подстрочное совпадение (самое длинное пересечение побеждает)
    if (!result) {
      let best: { col: string; len: number } | null = null;
      for (const c of normalizedColumns) {
        if (c.n.length >= 3 && key.length >= 3 && (key.includes(c.n) || c.n.includes(key))) {
          const len = Math.min(c.n.length, key.length);
          if (!best || len > best.len) best = { col: c.col, len };
        }
      }
      if (best) result = best.col;
    }

    if (!result) unknown.add(rawName.trim());
    cache.set(key, result);
    return result;
  };

  return { resolve, getUnknown: () => [...unknown] };
}

/**
 * Парсинг ячейки «Размеры и наличие».
 * Формат: «43: Спб_Спортивная - 2 шт | Екб_Склад - 1 пар | 44: Уфа - 3»
 * Возвращает Map<колонка магазина, Map<размер, количество>>.
 */
export function parseSizesAndStores(
  value: unknown,
  resolver: StoreResolver
): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();
  if (value === null || value === undefined) return result;
  const str = String(value).trim();
  if (!str) return result;

  let currentSize = '';
  const parts = str.split('|').map((p) => p.trim());

  const addStoreQty = (rawStore: string, size: string, quantity: number) => {
    const columnName = resolver.resolve(rawStore);
    if (!columnName || !size) return;
    let storeSizes = result.get(columnName);
    if (!storeSizes) {
      storeSizes = new Map();
      result.set(columnName, storeSizes);
    }
    storeSizes.set(size, (storeSizes.get(size) ?? 0) + quantity);
  };

  for (const part of parts) {
    if (!part) continue;
    // Есть ли размер в начале сегмента («L:», «43:», «42,5:»)?
    const sizeMatch = part.match(/^([A-Z0-9А-ЯЁ,./-]+):\s*(.+)$/i);
    const rest = sizeMatch ? sizeMatch[2].trim() : part;
    if (sizeMatch) currentSize = sizeMatch[1].trim();

    // «Магазин - 3 шт» (магазин может содержать дефисы, поэтому берём последнюю « - число»)
    const storeQtyMatch = rest.match(/^(.+?)\s*-\s*(\d+)\s*(шт\.?|пар\.?|ед\.?)?$/i);
    if (storeQtyMatch && currentSize) {
      addStoreQty(storeQtyMatch[1].trim(), currentSize, parseInt(storeQtyMatch[2], 10));
    }
  }

  return result;
}

// ============ Основные форматы ============

function productKey(name: string, brand: string, article: string): string {
  return `${normalize(name)}|${normalize(brand)}|${normalize(article)}`;
}

/** «Длинный» формат: одна строка = один остаток (Товар, Размер, Магазин, Количество) */
function parseLongFormat(
  rows: Record<string, unknown>[],
  mapping: Extract<ColumnMapping, { format: 'long' }>
): ParsedData {
  const warnings: string[] = [];
  const now = new Date().toISOString();

  const storesMap = new Map<string, Store>();
  const productsMap = new Map<string, Product>();
  const inventoryMap = new Map<string, InventoryItem>(); // дубли строки суммируются
  let skipped = 0;

  for (const row of rows) {
    const name = String(row[mapping.nameCol] ?? '').trim();
    const storeName = String(row[mapping.storeCol] ?? '').trim();
    const quantity = parseQuantity(row[mapping.qtyCol]);

    if (!name || !storeName || quantity === null) {
      skipped++;
      continue;
    }

    const brand = mapping.brandCol ? String(row[mapping.brandCol] ?? '').trim() || 'Неизвестно' : 'Неизвестно';
    const category = mapping.categoryCol ? String(row[mapping.categoryCol] ?? '').trim() || 'Другое' : 'Другое';
    const price = mapping.priceCol ? parsePrice(row[mapping.priceCol]) : 0;
    const article = mapping.articleCol ? String(row[mapping.articleCol] ?? '').trim() : '';
    const size = mapping.sizeCol ? String(row[mapping.sizeCol] ?? '').trim() || '—' : '—';

    let store = storesMap.get(normalize(storeName));
    if (!store) {
      store = { id: `store_${storesMap.size + 1}`, name: storeName };
      storesMap.set(normalize(storeName), store);
    }

    const pKey = productKey(name, brand, article);
    let product = productsMap.get(pKey);
    if (!product) {
      product = { id: `p_${productsMap.size + 1}`, name, brand, category, price, article };
      productsMap.set(pKey, product);
    }

    const invKey = `${product.id}|${store.id}|${size}`;
    const existing = inventoryMap.get(invKey);
    if (existing) {
      existing.quantity += quantity; // повторяющиеся строки — суммируем
    } else {
      inventoryMap.set(invKey, {
        productId: product.id,
        storeId: store.id,
        size,
        quantity,
        lastUpdated: now,
      });
    }
  }

  if (skipped > 0) {
    warnings.push(
      `Пропущено строк: ${skipped} (пустые «Товар»/«Магазин» или нечисловое «Количество»).`
    );
  }
  if (storesMap.size === 0) {
    throw new Error('В файле не найдено ни одного магазина с данными.');
  }

  return {
    stores: [...storesMap.values()],
    products: [...productsMap.values()],
    inventory: [...inventoryMap.values()],
    uploadedAt: now,
    format: 'long',
    warnings,
  };
}

/** «Широкий» формат: магазины — колонки; наличие — текст «Размеры и наличие» либо числа в колонках */
function parseWideFormat(
  rows: Record<string, unknown>[],
  mapping: Extract<ColumnMapping, { format: 'wide' }>
): ParsedData {
  const warnings: string[] = [];
  const now = new Date().toISOString();

  const stores: Store[] = mapping.storeColumns.map((colName, index) => ({
    id: `store_${index + 1}`,
    name: colName,
  }));
  const storeByColumn = new Map(stores.map((s) => [s.name, s]));
  const resolver = buildStoreResolver(mapping.storeColumns);

  const productsMap = new Map<string, Product>();
  const inventory: InventoryItem[] = [];
  let skipped = 0;
  let badValueWarnings = 0;
  let badValueTotal = 0;

  const pushItem = (product: Product, store: Store, size: string, quantity: number, notCarried: boolean) => {
    inventory.push({
      productId: product.id,
      storeId: store.id,
      size,
      quantity,
      ...(notCarried ? { notCarried: true } : {}),
      lastUpdated: now,
    });
  };

  for (const row of rows) {
    const name = String(row[mapping.nameCol] ?? '').trim();
    if (!name) {
      skipped++;
      continue;
    }

    const brand = mapping.brandCol ? String(row[mapping.brandCol] ?? '').trim() || 'Неизвестно' : 'Неизвестно';
    const category = mapping.categoryCol ? String(row[mapping.categoryCol] ?? '').trim() || 'Другое' : 'Другое';
    const price = mapping.priceCol ? parsePrice(row[mapping.priceCol]) : 0;
    const article = mapping.articleCol ? String(row[mapping.articleCol] ?? '').trim() : '';

    const pKey = productKey(name, brand, article);
    let product = productsMap.get(pKey);
    if (!product) {
      product = { id: `p_${productsMap.size + 1}`, name, brand, category, price, article };
      productsMap.set(pKey, product);
    }

    const sizesAndStores = mapping.sizesTextCol
      ? parseSizesAndStores(row[mapping.sizesTextCol], resolver)
      : new Map<string, Map<string, number>>();

    if (sizesAndStores.size > 0) {
      // Данные из текста «Размеры и наличие»
      const allSizes = new Set<string>();
      sizesAndStores.forEach((storeSizes) => {
        storeSizes.forEach((_qty, size) => allSizes.add(size));
      });
      const sortedSizes = [...allSizes].sort(compareSizes);

      for (const colName of mapping.storeColumns) {
        const store = storeByColumn.get(colName)!;
        const storeSizes = sizesAndStores.get(colName);
        // Магазин упоминается в данных товара → возит его (нули размеров = реальный OOS).
        // Не упоминается → notCarried (не путать с «нет в наличии»).
        const carried = storeSizes !== undefined;
        for (const size of sortedSizes) {
          pushItem(product, store, size, carried ? storeSizes!.get(size) ?? 0 : 0, !carried);
        }
      }
    } else {
      // Числовые колонки магазинов (без размеров)
      for (const colName of mapping.storeColumns) {
        const store = storeByColumn.get(colName)!;
        const raw = row[colName];
        const text = String(raw ?? '').trim();
        if (text === '') {
          // Пустая ячейка — магазин не возит товар
          pushItem(product, store, '—', 0, true);
        } else {
          const qty = parseQuantity(raw);
          if (qty === null) {
            badValueTotal++;
            if (badValueWarnings < 5) {
              warnings.push(`Нечисловое значение «${text}» для товара «${name}» (${colName}) — записан 0.`);
              badValueWarnings++;
            }
            pushItem(product, store, '—', 0, false);
          } else {
            pushItem(product, store, '—', qty, false);
          }
        }
      }
    }
  }

  const unknownStores = resolver.getUnknown();
  if (unknownStores.length > 0) {
    warnings.push(
      `Нераспознанные магазины в колонке «Размеры и наличие»: ${unknownStores.slice(0, 10).join(', ')}` +
        (unknownStores.length > 10 ? ` (и ещё ${unknownStores.length - 10})` : '') +
        '. Их остатки не учтены.'
    );
  }
  if (badValueTotal > 5) {
    warnings.push(`Всего нечисловых значений в колонках магазинов: ${badValueTotal} — записаны нули.`);
  }
  if (skipped > 0) {
    warnings.push(`Пропущено строк без названия товара: ${skipped}.`);
  }
  if (productsMap.size === 0) {
    throw new Error('В файле не найдено ни одного товара.');
  }

  return {
    stores,
    products: [...productsMap.values()],
    inventory,
    uploadedAt: now,
    format: 'wide',
    warnings,
  };
}

/**
 * Ядро парсинга: массив объектов «колонка → значение» (из CSV или XLSX)
 * превращается в ParsedData. Экспортируется для unit-тестов.
 */
export function parseRowsToData(rows: Record<string, unknown>[]): ParsedData {
  if (rows.length === 0) {
    throw new Error('Файл пустой или не содержит строк с данными.');
  }
  const headers = Object.keys(rows[0]);
  const mapping = detectColumns(headers);
  return mapping.format === 'long'
    ? parseLongFormat(rows, mapping)
    : parseWideFormat(rows, mapping);
}

/** Точка входа: читает File (.xlsx/.xls/.csv) и возвращает разобранные данные */
export async function parseXLSX(file: File): Promise<ParsedData> {
  const lowerName = file.name.toLowerCase();
  let rows: Record<string, unknown>[];

  if (lowerName.endsWith('.csv')) {
    const text = await file.text();
    rows = parseCSVText(text);
  } else if (/\.(xlsx|xls|xlsm|ods)$/.test(lowerName)) {
    const xlsx = await loadXLSX();
    const buffer = await file.arrayBuffer();
    const workbook = xlsx.read(new Uint8Array(buffer), { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw new Error('В файле нет ни одного листа.');
    }
    const worksheet = workbook.Sheets[firstSheetName];
    rows = xlsx.utils.sheet_to_json(worksheet, { defval: '' }) as Record<string, unknown>[];
  } else {
    throw new Error('Неподдерживаемый формат. Поддерживаются файлы .xlsx, .xls и .csv');
  }

  try {
    const parsed = parseRowsToData(rows);
    if (parsed.products.length === 0) {
      throw new Error('Не удалось найти данные в файле');
    }
    if (import.meta.env?.DEV) {
      console.info(
        `[parser] формат=${parsed.format}: ${parsed.products.length} товаров, ` +
          `${parsed.stores.length} магазинов, ${parsed.inventory.length} записей`,
        parsed.warnings?.length ? { warnings: parsed.warnings } : ''
      );
    }
    return parsed;
  } catch (error) {
    throw new Error(`Ошибка парсинга: ${error instanceof Error ? error.message : 'неизвестная ошибка'}`);
  }
}
