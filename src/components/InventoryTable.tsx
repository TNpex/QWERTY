import { useCallback, useState, useMemo, useEffect, useRef } from 'react';
import {
  Search,
  ChevronDown,
  ChevronUp,
  PackageSearch,
  Flame,
  ExternalLink,
  LayoutGrid,
  List,
} from 'lucide-react';
import { useFilteredData, useIsHot } from '../hooks/useAnalytics';
import { useStoreScope } from '../hooks/useStoreScope';
import { useData } from '../context/DataContext';
import {
  countAvailability,
  matchesAvailability,
  stockStatus,
  STOCK_STATUS_HINTS,
  type AvailabilityFilter,
} from '../utils/availability';
import { newProductArticles, NEW_PRODUCT_DAYS } from '../utils/newProducts';
import type { Product } from '../types';
import { ALL_SCOPE } from '../utils/storeScope';
import { compareSizes } from '../utils/sizes';
import { isWarehouse, shortStoreLabel } from '../utils/storeGroups';
import { sportOf, productSettingsKey } from '../utils/sport';
import { ProductCardModal, ProductImage } from './ProductCardModal';
import { useProductRoute } from '../utils/router';
import { SportBadge } from './SportBadge';
import type { InventoryItem } from '../types';

// Единые пороги цветов (совпадают с легендой внизу таблицы)
const SIZE_LOW = 2; // ≤ 2 шт одного размера в магазине — «мало»
const STORE_LOW = 5; // < 5 шт суммарно в магазине — «мало»
const PAGE_SIZES = [50, 100, 250]; // варианты «на странице»
const DEFAULT_PAGE_SIZE = 50;
const GHOST_LIMIT = 60; // сколько «убранных с сайта» товаров показывать списком
const VIEW_MODE_KEY = 'st-inventory-view';
const SORT_KEY = 'st-inventory-sort';

type ViewMode = 'table' | 'cards';

/** Сортировка списка товаров (выбор запоминается в браузере) */
export type InventorySort =
  | 'new'
  | 'name-asc'
  | 'name-desc'
  | 'brand'
  | 'stock-desc'
  | 'stock-asc'
  | 'discount';

const SORT_LABELS: Record<InventorySort, string> = {
  new: '🆕 Сначала новинки, затем А→Я',
  'name-asc': 'Название (А→Я)',
  'name-desc': 'Название (Я→А)',
  brand: 'Бренд, затем название',
  'stock-desc': 'Остаток: больше сначала',
  'stock-asc': 'Остаток: меньше сначала',
  discount: '💰 По размеру скидки',
};

function loadSort(): InventorySort {
  try {
    const saved = localStorage.getItem(SORT_KEY) as InventorySort | null;
    return saved && saved in SORT_LABELS ? saved : 'new';
  } catch {
    return 'new';
  }
}

/** Номера страниц для пагинации: 1 … 4 [5] 6 … 22 */
function pageList(current: number, total: number): (number | '…')[] {
  const nums = new Set<number>([1, total]);
  for (let n = current - 2; n <= current + 2; n++) {
    if (n >= 1 && n <= total) nums.add(n);
  }
  const sorted = [...nums].sort((a, b) => a - b);
  const result: (number | '…')[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) result.push('…');
    result.push(n);
  });
  return result;
}

function sizeCellClass(qty: number): string {
  if (qty === 0) return 'bg-red-100 text-red-700 font-bold';
  if (qty <= SIZE_LOW) return 'bg-amber-100 text-amber-700 font-semibold';
  return 'bg-emerald-100 text-emerald-700';
}

function storeCellClass(qty: number): string {
  if (qty === 0) return 'bg-red-100 text-red-700';
  if (qty < STORE_LOW) return 'bg-amber-100 text-amber-600';
  return 'bg-emerald-100 text-emerald-700';
}

const NOT_CARRIED_CLASS = 'bg-gray-50 text-gray-400';

