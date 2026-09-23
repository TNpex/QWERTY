import { useEffect, useMemo, useState } from 'react';
import { X, ExternalLink, Package, Store as StoreIcon, Flame, Pencil, Check } from 'lucide-react';
import { useData } from '../context/DataContext';
import { toProductPath, localPhotoCandidates } from '../utils/images';
import { compareSizes } from '../utils/sizes';
import { isWarehouse, getStoreCity, shortStoreLabel } from '../utils/storeGroups';
import type { InventoryItem, Product } from '../types';

/**
 * Фото товара с каскадом источников:
 * 1. локальный WebP из public/data/product_images/ (сжатая версия);
 * 2. локальный оригинал (.png из папки парсера);
 * 3. URL из product-images.json (собран scrape-images.mjs) — резерв;
 * 4. заглушка.
 */
function ProductImage({ product, alt }: { product: Product; alt: string }) {
  const { productImages } = useData();
  const sources = useMemo(() => {
    const list: string[] = [];
    if (product.photo) list.push(...localPhotoCandidates(product.photo));
    if (product.link) {
      const remote = productImages[toProductPath(product.link)];
      if (remote) list.push(remote);
    }
    return list;
  }, [product.photo, product.link, productImages]);

  const [failedCount, setFailedCount] = useState(0);
  useEffect(() => setFailedCount(0), [sources]);

  const src = sources[failedCount];
  if (!src) {
    return (
      <div className="flex flex-col items-center gap-2 text-gray-300 py-10">
        <Package className="w-16 h-16" />
        <span className="text-xs">Фото недоступно</span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className="w-full h-full object-contain max-h-[340px]"
      loading="lazy"
      onError={() => setFailedCount((c) => c + 1)}
    />
  );
}

/** Инлайн-редактор бренда: правка сохраняется по артикулу (localStorage) */
function BrandEditor({ product }: { product: Product }) {
  const { setBrandOverride, brandOverrides } = useData();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(product.brand);

  useEffect(() => setValue(product.brand), [product.brand]);

  const overridden = Boolean(product.article && brandOverrides[product.article]);

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
          {product.brand || 'Не определен'}
          {overridden && <span title="Бренд указан вручную"> ✎</span>}
        </span>
        {product.article && (
          <button
            onClick={() => setEditing(true)}
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-blue-600"
            title="Изменить бренд вручную (правка запомнится и будет экспортирована в CSV)"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
      </span>
    );
  }

  const save = () => {
    if (product.article && value.trim() && value.trim() !== product.brand) {
      setBrandOverride(product.article, value.trim());
    }
    setEditing(false);
  };

  return (
    <span className="inline-flex items-center gap-1">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setEditing(false);
        }}
        className="px-2 py-0.5 text-xs border border-blue-300 rounded focus:ring-2 focus:ring-blue-500 w-32"
        placeholder="Бренд"
      />
      <button
        onClick={save}
        className="p-1 rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
        title="Сохранить (применится ко всем товарам с этим артикулом)"
      >
        <Check className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => setEditing(false)}
        className="p-1 rounded bg-gray-100 text-gray-500 hover:bg-gray-200"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </span>
  );
}

/**
 * Модальная карточка товара: картинка с saletennis.com, цена, артикул,
 * наличие по ВСЕМ магазинам и размерам (не возит — «—»). Склад подсвечен синим.
 */
