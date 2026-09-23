/**
 * Картинки товаров: карта «путь товара на сайте → URL изображения».
 * Файл public/data/product-images.json создаётся скриптом scripts/scrape-images.mjs
 * (обход листингов категорий saletennis.com; запускать не чаще раза в день).
 */

/** Приводит ссылку товара к пути (ключу карты): origin и хвостовой слэш отбрасываются */
export function toProductPath(link: string): string {
  let path: string;
  try {
    path = new URL(link.trim()).pathname;
  } catch {
    const trimmed = link.trim();
    path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  }
  return path.replace(/\/+$/, '');
}

export type ProductImageMap = Record<string, string>;

/** Базовый URL локальных фото: public/data/product_images/<имя файла> */
export function localPhotoUrl(fileName: string): string {
  const base = `${import.meta.env.BASE_URL ?? '/'}data/product_images/`;
  return `${base}${encodeURIComponent(fileName)}`;
}

/**
 * Кандидаты локального фото в порядке приоритета:
 * сначала сжатая .webp-версия (создаётся scripts/compress-images.mjs),
 * затем исходный файл (.png/.jpg). Колонка «Фото» в CSV при этом не меняется.
 */
export function localPhotoCandidates(fileName: string): string[] {
  const candidates: string[] = [];
  const webpName = fileName.replace(/\.(png|jpe?g|gif|avif)$/i, '.webp');
  if (webpName !== fileName) {
    candidates.push(localPhotoUrl(webpName));
  }
  candidates.push(localPhotoUrl(fileName));
  return candidates;
}

/** Приводит путь из колонки «Фото» (data\product_images\x.png) к имени файла */
export function photoFileName(raw: unknown): string | undefined {
  const text = String(raw ?? '').trim();
  if (!text) return undefined;
  const name = text.replace(/\\/g, '/').split('/').pop()?.trim();
  return name && /\.(png|jpe?g|webp|gif|avif)$/i.test(name) ? name : undefined;
}

/** Загружает карту картинок один раз. При ошибке (нет файла) — пустая карта. */
let imagesPromise: Promise<ProductImageMap> | null = null;

export function loadProductImages(): Promise<ProductImageMap> {
  if (!imagesPromise) {
    imagesPromise = (async () => {
      try {
        const base = `${import.meta.env.BASE_URL ?? '/'}data/product-images.json`;
        const response = await fetch(base, { cache: 'no-cache' });
        if (!response.ok) return {};
        const raw = (await response.json()) as ProductImageMap;
        // Ключи карты приводим к тому же формату, что и toProductPath (без хвостового /)
        const normalized: ProductImageMap = {};
        for (const [key, value] of Object.entries(raw)) {
          normalized[key.replace(/\/+$/, '')] = value;
        }
        return normalized;
      } catch {
        return {};
      }
    })();
  }
  return imagesPromise;
}