export function InventoryTable() {
  // Данные уже отфильтрованы глобальной панелью (бренд / категория / пол / подтип / спорт)
  const data = useFilteredData();
  const isHot = useIsHot();
  const { settings, delistedProducts, filters, parserChanges } = useData();
  // Магазин — ОБЩАЯ область для всех вкладок (живёт в адресе ?scope=…):
  // выбрали точку в «Обзоре» → «Инвентарь» открыт на ней же, и наоборот
  const { storeId: scopeStoreId, setScope } = useStoreScope();
  const selectedStore = scopeStoreId ?? 'all';
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [availability, setAvailability] = useState<AvailabilityFilter>('all');
  const [sort, setSort] = useState<InventorySort>(loadSort);
  const [onlyNew, setOnlyNew] = useState(false);
  const [onlyDiscount, setOnlyDiscount] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      return localStorage.getItem(VIEW_MODE_KEY) === 'cards' ? 'cards' : 'table';
    } catch {
      return 'table';
    }
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  // Карточка товара — часть адреса (?product=<id>): работает кнопка «Назад»,
  // ссылку на товар можно скопировать, перезагрузка открывает ту же карточку
  const {
    productId: selectedProduct,
    openProduct: openProductCard,
    closeProduct: closeProductCard,
  } = useProductRoute('inventory');

  // Выбор режима (таблица/карточки) и сортировки запоминается в браузере
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_KEY, viewMode);
    } catch {
      /* приватный режим */
    }
  }, [viewMode]);

  useEffect(() => {
    try {
      localStorage.setItem(SORT_KEY, sort);
    } catch {
      /* приватный режим */
    }
  }, [sort]);

  /**
   * 🆕 Новинки — товары, впервые появившиеся в каталоге за последние
   * NEW_PRODUCT_DAYS дней от даты снимка (по журналу парсера changes.csv).
   * Первый парсинг журнала считается базовым срезом и в новинки не попадает.
   */
  const newArticles = useMemo(
    () => newProductArticles(parserChanges, data?.asOf ?? data?.uploadedAt),
    [parserChanges, data]
  );
  const isNew = useCallback(
    (product: Product) => newArticles.has((product.article ?? '').trim().toLowerCase()),
    [newArticles]
  );

  const stores = useMemo(() => data?.stores ?? [], [data]);
  const products = useMemo(() => data?.products ?? [], [data]);
  const inventory = useMemo(() => data?.inventory ?? [], [data]);

  // ВАЖНО: все хуки вызываются ДО условного return (правила хуков React)
  const displayStores = useMemo(
    () => (selectedStore === 'all' ? stores : stores.filter((s) => s.id === selectedStore)),
    [stores, selectedStore]
  );

  // Индексы O(N) вместо inventory.find() на каждую ячейку при рендере
  const indexes = useMemo(() => {
    const byKey = new Map<string, InventoryItem>(); // pid|sid|size → item
    const storeTotals = new Map<string, { total: number; carried: number }>(); // pid|sid
    const productTotals = new Map<string, number>(); // pid → всего единиц
    const sizesByProduct = new Map<string, Set<string>>(); // pid → размеры (только возящие)

    for (const item of inventory) {
      if (item.notCarried) continue;
      byKey.set(`${item.productId}|${item.storeId}|${item.size}`, item);

      const storeKey = `${item.productId}|${item.storeId}`;
      const agg = storeTotals.get(storeKey) ?? { total: 0, carried: 0 };
      agg.total += item.quantity;
      agg.carried++;
      storeTotals.set(storeKey, agg);

      productTotals.set(item.productId, (productTotals.get(item.productId) ?? 0) + item.quantity);

      let sizes = sizesByProduct.get(item.productId);
      if (!sizes) {
        sizes = new Set();
        sizesByProduct.set(item.productId, sizes);
      }
      sizes.add(item.size);
    }
    return { byKey, storeTotals, productTotals, sizesByProduct };
  }, [inventory]);

  const excludedKeys = settings.excludedProducts;

  /**
   * Статус наличия товара в текущей области:
   * soldOut — нет ни одной штуки в сети, missing — нет только в выбранном
   * магазине (на других точках есть), inStock — есть.
   */
  const statusOf = useCallback(
    (productId: string) => {
      const network = indexes.productTotals.get(productId) ?? 0;
      const store =
        selectedStore === 'all'
          ? null
          : indexes.storeTotals.get(`${productId}|${selectedStore}`)?.total ?? 0;
      return { status: stockStatus(network, store), network, store };
    },
    [indexes, selectedStore]
  );

  const filteredProducts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const storeScoped = selectedStore !== 'all';
    return products.filter((p) => {
      const matchesSearch =
        !term ||
        p.name.toLowerCase().includes(term) ||
        p.brand.toLowerCase().includes(term) ||
        (p.article ?? '').toLowerCase().includes(term);
      // Выбран магазин — показываем только ЕГО инвентарь (товары, которые он возит)
      if (storeScoped && !indexes.storeTotals.has(`${p.id}|${selectedStore}`)) return false;
      if (onlyNew && !isNew(p)) return false;
      if (onlyDiscount && !(p.discountPercent && p.discountPercent > 0)) return false;
      return matchesSearch && matchesAvailability(statusOf(p.id).status, availability);
    });
  }, [products, searchTerm, availability, indexes, selectedStore, statusOf, onlyNew, onlyDiscount, isNew]);

  /** Отсортированный список (сортировка — до пагинации) */
  const sortedProducts = useMemo(() => {
    const totalOf = (p: Product) =>
      selectedStore === 'all'
        ? indexes.productTotals.get(p.id) ?? 0
        : indexes.storeTotals.get(`${p.id}|${selectedStore}`)?.total ?? 0;
    const byName = (a: Product, b: Product) => a.name.localeCompare(b.name, 'ru');
    const list = [...filteredProducts];
    switch (sort) {
      case 'name-asc':
        return list.sort(byName);
      case 'name-desc':
        return list.sort((a, b) => byName(b, a));
      case 'brand':
        return list.sort((a, b) => a.brand.localeCompare(b.brand, 'ru') || byName(a, b));
      case 'stock-desc':
        return list.sort((a, b) => totalOf(b) - totalOf(a) || byName(a, b));
      case 'stock-asc':
        return list.sort((a, b) => totalOf(a) - totalOf(b) || byName(a, b));
      case 'discount':
        return list.sort(
          (a, b) => (b.discountPercent ?? 0) - (a.discountPercent ?? 0) || byName(a, b)
        );
      case 'new':
      default:
        // новинки первыми, внутри групп — по названию (чтобы не «в разнобой»)
        return list.sort((a, b) => Number(isNew(b)) - Number(isNew(a)) || byName(a, b));
    }
  }, [filteredProducts, sort, selectedStore, indexes, isNew]);

  // Товары, убранные с сайта (из истории снимков): показываются в «Все» и
  // «Распроданные»; поиск и глобальные фильтры к ним тоже применяются.
  const filteredDelisted = useMemo(() => {
    if (
      availability === 'inStock' ||
      availability === 'missing' ||
      selectedStore !== 'all' ||
      delistedProducts.length === 0
    ) {
      return [];
    }
    const term = searchTerm.trim().toLowerCase();
    return delistedProducts.filter((g) => {
      const matchesSearch =
        !term ||
        g.name.toLowerCase().includes(term) ||
        g.brand.toLowerCase().includes(term) ||
        g.article.toLowerCase().includes(term);
      const matchesFilters =
        (filters.brand === 'all' || g.brand === filters.brand) &&
        (filters.category === 'all' || g.category === filters.category) &&
        (filters.sport === 'all' ||
          sportOf(
            { article: g.article, link: g.link, name: g.name, category: g.category },
            settings.sportOverrides
          ) === filters.sport);
      return matchesSearch && matchesFilters;
    });
  }, [delistedProducts, searchTerm, availability, filters, settings, selectedStore]);

  // Счётчики наличия — по всей сети или по выбранному магазину
  const scopedBase = useMemo(() => {
    const storeScoped = selectedStore !== 'all';
    const list = storeScoped
      ? products.filter((p) => indexes.storeTotals.has(`${p.id}|${selectedStore}`))
      : products;
    return countAvailability(list.map((p) => statusOf(p.id).status));
  }, [products, indexes, selectedStore, statusOf]);
  const selectedStoreName = stores.find((st) => st.id === selectedStore)?.name ?? '';
  /** Сколько товаров со скидкой в текущей области (для подписи переключателя) */
  const discountCount = useMemo(() => {
    const storeScoped = selectedStore !== 'all';
    return products.filter(
      (p) =>
        (p.discountPercent ?? 0) > 0 &&
        (!storeScoped || indexes.storeTotals.has(`${p.id}|${selectedStore}`))
    ).length;
  }, [products, indexes, selectedStore]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / pageSize));
  const currentPage = Math.min(page, totalPages);

  const visibleProducts = useMemo(
    () => sortedProducts.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [sortedProducts, currentPage, pageSize]
  );

  const listTopRef = useRef<HTMLDivElement>(null);
  const goPage = (n: number) => {
    setPage(Math.max(1, Math.min(n, totalPages)));
    listTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const resetPage = () => setPage(1);

  if (!data) return null;

  const uploadedAtText = data.uploadedAt
    ? new Date(data.uploadedAt).toLocaleString('ru-RU')
    : '—';

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input
            type="text"
            placeholder="Поиск по названию, бренду или артикулу..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              resetPage();
            }}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
          />
        </div>
        <div className="flex gap-3 flex-wrap">
          <select
            value={selectedStore}
            onChange={(e) => {
              const id = e.target.value;
              const name = id === 'all' ? ALL_SCOPE : stores.find((st) => st.id === id)?.name ?? '';
              // область общая для всех вкладок и сохраняется в адресе страницы
              setScope(name || ALL_SCOPE);
              setPage(1);
            }}
            className="px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm appearance-none bg-white cursor-pointer"
            title="Магазин — общая область для «Обзора» и «Инвентаря»: выбор сохраняется в адресе страницы и переносится между вкладками"
          >
            <option value="all">🌐 Все магазины (вся сеть)</option>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {isWarehouse(store.name) ? '📦 ' : ''}
                {store.name}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as InventorySort);
              setPage(1);
            }}
            className="px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm appearance-none bg-white cursor-pointer"
            title="Порядок товаров в списке (выбор запоминается)"
          >
            {(Object.keys(SORT_LABELS) as InventorySort[]).map((mode) => (
              <option key={mode} value={mode}>
                Сортировка: {SORT_LABELS[mode]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="text-xs text-gray-500">
          Найдено товаров:{' '}
          <span className="font-semibold text-gray-700">
            {filteredProducts.length + filteredDelisted.length}
          </span>{' '}
          из{' '}
          {selectedStore === 'all'
            ? products.length + delistedProducts.length
            : `${scopedBase.all} (столько возит выбранный магазин)`}
          {filteredDelisted.length > 0 && (
            <span className="text-gray-400"> (вкл. {filteredDelisted.length} убранных с сайта)</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Наличие: все / в наличии / распроданные */}
          <div className="inline-flex rounded-full border border-gray-200 overflow-hidden text-xs">
            {(
              [
                [
                  'all',
                  `Все (${scopedBase.all + (selectedStore === 'all' ? delistedProducts.length : 0)})`,
                  'bg-gray-700',
                ],
                ['inStock', `В наличии (${scopedBase.inStock})`, 'bg-emerald-500'],
                ...(selectedStore === 'all'
                  ? []
                  : [[
                      'missing',
                      `Отсутствует в магазине (${scopedBase.missing})`,
                      'bg-amber-500',
                    ] as [AvailabilityFilter, string, string]]),
                [
                  'soldOut',
                  `Распроданные (${
                    scopedBase.soldOut + (selectedStore === 'all' ? delistedProducts.length : 0)
                  })`,
                  'bg-red-500',
                ],
              ] as [AvailabilityFilter, string, string][]
            ).map(([mode, label, activeBg]) => (
              <button
                key={mode}
                onClick={() => {
                  setAvailability(mode);
                  resetPage();
                }}
                className={`px-3 py-1.5 font-medium transition-colors ${
                  availability === mode
                    ? `${activeBg} text-white`
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {mode === 'soldOut' && <Flame className="w-3 h-3 inline mr-1" />}
                {mode === 'missing' && <PackageSearch className="w-3 h-3 inline mr-1" />}
                {label}
              </button>
            ))}
          </div>
          {/* Новинки и скидки — быстрые переключатели */}
          <div className="inline-flex rounded-full border border-gray-200 overflow-hidden text-xs">
            <button
              onClick={() => {
                setOnlyNew((v) => !v);
                resetPage();
              }}
              className={`px-3 py-1.5 font-medium transition-colors ${
                onlyNew ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 hover:bg-emerald-50'
              }`}
              title={`Товары, впервые появившиеся в каталоге за последние ${NEW_PRODUCT_DAYS} дней (по журналу парсера). Первый парсинг журнала считается базовым срезом и в новинки не попадает.`}
            >
              🆕 Новинки{newArticles.size > 0 ? ` (${newArticles.size})` : ''}
            </button>
            <button
              onClick={() => {
                setOnlyDiscount((v) => !v);
                resetPage();
              }}
              className={`px-3 py-1.5 font-medium transition-colors border-l border-gray-200 ${
                onlyDiscount ? 'bg-rose-600 text-white' : 'bg-white text-gray-600 hover:bg-rose-50'
              }`}
              title="Товары из раздела «Распродажа» saletennis.com: цена в каталоге уже указана со скидкой, рядом показана старая цена и процент"
            >
              💰 Со скидкой{discountCount > 0 ? ` (${discountCount})` : ''}
            </button>
          </div>
          {/* Вид: таблица / карточки */}
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
            <button
              onClick={() => setViewMode('table')}
              className={`px-2.5 py-1.5 ${viewMode === 'table' ? 'bg-blue-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
              title="Режим таблицы"
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('cards')}
              className={`px-2.5 py-1.5 ${viewMode === 'cards' ? 'bg-blue-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
              title="Режим маленьких карточек (клик — карточка товара с настройками)"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-2" ref={listTopRef}>
        {viewMode === 'cards' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            {visibleProducts.map((product) => {
              const { status, network } = statusOf(product.id);
              const totalStock = selectedStore === 'all'
                ? network
                : indexes.storeTotals.get(`${product.id}|${selectedStore}`)?.total ?? 0;
              const isSoldOut = status === 'soldOut';
              const isMissing = status === 'missing';
              const sport = sportOf(product, settings.sportOverrides);
              const excluded = Boolean(excludedKeys[productSettingsKey(product)]);
              const hot = isHot(product);
              const supplied = settings.suppliedProducts[productSettingsKey(product)] === true;
              return (
                <button
                  key={product.id}
                  onClick={() => openProductCard(product.id)}
                  className="group text-left bg-white border border-gray-100 rounded-xl overflow-hidden hover:border-blue-300 hover:shadow-md transition-all flex flex-col"
                  title="Открыть карточку товара (наличие, ориентация, исключения)"
                >
                  <div className="relative h-32 bg-gradient-to-br from-gray-50 to-blue-50 flex items-center justify-center overflow-hidden">
                    <ProductImage product={product} alt={product.name} />
                    {isSoldOut && (
                      <span
                        className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-red-500 text-white text-[9px] font-bold uppercase tracking-wide"
                        title={STOCK_STATUS_HINTS.soldOut}
                      >
                        Распродано
                      </span>
                    )}
                    {isMissing && (
                      <span
                        className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-amber-500 text-white text-[9px] font-bold uppercase tracking-wide"
                        title={`${STOCK_STATUS_HINTS.missing} — в сети ${network} шт.`}
                      >
                        Отсутствует
                      </span>
                    )}
                    {excluded && (
                      <span
                        className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-gray-700 text-white text-[10px] font-bold"
                        title="Исключён из рекомендаций (услуга / не товар)"
                      >
                        ⛔
                      </span>
                    )}
                    {hot && (
                      <span
                        className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 text-[10px] font-bold"
                        title="Ходовой товар — приоритет в перемещениях"
                      >
                        🔥
                      </span>
                    )}
                    {supplied && (
                      <span
                        className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 text-[9px] font-bold"
                        title="Поставляется — участвует в дозакупке"
                      >
                        Поставка
                      </span>
                    )}
                  </div>
                  <div className="p-2.5 flex-1 flex flex-col gap-1">
                    <div
                      className="text-[11px] leading-tight text-gray-800 line-clamp-2 group-hover:text-blue-700"
                      title={product.name}
                    >
                      {product.name}
                    </div>
                    <div className="text-[10px] text-gray-400 truncate">
                      {product.brand}
                      {product.article ? ` · ${product.article}` : ''}
                    </div>
                    {(isNew(product) || (product.discountPercent ?? 0) > 0) && (
                      <div className="flex items-center gap-1 flex-wrap">
                        {isNew(product) && (
                          <span
                            className="px-1 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[9px] font-bold"
                            title={`🆕 Новинка: впервые в каталоге за последние ${NEW_PRODUCT_DAYS} дней (по журналу парсера)`}
                          >
                            🆕 Новинка
                          </span>
                        )}
                        {(product.discountPercent ?? 0) > 0 && (
                          <span
                            className="px-1 py-0.5 rounded bg-rose-100 text-rose-700 text-[9px] font-bold"
                            title={
                              product.oldPrice
                                ? `Скидка ${product.discountPercent}%: старая цена ${product.oldPrice.toLocaleString('ru-RU')} ₽, сейчас ${product.price.toLocaleString('ru-RU')} ₽ (раздел «Распродажа» saletennis.com)`
                                : `Скидка ${product.discountPercent}% (раздел «Распродажа» saletennis.com)`
                            }
                          >
                            −{product.discountPercent}%
                          </span>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-1 mt-auto">
                      <SportBadge sport={sport} />
                      <span
                        className={`ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          totalStock === 0
                            ? 'bg-red-100 text-red-700'
                            : totalStock < 10
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {totalStock} шт.
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
            {currentPage === totalPages && filteredDelisted.slice(0, GHOST_LIMIT).map((g) => {
              const sport = sportOf(
                { article: g.article, link: g.link, name: g.name, category: g.category },
                settings.sportOverrides
              );
              return (
                <div
                  key={`delisted-${g.key}`}
                  className="text-left bg-gray-50 border border-dashed border-gray-300 rounded-xl overflow-hidden flex flex-col opacity-90"
                  title="Товар убран с сайта — считается распроданным"
                >
                  <div className="relative h-32 bg-gray-100 flex items-center justify-center text-gray-300">
                    <PackageSearch className="w-10 h-10" />
                    <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-gray-500 text-white text-[9px] font-bold uppercase">
                      Убран с сайта
                    </span>
                  </div>
                  <div className="p-2.5 flex-1 flex flex-col gap-1">
                    {g.link ? (
                      <a
                        href={g.link}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] leading-tight text-gray-600 line-clamp-2 hover:text-blue-600 hover:underline"
                        title={g.name}
                      >
                        {g.name}
                      </a>
                    ) : (
                      <div className="text-[11px] leading-tight text-gray-600 line-clamp-2" title={g.name}>
                        {g.name}
                      </div>
                    )}
                    <div className="flex items-center gap-1 mt-auto">
                      <SportBadge sport={sport} />
                      <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                        0 шт.
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-400 truncate">
                      до {g.lastSeen.slice(0, 10)} · было {g.lastTotal} шт.
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
        <>
        {/* Table Header */}
        <div
          className="grid gap-2 px-4 py-2 bg-gradient-to-r from-green-50 to-blue-50 rounded-lg text-xs font-semibold text-gray-600 uppercase tracking-wide border border-green-100"
          style={{ gridTemplateColumns: `2.6fr 0.7fr 0.8fr ${Math.max(displayStores.length, 1)}fr` }}
        >
          <div>🎾 Товар</div>
          <div>Бренд</div>
          <div className="text-center">
            {selectedStore === 'all' || !selectedStoreName
              ? 'Общий остаток'
              : `Остаток · ${shortStoreLabel(selectedStoreName)}`}
          </div>
          <div className="text-center">По магазинам</div>
        </div>

        {/* Product Rows */}
        {visibleProducts.map((product) => {
          const isExpanded = expandedProduct === product.id;
          const { status, network } = statusOf(product.id);
          const totalStock = selectedStore === 'all'
            ? network
            : indexes.storeTotals.get(`${product.id}|${selectedStore}`)?.total ?? 0;
          const isSoldOut = status === 'soldOut';
          const isMissing = status === 'missing';
          const sizes = [...(indexes.sizesByProduct.get(product.id) ?? [])].sort(compareSizes);

          return (
            <div
              key={product.id}
              className="border border-gray-100 rounded-lg overflow-hidden hover:border-blue-200 transition-colors"
            >
              {/* Main Row */}
              <div
                className="grid gap-2 px-4 py-3 items-center cursor-pointer hover:bg-blue-50/30 transition-colors"
                style={{ gridTemplateColumns: `2.6fr 0.7fr 0.8fr ${Math.max(displayStores.length, 1)}fr` }}
                onClick={() => setExpandedProduct(isExpanded ? null : product.id)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-sm leading-snug" title={product.name}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openProductCard(product.id);
                        }}
                        className="font-medium text-gray-800 hover:text-blue-600 hover:underline text-left break-words line-clamp-2"
                      >
                        {product.name}
                      </button>
                      {product.link && (
                        <a
                          href={product.link}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="ml-1.5 inline-block text-gray-400 hover:text-blue-500 align-middle"
                          title="Открыть на saletennis.com"
                        >
                          <ExternalLink className="w-3 h-3 inline" />
                        </a>
                      )}
                      <span className="ml-1.5 inline-block align-middle">
                        <SportBadge sport={sportOf(product, settings.sportOverrides)} />
                      </span>
                      {excludedKeys[productSettingsKey(product)] && (
                        <span
                          className="ml-1 inline-block align-middle text-[11px]"
                          title="Исключён из рекомендаций (услуга / не товар)"
                        >
                          ⛔
                        </span>
                      )}
                      {isHot(product) && (
                        <span
                          className="ml-1.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 text-[10px] font-bold uppercase tracking-wide align-middle"
                          title="Ходовой товар — на особом контроле (индивидуальный норматив запаса)"
                        >
                          🔥 Топ
                        </span>
                      )}
                      {isSoldOut && (
                        <span
                          className="ml-1.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold uppercase tracking-wide align-middle"
                          title={STOCK_STATUS_HINTS.soldOut}
                        >
                          <Flame className="w-2.5 h-2.5" /> Распродано
                        </span>
                      )}
                      {isMissing && (
                        <span
                          className="ml-1.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-bold uppercase tracking-wide align-middle"
                          title={`${STOCK_STATUS_HINTS.missing} — в сети ${network} шт.`}
                        >
                          <PackageSearch className="w-2.5 h-2.5" /> Отсутствует
                        </span>
                      )}
                      {isNew(product) && (
                        <span
                          className="ml-1.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-wide align-middle"
                          title={`🆕 Новинка: впервые в каталоге за последние ${NEW_PRODUCT_DAYS} дней (по журналу парсера)`}
                        >
                          🆕 Новинка
                        </span>
                      )}
                      {(product.discountPercent ?? 0) > 0 && (
                        <span
                          className="ml-1.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] font-bold align-middle"
                          title={
                            product.oldPrice
                              ? `Скидка ${product.discountPercent}%: старая цена ${product.oldPrice.toLocaleString('ru-RU')} ₽, сейчас ${product.price.toLocaleString('ru-RU')} ₽`
                              : `Скидка ${product.discountPercent}%`
                          }
                        >
                          −{product.discountPercent}%
                          {product.oldPrice ? (
                            <span className="line-through opacity-60 ml-1 font-normal">
                              {product.oldPrice.toLocaleString('ru-RU')} ₽
                            </span>
                          ) : null}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">
                      {product.category}
                      {product.article ? ` · ${product.article}` : ''}
                    </div>
                  </div>
                </div>
                <div className="text-sm text-gray-600 truncate">{product.brand}</div>
                <div className="text-center">
                  <span
                    className={`inline-flex items-center justify-center min-w-[2rem] h-7 px-2 rounded-full text-xs ${
                      totalStock === 0
                        ? 'bg-red-100 text-red-700'
                        : totalStock < 10
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-emerald-100 text-emerald-700'
                    }`}
                  >
                    {totalStock} шт.
                  </span>
                </div>
                <div className="flex gap-2 justify-center flex-wrap">
                  {displayStores.map((store) => {
                    const warehouse = isWarehouse(store.name);
                    const agg = indexes.storeTotals.get(`${product.id}|${store.id}`);
                    return (
                      <div key={store.id} className="text-center" title={`${store.name}${agg ? `: ${agg.total} шт.` : ': не возит'}`}>
                        {/* Короткая подпись магазина — видна при любой прокрутке */}
                        <div
                          className={`text-[9px] leading-none mb-0.5 font-bold tracking-tight ${
                            warehouse ? 'text-blue-600' : 'text-gray-400'
                          }`}
                        >
                          {warehouse ? '📦' : ''}
                          {shortStoreLabel(store.name)}
                        </div>
                        {agg ? (
                          <span
                            className={`inline-flex items-center justify-center min-w-[2rem] h-7 px-2 rounded text-xs font-medium ${storeCellClass(agg.total)}${
                              warehouse ? ' ring-1 ring-blue-400' : ''
                            }`}
                          >
                            {agg.total}
                          </span>
                        ) : (
                          <span
                            className={`inline-flex items-center justify-center min-w-[2rem] h-7 px-2 rounded text-xs font-medium ${NOT_CARRIED_CLASS}`}
                          >
                            —
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Expanded Detail */}
              {isExpanded && (
                <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-3">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr>
                          <th className="text-left py-2 px-2 text-gray-500 font-medium">Размер</th>
                          {displayStores.map((store) => (
                            <th
                              key={store.id}
                              className={`text-center py-2 px-1 font-medium whitespace-nowrap ${
                                isWarehouse(store.name)
                                  ? 'text-blue-700 bg-blue-50 rounded'
                                  : 'text-gray-500'
                              }`}
                              title={store.name}
                            >
                              {isWarehouse(store.name) ? '📦 ' : ''}
                              {shortStoreLabel(store.name)}
                            </th>
                          ))}
                          <th className="text-center py-2 px-2 text-gray-500 font-medium">Итого</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sizes.map((size) => {
                          let rowTotal = 0;
                          const cells = displayStores.map((store) => {
                            const item = indexes.byKey.get(
                              `${product.id}|${store.id}|${size}`
                            );
                            if (!item) {
                              return (
                                <td key={store.id} className="text-center py-2 px-2">
                                  <span
                                    className={`inline-flex items-center justify-center w-8 h-6 rounded text-xs ${NOT_CARRIED_CLASS}`}
                                    title="Магазин не возит эту позицию"
                                  >
                                    —
                                  </span>
                                </td>
                              );
                            }
                            rowTotal += item.quantity;
                            return (
                              <td key={store.id} className="text-center py-2 px-2">
                                <span
                                  className={`inline-flex items-center justify-center w-8 h-6 rounded text-xs ${sizeCellClass(item.quantity)}`}
                                >
                                  {item.quantity}
                                </span>
                              </td>
                            );
                          });
                          return (
                            <tr key={size} className="border-t border-gray-100">
                              <td className="py-2 px-2 font-medium text-gray-700">{size}</td>
                              {cells}
                              <td className="text-center py-2 px-2 font-semibold text-gray-700">
                                {rowTotal}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-2 text-xs text-gray-500">
                    {product.price > 0 && <>Цена: {product.price.toLocaleString('ru-RU')} ₽ | </>}
                    Обновлено: {uploadedAtText}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {currentPage === totalPages &&
          availability !== 'inStock' &&
          availability !== 'missing' &&
          filteredDelisted.slice(0, GHOST_LIMIT).map((g) => {
            const sport = sportOf(
              { article: g.article, link: g.link, name: g.name, category: g.category },
              settings.sportOverrides
            );
            return (
              <div
                key={`delisted-${g.key}`}
                className="grid gap-2 px-4 py-3 items-center bg-gray-50/70 border border-dashed border-gray-300 rounded-lg"
                style={{
                  gridTemplateColumns: `2.6fr 0.7fr 0.8fr ${Math.max(displayStores.length, 1)}fr`,
                }}
              >
                <div className="min-w-0">
                  <div className="text-sm text-gray-500 line-clamp-1" title={g.name}>
                    {g.link ? (
                      <a
                        href={g.link}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-blue-600 hover:underline"
                      >
                        {g.name}
                      </a>
                    ) : (
                      g.name
                    )}
                    <span className="ml-1.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 text-[10px] font-bold uppercase align-middle">
                      Убран с сайта
                    </span>
                    <span className="ml-1.5 inline-block align-middle">
                      <SportBadge sport={sport} />
                    </span>
                  </div>
                  <div className="text-xs text-gray-400">
                    {g.category}
                    {g.article ? ` · ${g.article}` : ''} · последний раз в наличии:{' '}
                    {g.lastSeen.slice(0, 10)} ({g.lastTotal} шт.)
                  </div>
                </div>
                <div className="text-sm text-gray-400 truncate">{g.brand}</div>
                <div className="text-center">
                  <span className="inline-flex items-center justify-center min-w-[2rem] h-7 px-2 rounded-full text-xs bg-red-100 text-red-700">
                    0 шт.
                  </span>
                </div>
                <div />
              </div>
            );
          })}
        </>
        )}

        {filteredProducts.length + filteredDelisted.length === 0 && (
          <div className="text-center py-10 text-gray-500">
            <PackageSearch className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p className="text-sm">Ничего не найдено</p>
            <p className="text-xs mt-1">Попробуйте изменить поисковый запрос или фильтры</p>
          </div>
        )}

        {/* Пагинация: страницы + размер страницы + назад/вперёд */}
        {filteredProducts.length > 0 && (
          <div className="flex flex-col items-center gap-2 pt-3">
            <div className="flex items-center gap-1.5 flex-wrap justify-center">
              <button
                onClick={() => goPage(currentPage - 1)}
                disabled={currentPage === 1}
                className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-600 hover:border-blue-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                ‹ Назад
              </button>
              {pageList(currentPage, totalPages).map((n, i) =>
                n === '…' ? (
                  <span key={`gap-${i}`} className="px-1 text-gray-400 text-sm">
                    …
                  </span>
                ) : (
                  <button
                    key={n}
                    onClick={() => goPage(n)}
                    className={`min-w-[2.2rem] px-2 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                      n === currentPage
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-blue-300'
                    }`}
                  >
                    {n}
                  </button>
                )
              )}
              <button
                onClick={() => goPage(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-600 hover:border-blue-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Вперёд ›
              </button>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap justify-center">
              <span>
                Страница {currentPage} из {totalPages} · товаров: {filteredProducts.length}
              </span>
              <label className="flex items-center gap-1.5">
                На странице:
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="px-2 py-1 border border-gray-200 rounded-lg bg-white text-xs cursor-pointer"
                >
                  {PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="mt-6 flex items-center gap-6 text-xs text-gray-500 border-t border-gray-100 pt-4 flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-5 rounded bg-emerald-100 border border-emerald-200 flex items-center justify-center text-[10px] text-emerald-700 font-bold">
            5
          </span>
          В наличии (&gt;{SIZE_LOW} на размер, ≥{STORE_LOW} на магазин)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-5 rounded bg-amber-100 border border-amber-200 flex items-center justify-center text-[10px] text-amber-700 font-bold">
            2
          </span>
          Мало (≤{SIZE_LOW} на размер)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-5 rounded bg-red-100 border border-red-200 flex items-center justify-center text-[10px] text-red-700 font-bold">
            0
          </span>
          Нет в наличии
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`w-5 h-5 rounded border border-gray-200 flex items-center justify-center text-[10px] ${NOT_CARRIED_CLASS}`}>
            —
          </span>
          Магазин не возит товар
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-5 rounded bg-blue-50 border border-blue-300 flex items-center justify-center text-[10px]">
            📦
          </span>
          Склад (синий) — всегда последний в списке
        </span>
      </div>
      <p className="mt-2 text-[10px] text-gray-400">
        Подписи колонок: СПБ-Я = Санкт-Петербург (Ярослава Гашека), СПБ-С = Спортивная, ЕКБ-П =
        Парина, ЕКБ-С = Соболева, ЕКБ-Б = Бисертская, ЕКБ-Е = Елизаветинское шоссе, ТЮМ-Н = Тюмень
        (Народная). Наведите курсор на подпись или цифру — покажется полное название и остаток.
      </p>

      {selectedProduct && (
        <ProductCardModal productId={selectedProduct} onClose={() => closeProductCard()} />
      )}
    </div>
  );
}