export function ProductCardModal({
  productId,
  onClose,
}: {
  productId: string;
  onClose: () => void;
}) {
  const { data, hotProducts } = useData();

  // Закрытие по Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const product = useMemo(
    () => data?.products.find((p) => p.id === productId) ?? null,
    [data, productId]
  );

  const view = useMemo(() => {
    if (!data || !product) return null;
    const items = data.inventory.filter((i) => i.productId === product.id && !i.notCarried);
    const sizes = [...new Set(items.map((i) => i.size))].sort(compareSizes);
    const byKey = new Map<string, InventoryItem>();
    const storeTotals = new Map<string, number>();
    for (const item of items) {
      byKey.set(`${item.storeId}|${item.size}`, item);
      storeTotals.set(item.storeId, (storeTotals.get(item.storeId) ?? 0) + item.quantity);
    }
    const total = [...storeTotals.values()].reduce((a, b) => a + b, 0);
    return { items, sizes, byKey, storeTotals, total };
  }, [data, product]);

  if (!data || !product || !view) return null;

  const soldOut = view.total === 0;
  const hotRule = hotProducts.find(
    (h) => h.article.trim().toLowerCase() === (product.article ?? '').trim().toLowerCase()
  );

  const cellClass = (qty: number) =>
    qty === 0
      ? 'bg-red-100 text-red-700 font-bold'
      : qty <= 2
        ? 'bg-amber-100 text-amber-700 font-semibold'
        : 'bg-emerald-100 text-emerald-700';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={product.name}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Шапка */}
        <div className="sticky top-0 bg-white/95 backdrop-blur flex items-start justify-between gap-3 p-5 border-b border-gray-100 z-10">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <BrandEditor product={product} />
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                {product.category}
              </span>
              {hotRule && (
                <span
                  className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700"
                  title={hotRule.note ?? 'Ходовой товар'}
                >
                  🔥 Топ: минимум {hotRule.minPerStore} в магазине
                </span>
              )}
              {soldOut && (
                <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                  <Flame className="w-3 h-3" /> Распродано
                </span>
              )}
            </div>
            <h2 className="text-lg font-bold text-gray-800 mt-2 leading-snug break-words">
              {product.name}
            </h2>
            <div className="text-xs text-gray-500 mt-1">
              {product.article ? <>Артикул: {product.article} · </> : null}
              {product.price > 0 && <>Цена: {product.price.toLocaleString('ru-RU')} ₽ · </>}
              Остаток:{' '}
              <b className={soldOut ? 'text-red-600' : 'text-emerald-600'}>{view.total} шт.</b>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {product.link && (
              <a
                href={product.link}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors"
              >
                На сайте <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
              aria-label="Закрыть"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Картинка */}
          <div className="rounded-xl overflow-hidden bg-gradient-to-br from-gray-50 to-blue-50 border border-gray-100 flex items-center justify-center min-h-[220px]">
            <ProductImage product={product} alt={product.name} />
          </div>

          {/* Наличие по ВСЕМ магазинам */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <StoreIcon className="w-4 h-4 text-gray-400" />
              Наличие по магазинам
            </h3>
            <div className="space-y-1.5">
              {data.stores.map((store) => {
                const warehouse = isWarehouse(store.name);
                const total = view.storeTotals.get(store.id);
                const carried = view.items.some((i) => i.storeId === store.id);
                return (
                  <div
                    key={store.id}
                    className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm ${
                      warehouse ? 'bg-blue-50 border border-blue-100' : 'bg-gray-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <span
                        className={`font-medium truncate ${warehouse ? 'text-blue-700' : 'text-gray-700'}`}
                      >
                        {warehouse ? '📦 ' : ''}
                        {store.name}
                      </span>
                      <span className="text-[10px] text-gray-400 ml-2">
                        {getStoreCity(store.name)}
                      </span>
                    </div>
                    {carried ? (
                      <span
                        className={`flex-shrink-0 inline-flex items-center justify-center min-w-[2rem] h-6 px-2 rounded text-xs ${cellClass(total ?? 0)}`}
                      >
                        {total ?? 0}
                      </span>
                    ) : (
                      <span
                        className="flex-shrink-0 inline-flex items-center justify-center min-w-[2rem] h-6 px-2 rounded text-xs bg-gray-100 text-gray-400"
                        title="Магазин не возит товар"
                      >
                        —
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Размерная сетка — ВСЕ магазины */}
        {view.sizes.length > 0 && (
          <div className="px-5 pb-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">
              Размерная сетка{view.sizes.length === 1 && view.sizes[0] === '—' ? '' : ' (по всем магазинам)'}
            </h3>
            <div className="overflow-x-auto border border-gray-100 rounded-lg">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left py-2 px-2 font-medium text-gray-500 sticky left-0 bg-gray-50">
                      Размер
                    </th>
                    {data.stores.map((store) => (
                      <th
                        key={store.id}
                        className={`text-center py-2 px-1 font-medium whitespace-nowrap ${
                          isWarehouse(store.name) ? 'bg-blue-50 text-blue-700' : 'text-gray-500'
                        }`}
                        title={store.name}
                      >
                        {isWarehouse(store.name) ? '📦 ' : ''}
                        {shortStoreLabel(store.name)}
                      </th>
                    ))}
                    <th className="text-center py-2 px-2 font-medium text-gray-500">Итого</th>
                  </tr>
                </thead>
                <tbody>
                  {view.sizes.map((size) => {
                    let rowTotal = 0;
                    const cells = data.stores.map((store) => {
                      const item = view.byKey.get(`${store.id}|${size}`);
                      if (!item) {
                        return (
                          <td key={store.id} className="text-center py-1.5 px-2 border-t border-gray-50">
                            <span
                              className="inline-flex items-center justify-center w-8 h-6 rounded text-xs bg-gray-50 text-gray-300"
                              title="Магазин не возит товар"
                            >
                              —
                            </span>
                          </td>
                        );
                      }
                      rowTotal += item.quantity;
                      return (
                        <td key={store.id} className="text-center py-1.5 px-2 border-t border-gray-50">
                          <span
                            className={`inline-flex items-center justify-center w-8 h-6 rounded text-xs ${cellClass(item.quantity)}`}
                          >
                            {item.quantity}
                          </span>
                        </td>
                      );
                    });
                    return (
                      <tr key={size}>
                        <td className="py-1.5 px-2 font-semibold text-gray-700 border-t border-gray-50 sticky left-0 bg-white">
                          {size}
                        </td>
                        {cells}
                        <td className="text-center py-1.5 px-2 font-bold text-gray-700 border-t border-gray-50">
                          {rowTotal}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[10px] text-gray-400">
              «—» — магазин не возит товар. Правка бренда (✎) сохраняется в браузере и
              экспортируется для записи в CSV (см. README: npm run apply-edits).
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
