import type { ParsedData } from '../types';

/**
 * Ручные правки атрибутов товара (например, бренд, который не указан на сайте).
 * Хранятся в localStorage браузера, применяются при каждой загрузке данных и
 * экспортируются в JSON, чтобы перенести их в CSV командой:
 *   npm run apply-edits -- brand-edits.json   (scripts/apply-brand-edits.mjs)
 */

const STORAGE_KEY = 'saletennis-brand-overrides';

export type BrandOverrides = Record<string, string>; // артикул → бренд

export function loadBrandOverrides(): BrandOverrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as BrandOverrides) : {};
  } catch {
    return {};
  }
}

export function saveBrandOverrides(overrides: BrandOverrides): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    /* приватный режим — не критично */
  }
}

/** Применяет ручные правки бренда ко всем товарам с тем же артикулом */
export function applyBrandOverrides(data: ParsedData, overrides: BrandOverrides): ParsedData {
  const keys = Object.keys(overrides);
  if (keys.length === 0) return data;
  const overrideSet = new Set(keys.map((k) => k.trim().toLowerCase()));

  let touched = false;
  const products = data.products.map((product) => {
    const article = (product.article ?? '').trim().toLowerCase();
    if (article && overrideSet.has(article)) {
      const newBrand = overrides[Object.keys(overrides).find((k) => k.trim().toLowerCase() === article)!];
      if (newBrand && product.brand !== newBrand) {
        touched = true;
        return { ...product, brand: newBrand };
      }
    }
    return product;
  });
  return touched ? { ...data, products } : data;
}

/** Экспорт правок в JSON-файл (для переноса в CSV / другой браузер) */
export function downloadBrandOverrides(overrides: BrandOverrides): void {
  const blob = new Blob([JSON.stringify(overrides, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'brand-edits.json';
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Убирает правки, которые больше ничего не меняют: бренд в данных уже совпадает
 * со значением правки (правку зафиксировали в CSV через apply-edits, или парсер
 * стал сам определять бренд — например, после добавления Diadora/Tecnifibre).
 * Правки для товаров, которых сейчас нет в данных, СОХРАНЯЮТСЯ — они сработают,
 * когда товар вернётся на сайт.
 */
export function pruneAppliedOverrides(
  data: ParsedData | null,
  overrides: BrandOverrides
): { kept: BrandOverrides; removed: number } {
  if (!data) return { kept: overrides, removed: 0 };

  const brandsByArticle = new Map<string, string[]>();
  for (const product of data.products) {
    const article = (product.article ?? '').trim().toLowerCase();
    if (!article) continue;
    const list = brandsByArticle.get(article);
    if (list) list.push(product.brand);
    else brandsByArticle.set(article, [product.brand]);
  }

  const kept: BrandOverrides = {};
  let removed = 0;
  for (const [article, brand] of Object.entries(overrides)) {
    const key = article.trim().toLowerCase();
    const target = brand.trim();
    const brands = brandsByArticle.get(key);
    if (target && brands && brands.length > 0 && brands.every((b) => b === target)) {
      removed += 1; // все товары артикула уже носят этот бренд — правка избыточна
      continue;
    }
    kept[article] = brand;
  }
  return { kept, removed };
}
