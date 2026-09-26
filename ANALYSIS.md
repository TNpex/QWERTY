# Анализ репозитория QWERTY (SaleTennis BI Analytics)

> Внутренний документ для работы над фичами. Дата анализа: 2026-09-24.
> Состояние: ✅ typecheck, ✅ lint, ✅ 123 теста, ✅ build — всё проходит.

## Что это

BI-дашборд для сети магазинов тенниса/падела **SaleTennis** (11 точек: СПб×2, Екб×5, Тюмень,
Уфа, Ижевск + склад). Аналитика остатков, продаж, перемещений и дозакупки — **полностью
в браузере** (данные никуда не отправляются). Деплой — Vercel + защита паролем (middleware.ts).

## Стек

- React 18 + TypeScript (strict) + Vite 6 + Tailwind CSS 4
- Recharts (графики), SheetJS xlsx 0.20.3 (с CDN — npm-версия уязвима), lucide-react (иконки)
- Vitest (123 unit-теста в `src/utils/*.test.ts`), ESLint 9, GitHub Actions CI (lint+typecheck+test+build)
- Python-парсер (Selenium + pandas) — `parser/saletennis_parser.py` (~821 строк),
  ежедневный запуск через GitHub Actions (`parse.yml`, cron 07:00 UTC)
- sharp — сжатие фото в WebP (~3520 картинок в `public/data/product_images/`)

## Архитектура данных

```
Python-парсер → public/data/*.csv|json → Vite public → браузер (fetch + parse) → React state
                                                        ↑ IndexedDB (загруженный вручную файл)
```

- `public/data/products.csv` — каталог, широкий формат (магазины = колонки). ~2200 артикулов.
- `public/data/sizes.csv` — остатки по размерам (длинный формат: Размер/Магазин/Количество).
- `public/data/changes.csv` — журнал парсера (продажи, новинки, «товар закончился»).
- `public/data/history/` — снимки + `manifest.json` (snapshots и sizeSnapshots).
- `public/data/hot-products.json` — 🔥 ходовые товары (минимум N шт. на магазин), редактируется без пересборки.
- `public/data/product-images.json` — резервная карта фото (webp → png → сайт → заглушка).

**Важные особенности данных:**
- Артикул НЕ уникален (цветовые варианты) — товары идентифицируются по ссылке; история сравнивается по артикулам.
- Явный «0» в колонке магазина = возит, но полка пуста; пустая ячейка = не возит (`notCarried`).
- Мусорные бренды чинятся автоматически («37078» → «7/6», «Не определен» → из названия).
- «375» → «37,5», «Без размера» → «—»; у струн/мячей размеры = единицы продажи (сет/банка/кор).

## Код (src/, ~8500 строк)

- `App.tsx` — 6 вкладок: dashboard, inventory, transfers, restock, sales, analytics + сайдбар.
- `context/DataContext.tsx` — единый стейт: данные (bundled/upload), история, журнал,
  фильтры (brand/category/gender/subtype), brandOverrides, IndexedDB-гидратация.
- `hooks/useAnalytics.ts` — мемоизированные хуки: useMetrics, useTransferRecommendations,
  useRestockRecommendations, useSalesReport, useSizeSalesReport, useHotArticles, useFilteredData.
- `utils/analyticsCore.ts` ⭐ — константы (FILL_TO=2, пороги избытка СПб≥4/прочие≥3,
  TRANSFER_CAP=3, POPULAR_SHOE_SIZES, пороги OOS 15/30%) и вся логика: метрики,
  перемещения (донор→получатель, маршруты, приоритеты), дозакупка, переизбыток.
- `utils/productMeta.ts` ⭐ — пол/возраст по названию, подтипы одежды, нормативы размеров
  (таблицы жен/муж/дет одежда + обувь; default 4).
- `utils/historyCore.ts` — снимки, diff-аналитика продаж между снимками, changes.csv, продажи по размерам.
- `utils/bundledData.ts` — слияние products.csv + sizes.csv → ParsedData (встроенные данные).
- `utils/xlsxParser.ts` — парсер загружаемых XLSX/CSV (длинный и широкий форматы).
- `utils/storeGroups.ts` — города, склад, маршруты (warehouse/same-city/intercity/spb-expensive),
  порядок магазинов (СПб→Екб→Тюмень→Уфа→Ижевск, склад последний, синий 📦), короткие подписи (СПБ-Я…).
