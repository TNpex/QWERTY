#!/usr/bin/env node
/**
 * Скрипт сбора картинок товаров с saletennis.com.
 *
 * Как работает:
 * 1. Берёт категории из sitemap.xml и обходит листинги (?page=N) —
 *    на каждой странице ~40 карточек «ссылка → картинка».
 * 2. Для товаров из public/data/products.csv, которых нет в листингах,
 *    добирает картинку с отдельной страницы товара.
 * 3. Пишет public/data/product-images.json: { "/catalog/product/<slug>/": "https://...png" }
 *
 * Запуск (из корня проекта):
 *   node scripts/scrape-images.mjs            # полный сбор
 *   node scripts/scrape-images.mjs --missing  # только недостающие (быстро)
 *
 * Сайт принадлежит владельцу проекта; robots.txt каталог не запрещает.
 * Пожалуйста, не запускайте чаще раза в день.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const SITE = 'https://saletennis.com';
const CONCURRENCY = 6;
const DELAY_MS = 120;
const OUT_FILE = join('public', 'data', 'product-images.json');
const CATALOG_CSV = join('public', 'data', 'products.csv');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'SaleTennis-BI-image-collector (own store data)' },
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      if (attempt === retries) {
        console.warn(`  ⚠️ не удалось загрузить ${url}: ${error.message}`);
        return null;
      }
      await sleep(500 * (attempt + 1));
    }
  }
  return null;
}

/** Простая очередь с ограничением параллелизма */
async function mapLimited(items, limit, fn) {
  const results = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
      await sleep(DELAY_MS);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Извлекает пары (ссылка на товар → картинка) из HTML листинга/страницы */
function extractProductImages(html) {
  const pairs = new Map();
  const linkRegex = /href="(\/catalog\/product\/[^"#?]+)"/g;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const link = match[1];
    if (pairs.has(link)) continue;
    // Ищем ближайшую картинку товара после ссылки (в пределах карточки)
    const window = html.slice(match.index, match.index + 2000);
    const img = window.match(/\/uploads\/media\/product\/[^"']+/);
    if (img) {
      pairs.set(link, toBigVariant(img[0]));
    }
  }
  return pairs;
}

/** thumb_123_product_list.png → thumb_123_product_big.png (крупное изображение) */
function toBigVariant(path) {
  const big = path.replace(/_product_(list|small|mini)/, '_product_big');
  return SITE + big;
}

async function getCategoryPages() {
  const xml = await fetchText(`${SITE}/sitemap.xml`);
  if (!xml) throw new Error('sitemap.xml недоступен');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const categories = [
    ...new Set(
      locs.filter((l) => l.includes('/catalog/') && !l.includes('/catalog/product/'))
    ),
  ];
  return categories;
}

function readCatalogLinks() {
  if (!existsSync(CATALOG_CSV)) return [];
  const text = readFileSync(CATALOG_CSV, 'utf8').replace(/^\uFEFF/, '');
  // Колонка «Ссылка» — ищем все URL товаров (грубо, но надёжно для этого формата)
  const links = [...text.matchAll(/https:\/\/saletennis\.com\/catalog\/product\/[^,"\r\n]+/g)];
  return [...new Set(links.map((m) => m[0].replace(SITE, '')))];
}

async function main() {
  const onlyMissing = process.argv.includes('--missing');
  let images = {};
  if (existsSync(OUT_FILE)) {
    try {
      images = JSON.parse(readFileSync(OUT_FILE, 'utf8'));
    } catch {
      images = {};
    }
  }

  const catalogLinks = readCatalogLinks();
  console.log(`Товаров в каталоге сайта (products.csv): ${catalogLinks.length}`);
  console.log(`Уже собрано картинок: ${Object.keys(images).length}`);

  let toProcess;
  if (onlyMissing) {
    toProcess = null; // пропустим листинги, работаем только по недостающим
  } else {
    const categories = await getCategoryPages();
    console.log(`Категорий в sitemap: ${categories.length}`);

    // Собираем все страницы листингов
    const listingPages = [];
    for (const category of categories) {
      listingPages.push(category);
      for (let page = 2; page <= 200; page++) {
        listingPages.push(`${category}?page=${page}`);
      }
    }
    // Обходим категории параллельно, страницы последовательно внутри категории
    await mapLimited(categories, CONCURRENCY, async (category) => {
      for (let page = 1; page <= 200; page++) {
        const url = page === 1 ? category : `${category}?page=${page}`;
        const html = await fetchText(url);
        if (!html) break;
        const pairs = extractProductImages(html);
        for (const [link, image] of pairs) images[link] = image;
        if (pairs.size === 0) break; // страницы закончились
        await sleep(DELAY_MS);
      }
      console.log(`  ✓ ${category.replace(SITE, '')} — всего собрано: ${Object.keys(images).length}`);
    });
    toProcess = catalogLinks.filter((link) => !images[link]);
  }

  if (onlyMissing) {
    toProcess = catalogLinks.filter((link) => !images[link]);
  }

  // Добираем недостающие товары с их страниц
  if (toProcess && toProcess.length > 0) {
    console.log(`Добираем ${toProcess.length} товаров с отдельных страниц...`);
    await mapLimited(toProcess, CONCURRENCY, async (link) => {
      const html = await fetchText(SITE + link);
      if (!html) return;
      const pairs = extractProductImages(html);
      const direct = html.match(/\/uploads\/media\/product\/[^"']+_product_big[^"']*/);
      if (direct) images[link] = SITE + direct[0];
      else if (pairs.get(link)) images[link] = pairs.get(link);
    });
  }

  const found = catalogLinks.filter((l) => images[l]).length;
  writeFileSync(OUT_FILE, JSON.stringify(images, null, 0), 'utf8');
  console.log('');
  console.log(`✅ Готово: ${Object.keys(images).length} картинок в ${OUT_FILE}`);
  console.log(`   Покрытие каталога сайта: ${found}/${catalogLinks.length}`);
}

main().catch((error) => {
  console.error('Ошибка:', error.message);
  process.exit(1);
});
