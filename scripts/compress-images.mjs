#!/usr/bin/env node
/**
 * Сжатие фотографий товаров: PNG/JPG → WebP (меньше в 5–15 раз без видимой
 * потери качества для карточек товара).
 *
 * Использование (из корня проекта):
 *   npm run compress-images                      # public/data/product_images
 *   npm run compress-images -- --max=600         # другая максимальная сторона
 *   npm run compress-images -- --quality=75      # другое качество WebP
 *   npm run compress-images -- --keep            # НЕ удалять исходные PNG
 *   npm run compress-images -- --force           # пересжать уже сжатое
 *   npm run compress-images -- C:\путь\к\папке   # произвольная папка
 *
 * Сайт автоматически предпочитает .webp-версию фото, а при её отсутствии
 * берёт исходный .png (см. src/utils/images.ts), поэтому переименовывать
 * файлы и править products.csv НЕ нужно.
 *
 * Требуется sharp (ставится вместе с npm install, devDependency).
 */
import { readdirSync, statSync, unlinkSync, existsSync } from 'fs';
import { join, extname, basename } from 'path';

// ---- аргументы ----
const args = process.argv.slice(2);
const getOpt = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : def;
};
const hasFlag = (name) => args.includes(`--${name}`);
const positional = args.filter((a) => !a.startsWith('--'));

const FOLDER = positional[0] || join('public', 'data', 'product_images');
const MAX_SIDE = getOpt('max', 700);
const QUALITY = getOpt('quality', 82);
const KEEP_ORIGINALS = hasFlag('keep');
const FORCE = hasFlag('force');

if (!existsSync(FOLDER)) {
  console.error(`Папка не найдена: ${FOLDER}`);
  console.error('Сначала выполните: npm run images -- <путь к Product_images>');
  process.exit(1);
}

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('Не найден пакет sharp. Выполните: npm install');
  process.exit(1);
}

const SOURCE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);
const files = readdirSync(FOLDER).filter((f) =>
  SOURCE_EXTENSIONS.has(extname(f).toLowerCase())
);

console.log(`Папка: ${FOLDER}`);
console.log(`Исходных изображений: ${files.length}`);
console.log(`Параметры: max ${MAX_SIDE}px, WebP q${QUALITY}, оригиналы ${KEEP_ORIGINALS ? 'сохраняем' : 'удаляем'}`);
console.log('');

let converted = 0;
let skippedExisting = 0;
let deletedExisting = 0;
let failed = 0;
let bytesBefore = 0;
let bytesAfter = 0;
let i = 0;

for (const file of files) {
  const srcPath = join(FOLDER, file);
  const outPath = join(FOLDER, `${basename(file, extname(file))}.webp`);

  if (existsSync(outPath) && !FORCE) {
    skippedExisting++;
    bytesBefore += statSync(srcPath).size;
    bytesAfter += statSync(outPath).size;
    // WebP уже есть — но оригинал всё равно убираем. Иначе парсер на следующем
    // прогоне не найдёт свой кэш (<hash>.png), скачает фото заново, а git
    // закоммитит ~0,5 МБ на товар: за один парсинг так приехало 2035 PNG ≈ 1 ГБ.
    if (!KEEP_ORIGINALS) {
      try {
        unlinkSync(srcPath);
        deletedExisting++;
      } catch {
        /* уже удалён — не критично */
      }
    }
    continue;
  }

  try {
    const info = await sharp(srcPath)
      .resize({
        width: MAX_SIDE,
        height: MAX_SIDE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: QUALITY })
      .toFile(outPath);

    bytesBefore += statSync(srcPath).size;
    bytesAfter += info.size;
    converted++;

    if (!KEEP_ORIGINALS) {
      unlinkSync(srcPath);
    }
  } catch (error) {
    failed++;
    console.warn(`  ⚠️ ${file}: ${error.message}`);
  }

  i++;
  if (i % 200 === 0) console.log(`  ...обработано ${i}/${files.length}`);
}

const mb = (b) => `${(b / 1024 / 1024).toFixed(1)} МБ`;
console.log('');
console.log(
  `✅ Сжато: ${converted}, уже было: ${skippedExisting}` +
    ` (из них удалено оригиналов: ${deletedExisting}), ошибок: ${failed}`
);
console.log(`Объём: ${mb(bytesBefore)} → ${mb(bytesAfter)} (−${
  bytesBefore > 0 ? Math.round((1 - bytesAfter / bytesBefore) * 100) : 0
}%)`);

if (bytesAfter > 100 * 1024 * 1024) {
  console.warn('⚠️ Всё ещё больше 100 МБ — попробуйте: --max=500 --quality=75');
} else {
  console.log('👍 Объём подходит для git. Дальше:');
  console.log('   git add public/data/product_images');
  console.log('   git commit -m "data: фото товаров (webp)"');
  console.log('   git push origin fix/code-review-fixes');
}
