import { useEffect, useMemo, useState } from 'react';
import { X, ExternalLink, Package, Store as StoreIcon, Flame } from 'lucide-react';
import { useData } from '../context/DataContext';
import { toProductPath } from '../utils/images';
import { compareSizes } from '../utils/sizes';
import { isWarehouse, getStoreCity } from '../utils/storeGroups';
import type { InventoryItem } from '../types';

/**
 * Модальная карточка товара: картинка с saletennis.com, цена, артикул,
 * наличие по магазинам и размерам. Склад подсвечен синим.
 */
export function ProductCardModal({
  productId,
  onClose,
}: {
  productId: string;
  onClose: () => void;
}) {
  const { data, productImages } = useData();
  const [imageFailed, setImageFailed] = useState(false);

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
    const items = data.inventory.filter(
      (i) => i.productId === product.id && !i.notCarried
    );
    const sizes = [...new Set(items.map((i) => i.size))].sort(compareSizes);
    const byKey = new Map<string, InventoryItem>();
    const storeTotals = new Map<string, number>();
    for (const item of items) {
      byKey.set(`${item.storeId}|${item.size}`, item);
      storeTotals.set(item.storeId, (storeTotals.get(item.storeId) ?? 0) + item.quantity);
    }
    // Магазины, которые возят товар (в порядке витрины: склад последний)
    const carryingStores = data.stores.filter((s) => storeTotals.has(s.id));
    const total = [...storeTotals.values()].reduce((a, b) => a + b, 0);
    return { items, sizes, byKey, storeTotals, carryingStores, total };
  }, [data, product]);

  if (!data || !product || !view) return null;

  const image =
    !imageFailed && product.link ? productImages[toProductPath(product.link)] : undefined;
  const soldOut = view.total === 0;

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
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                {product.brand}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                {product.category}
              </span>
              {soldOut && (
                <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                  <Flame className="w-3 h-3" /> Распродано
                </span>
              )}
            </div>
            <h2 className="text-lg font-bold text-gray-800 mt-2 leading-snug">{product.name}</h2>
            <div className="text-xs text-gray-500 mt-1">
              {product.article ? <>Артикул: {product.article} · </> : null}
              {product.price > 0 && <>Цена: {product.price.toLocaleString('ru-RU')} ₽ · </>}
              Остаток: <b className={soldOut ? 'text-red-600' : 'text-emerald-600'}>{view.total} шт.</b>
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
            {image ? (
              <img
                src={image}
                alt={product.name}
                className="w-full h-full object-contain max-h-[340px]"
                loading="lazy"
                onError={() => setImageFailed(true)}
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-gray-300 py-10">
                <Package className="w-16 h-16" />
                <span className="text-xs">Фото недоступно</span>
              </div>
            )}
          </div>

          {/* Наличие по магазинам */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <StoreIcon className="w-4 h-4 text-gray-400" />
              Наличие по магазинам
            </h3>
            <div className="space-y-1.5">
              {view.carryingStores.map((store) => {
                const warehouse = isWarehouse(store.name);
                const total = view.storeTotals.get(store.id) ?? 0;
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
                    <span
                      className={`flex-shrink-0 inline-flex items-center justify-center min-w-[2rem] h-6 px-2 rounded text-xs ${cellClass(total)}`}
                    >
                      {total}
                    </span>
                  </div>
                );
              })}
              {view.carryingStores.length === 0 && (
                <p className="text-xs text-gray-400">Нет в наличии ни в одном магазине</p>
              )}
            </div>
          </div>
        </div>

        {/* Размерная сетка */}
        {view.sizes.length > 0 && !(view.sizes.length === 1 && view.sizes[0] === '—') && (
          <div className="px-5 pb-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Размерная сетка</h3>
            <div className="overflow-x-auto border border-gray-100 rounded-lg">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left py-2 px-2 font-medium text-gray-500 sticky left-0 bg-gray-50">
                      Размер
                    </th>
                    {view.carryingStores.map((store) => (
                      <th
                        key={store.id}
                        className={`text-center py-2 px-2 font-medium whitespace-nowrap ${
                          isWarehouse(store.name) ? 'bg-blue-50 text-blue-700' : 'text-gray-500'
                        }`}
                        title={store.name}
                      >
                        {isWarehouse(store.name) ? '📦' : ''} {store.name}
                      </th>
                    ))}
                    <th className="text-center py-2 px-2 font-medium text-gray-500">Итого</th>
                  </tr>
                </thead>
                <tbody>
                  {view.sizes.map((size) => {
                    let rowTotal = 0;
                    const cells = view.carryingStores.map((store) => {
                      const item = view.byKey.get(`${store.id}|${size}`);
                      const qty = item?.quantity ?? 0;
                      rowTotal += qty;
                      return (
                        <td key={store.id} className="text-center py-1.5 px-2 border-t border-gray-50">
                          <span
                            className={`inline-flex items-center justify-center w-8 h-6 rounded text-xs ${cellClass(qty)}`}
                          >
                            {qty}
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
          </div>
        )}
      </div>
    </div>
  );
}