- `utils/csv.ts`, `sizes.ts`, `storage.ts` (IndexedDB), `images.ts` (каскад фото), `overrides.ts` (правки брендов).
- `components/` — FilterBar (глобальные фильтры), Dashboard (KPI), InventoryTable,
  ProductCardModal, SalesHistory, TransferRecommendations, RestockRecommendations, FileUpload, Charts.
- `middleware.ts` (корень) — пароль через SITE_PASSWORD, /login, httpOnly-cookie 30 дней, fail-closed.

## Бизнес-правила (кратко)

- **Перемещения**: донор — избыток >2 (>3 в СПб), оставляет 2 (3 в СПб); получатель — 0 или 1,
  заполняется до 2; сначала свой город; маршрут из СПб «💸 дорого» скрыт по умолчанию;
  склад = альтернатива (optionGroup), приоритет не отдаётся; high = ноль + ходовой размер.
- **Дозакупка**: нормативы ПО ВСЕЙ СЕТИ (включая склад) на размер; 🔥 ходовые — минимум N на
  каждый розничный магазин; urgency: critical (нет нигде) / high (<50% покрытия) / medium.
- **Продажи**: журнал парсера + diff снимков (по артикулам) + продажи по размерам (со 2-го size-снимка).
- **Заявка в XLSX**: построчная номенклатура (артикул, размер, есть/норматив/заказать, цена, сумма) с учётом фильтров.

## Дорожная карта (из README, не сделано)

- [ ] Бэкенд на Supabase: автопарсинг по расписанию вместо ручного snapshot (частично есть parse.yml)
- [ ] Прогноз дней до исчерпания по накопленной истории продаж
- [ ] Экспорт перемещений в XLSX; графики динамики доступности
- [ ] Аутентификация и права доступа по магазинам

## Рабочие замечания

- Ветка по умолчанию: `analytics-of-product-availability-by-stores-e92c9`; есть `fix/code-review-fixes`.
- В build есть предупреждение о чанках >500 kB (xlsx 500 kB, index 707 kB) — при желании code-split.
- Тесты покрывают только utils; компонентов нет. Новые фичи в utils → добавлять тесты (стиль проекта).
- Русская локализация UI и комментариев — стиль проекта, соблюдать.
- CI на каждый push: lint + typecheck + test + build — всё должно проходить перед коммитом.

## Реализовано 2026-09-26 (ветка fix/sidebar-menu-and-service-panel)

- Сайдбар: меню без цветных эмодзи (только lucide-иконки), «Мой магазин» — только
  названия; панель «Настройки и данные» в потоке flex-колонки (не перекрывает меню),
  секции «Данные / Настройки товаров / О данных» с единообразными строками-кнопками.
- Название сайта: «SaleTennis Analytics» (index.html, document.title, FileUpload, сайдбар).
- Тёмная тема: сплошные фоны вместо полупрозрачных белых (карточка товара, «Продажи»);
  Recharts темизирован (currentColor для осей/сетки, CSS-переменные --tip-* для тултипов);
  короткие имена точек на осях/легендах, полные — в тултипах.
- insights.ts (+12 тестов): продажи по (товар × магазин) из снимков, runwayDays/
  runwayLevel, abcClasses (A=80%/B=95%/C), deadStock (≥60 дней), stockValueByStore,
  availabilityTrend, sizeProfile.
- UI: вкладка «Матрица» (/matrix, StockMatrix.tsx); колонка «Дней запаса» в инвентаре и
  RunwayBadge в карточке товара; «Утро магазина» (StoreDigest.tsx) на Обзоре при
  выбранной точке; в «Аналитике» — AvailabilityTrendChart, StockValueChart,
  AbcCoverageCard, DeadStockCard (+XLSX), SizeProfileCard; XLSX-экспорт перемещений;
  code-splitting вкладок (lazy + Suspense, чанки по разделам).
- Новый магазин «Екатеринбург (Полевской тракт)»: ключи матчинга в парсере
  (STORES_FULL), короткая метка ЕКБ-ПТ (не конфликтует с ЕКБ-П «Парина»), cityHint
  в карточке товара убирает дубли города в подписях строк.
