import { useState, useMemo } from 'react';
import { Search, Filter, ChevronDown, ChevronUp, PackageSearch, Flame, ExternalLink } from 'lucide-react';
import { useData } from '../context/DataContext';
import { compareSizes } from '../utils/sizes';
import { isWarehouse } from '../utils/storeGroups';
import { ProductCardModal } from './ProductCardModal';
import type { InventoryItem } from '../types';

// Единые пороги цветов (совпадают с легендой внизу таблицы)
const SIZE_LOW = 2; // ≤ 2 шт одного размера в магазине — «мало»
const STORE_LOW = 5; // < 5 шт суммарно в магазине — «мало»
const PAGE_SIZE = 100; // порция отображаемых товаров («Показать ещё»)

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
  const { data } = useData();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedStore, setSelectedStore] = useState<string>('all');
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [onlySoldOut, setOnlySoldOut] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);

  const stores = useMemo(() => data?.stores ?? [], [data]);
  const products = useMemo(() => data?.products ?? [], [data]);
  const inventory = useMemo(() => data?.inventory ?? [], [data]);

  // ВАЖНО: все хуки вызываются ДО условного return (правила хуков React)
  const categories = useMemo(
    () => ['all', ...new Set(products.map((p) => p.category))],
    [products]
  );

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

  const filteredProducts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return products.filter((p) => {
      const matchesSearch =
        !term ||
        p.name.toLowerCase().includes(term) ||
        p.brand.toLowerCase().includes(term) ||
        (p.article ?? '').toLowerCase().includes(term);
      const matchesCategory = selectedCategory === 'all' || p.category === selectedCategory;
      const matchesSoldOut =
        !onlySoldOut || (indexes.productTotals.get(p.id) ?? 0) === 0;
      return matchesSearch && matchesCategory && matchesSoldOut;
    });
  }, [products, searchTerm, selectedCategory, onlySoldOut, indexes]);

  const soldOutCount = useMemo(
    () => products.filter((p) => (indexes.productTotals.get(p.id) ?? 0) === 0).length,
    [products, indexes]
  );

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
        <div className="flex gap-3">
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <select
              value={selectedCategory}
              onChange={(e) => {
                setSelectedCategory(e.target.value);
                resetPage();
              }}
              className="pl-10 pr-8 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm appearance-none bg-white cursor-pointer"
            >
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat === 'all' ? 'Все категории' : cat}
                </option>
              ))}
            </select>
          </div>
          <select
            value={selectedStore}
            onChange={(e) => setSelectedStore(e.target.value)}
            className="px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm appearance-none bg-white cursor-pointer"
          >
            <option value="all">Все магазины</option>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="text-xs text-gray-500">
          Найдено товаров:{' '}
          <span className="font-semibold text-gray-700">{filteredProducts.length}</span> из{' '}
          {products.length}
        </div>
        <button
          onClick={() => {
            setOnlySoldOut(!onlySoldOut);
            resetPage();
          }}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            onlySoldOut
              ? 'bg-red-500 text-white hover:bg-red-600'
              : 'bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-600'
          }`}
        >
          <Flame className="w-3.5 h-3.5" />
          Только распроданные ({soldOutCount})
        </button>
      </div>

      <div className="space-y-2">
        {/* Table Header */}
        <div
          className="grid gap-2 px-4 py-2 bg-gradient-to-r from-green-50 to-blue-50 rounded-lg text-xs font-semibold text-gray-600 uppercase tracking-wide border border-green-100"
          style={{ gridTemplateColumns: `2fr 0.8fr 0.8fr ${Math.max(displayStores.length, 1)}fr` }}
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
                style={{ gridTemplateColumns: `2fr 0.8fr 0.8fr ${Math.max(displayStores.length, 1)}fr` }}
                onClick={() => setExpandedProduct(isExpanded ? null : product.id)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-sm truncate" title="Открыть карточку товара">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedProduct(product.id);
                        }}
                        className="font-medium text-gray-800 hover:text-blue-600 hover:underline text-left"
                      >
                        {product.name}
                      </button>
                      {product.link && (
                        <a
                          href={product.link}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="ml-1.5 inline-block text-gray-400 hover:text-blue-500"
                          title="Открыть на saletennis.com"
                        >
                          <ExternalLink className="w-3 h-3 inline" />
                        </a>
                      )}
                      {isSoldOut && (
                        <span className="ml-2 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold uppercase tracking-wide align-middle">
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
                    const agg = indexes.storeTotals.get(`${product.id}|${store.id}`);
                    if (!agg) {
                      // Магазин не возит товар
                      return (
                        <div key={store.id} className="text-center" title={`${store.name}: не возит`}>
                          <span
                            className={`inline-flex items-center justify-center min-w-[2rem] h-7 px-2 rounded text-xs font-medium ${NOT_CARRIED_CLASS}`}
                          >
                            —
                          </span>
                        </div>
                      );
                    }
                    return (
                      <div key={store.id} className="text-center" title={store.name}>
                        <span
                          className={`inline-flex items-center justify-center min-w-[2rem] h-7 px-2 rounded text-xs font-medium ${storeCellClass(agg.total)}`}
                        >
                          {agg.total}
                        </span>
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
                              className={`text-center py-2 px-2 font-medium whitespace-nowrap ${
                                isWarehouse(store.name)
                                  ? 'text-blue-700 bg-blue-50 rounded'
                                  : 'text-gray-500'
                              }`}
                              title={isWarehouse(store.name) ? `${store.name} — склад` : store.name}
                            >
                              {isWarehouse(store.name) ? '📦 ' : ''}
                              {store.name}
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

        {filteredProducts.length === 0 && (
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
          <span className="w-5 h-5 rounded bg-blue-50 border border-blue-200 flex items-center justify-center text-[10px]">
            📦
          </span>
          Склад (синий) — всегда последний в списке
        </span>
      </div>

      {selectedProduct && (
        <ProductCardModal productId={selectedProduct} onClose={() => setSelectedProduct(null)} />
      )}
    </div>
  );
}
