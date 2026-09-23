/**
 * Картинки товаров: карта «путь товара на сайте → URL изображения».
 * Файл public/data/product-images.json создаётся скриптом scripts/scrape-images.mjs
 * (обход листингов категорий saletennis.com; запускать не чаще раза в день).
 */

/** Приводит ссылку товара к пути (ключу карты): origin отбрасывается */
export function toProductPath(link: string): string {
  try {
    return new URL(link).pathname;
  } catch {
    return link.startsWith('/') ? link : `/${link}`;
  }
}

export type ProductImageMap = Record<string, string>;

/** Загружает карту картинок один раз. При ошибке (нет файла) — пустая карта. */
let imagesPromise: Promise<ProductImageMap> | null = null;

export function loadProductImages(): Promise<ProductImageMap> {
  if (!imagesPromise) {
    imagesPromise = (async () => {
      try {
        const base = `${import.meta.env.BASE_URL ?? '/'}data/product-images.json`;
        const response = await fetch(base, { cache: 'no-cache' });
        if (!response.ok) return {};
        return (await response.json()) as ProductImageMap;
      } catch {
        return {};
      }
    })();
  }
  return imagesPromise;
}
