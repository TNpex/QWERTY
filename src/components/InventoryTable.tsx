import { useState, useMemo, useEffect, useRef } from 'react';
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
import { useData } from '../context/DataContext';
import { compareSizes } from '../utils/sizes';
import { isWarehouse, shortStoreLabel } from '../utils/storeGroups';
import { sportOf, productSettingsKey } from '../utils/sport';
import { ProductCardModal, ProductImage } from './ProductCardModal';
import { SportBadge } from './SportBadge';
import type { InventoryItem } from '../types';

// Единые пороги цветов (совпадают с легендой внизу таблицы)
const SIZE_LOW = 2; // ≤ 2 шт одного размера в магазине — «мало»
const STORE_LOW = 5; // < 5 шт суммарно в магазине — «мало»
const PAGE_SIZE = 100; // порция отображаемых товаров («Показать ещё»)
const GHOST_LIMIT = 60; // сколько «убранных с сайта» товаров показывать списком
const VIEW_MODE_KEY = 'st-inventory-view';

type ViewMode = 'table' | 'cards';
type Availability = 'all' | 'inStock' | 'soldOut';

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
  const { settings, delistedProducts, filters, storeProfile } = useData();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStore, setSelectedStore] = useState<string>('all');
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [availability, setAvailability] = useState<Availability>('all');
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      return localStorage.getItem(VIEW_MODE_KEY) === 'cards' ? 'cards' : 'table';
    } catch {
      return 'table';
    }
  });
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);

  // Выбор режима (таблица/карточки) запоминается в браузере
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_KEY, viewMode);
    } catch {
      /* приватный режим */
    }
  }, [viewMode]);

  // Профиль «Мой магазин»: при выборе предустанавливаем фильтр магазина
  const lastProfile = useRef<string | null>(null);
  useEffect(() => {
    if (lastProfile.current === storeProfile) return;
    lastProfile.current = storeProfile;
    if (!storeProfile || !data) return;
    const store = data.stores.find((st) => st.name === storeProfile);
    if (store) setSelectedStore(store.id);
  }, [storeProfile, data]);

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

  const filteredProducts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return products.filter((p) => {
      const matchesSearch =
        !term ||
        p.name.toLowerCase().includes(term) ||
        p.brand.toLowerCase().includes(term) ||
        (p.article ?? '').toLowerCase().includes(term);
      const total = indexes.productTotals.get(p.id) ?? 0;
      const matchesAvailability =
        availability === 'all' ||
        (availability === 'inStock' ? total > 0 : total === 0);
      return matchesSearch && matchesAvailability;
    });
  }, [products, searchTerm, availability, indexes]);

  // Товары, убранные с сайта (из истории снимков): показываются в «Все» и
  // «Распроданные»; поиск и глобальные фильтры к ним тоже применяются.
  const filteredDelisted = useMemo(() => {
    if (availability === 'inStock' || delistedProducts.length === 0) return [];
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
  }, [delistedProducts, searchTerm, availability, filters, settings]);

  const soldOutCount = useMemo(
    () => products.filter((p) => (indexes.productTotals.get(p.id) ?? 0) === 0).length,
    [products, indexes]
  );
  const inStockCount = products.length - soldOutCount;

  const visibleProducts = useMemo(
    () => filteredProducts.slice(0, visibleCount),
    [filteredProducts, visibleCount]
  );

  const resetPage = () => setVisibleCount(PAGE_SIZE);

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
            onChange={(e) => setSelectedStore(e.target.value)}
            className="px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm appearance-none bg-white cursor-pointer"
          >
            <option value="all">Все магазины</option>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {isWarehouse(store.name) ? '📦 ' : ''}
                {store.name}
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
          из {products.length + delistedProducts.length}
          {filteredDelisted.length > 0 && (
            <span className="text-gray-400"> (вкл. {filteredDelisted.length} убранных с сайта)</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Наличие: все / в наличии / распроданные */}
          <div className="inline-flex rounded-full border border-gray-200 overflow-hidden text-xs">
            {(
              [
                ['all', `Все (${products.length + delistedProducts.length})`, 'bg-gray-700'],
                ['inStock', `В наличии (${inStockCount})`, 'bg-emerald-500'],
                [
                  'soldOut',
                  `Распроданные (${soldOutCount + delistedProducts.length})`,
                  'bg-red-500',
                ],
              ] as [Availability, string, string][]
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
                {label}
              </button>
            ))}
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

      <div className="space-y-2">
        {viewMode === 'cards' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            {visibleProducts.map((product) => {
              const totalStock = indexes.productTotals.get(product.id) ?? 0;
              const isSoldOut = totalStock === 0;
              const sport = sportOf(product, settings.sportOverrides);
              const excluded = Boolean(excludedKeys[productSettingsKey(product)]);
              const hot = isHot(product);
              const supplied = settings.suppliedProducts[productSettingsKey(product)] === true;
              return (
                <button
                  key={product.id}
                  onClick={() => setSelectedProduct(product.id)}
                  className="group text-left bg-white border border-gray-100 rounded-xl overflow-hidden hover:border-blue-300 hover:shadow-md transition-all flex flex-col"
                  title="Открыть карточку товара (наличие, ориентация, исключения)"
                >
                  <div className="relative h-32 bg-gradient-to-br from-gray-50 to-blue-50 flex items-center justify-center overflow-hidden">
                    <ProductImage product={product} alt={product.name} />
                    {isSoldOut && (
                      <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-red-500 text-white text-[9px] font-bold uppercase tracking-wide">
                        Распродано
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
            {filteredDelisted.slice(0, GHOST_LIMIT).map((g) => {
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
          <div className="text-center">Общий остаток</div>
          <div className="text-center">По магазинам</div>
        </div>

        {/* Product Rows */}
        {visibleProducts.map((product) => {
          const isExpanded = expandedProduct === product.id;
          const totalStock = indexes.productTotals.get(product.id) ?? 0;
          const isSoldOut = totalStock === 0;
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
                          setSelectedProduct(product.id);
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
                        <span className="ml-1.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold uppercase tracking-wide align-middle">
                          <Flame className="w-2.5 h-2.5" /> Распродано
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

        {availability !== 'inStock' &&
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

        {filteredProducts.length > visibleProducts.length && (
          <div className="text-center pt-2">
            <button
              onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              className="px-6 py-2.5 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-blue-300 transition-colors"
            >
              Показать ещё {Math.min(PAGE_SIZE, filteredProducts.length - visibleProducts.length)}{' '}
              (осталось {filteredProducts.length - visibleProducts.length})
            </button>
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
        <ProductCardModal productId={selectedProduct} onClose={() => setSelectedProduct(null)} />
      )}
    </div>
  );
}
