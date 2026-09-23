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
