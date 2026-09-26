import { useEffect, useMemo } from 'react';
import { MapPin, Ruler, X } from 'lucide-react';
import { useData } from '../context/DataContext';
import { ProductImage } from './ProductCardModal';
import { lastKnownSizes, normalizeLink, type DelistedProduct } from '../utils/historyCore';
import { isWarehouse, shortStoreLabel } from '../utils/storeGroups';
import type { Product } from '../types';

/**
 * Карточка распроданного товара, которого уже нет в каталоге (убран с сайта).
 * Показывает то, что ещё можно узнать: фото, где товар лежал в последний раз
 * (магазин и количество) и последние размеры в наличии по снимкам sizes.
 */
export function DelistedProductModal({
  delisted,
  onClose,
}: {
  delisted: DelistedProduct;
  onClose: () => void;
}) {
  const { history, sizeSnapshots } = useData();

  // Закрытие по Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Последнее место нахождения: самый свежий снимок истории, где товар ещё был
  const lastPresence = useMemo(() => {
    const wantedLink = normalizeLink(delisted.link);
    const sorted = [...history].sort((a, b) => b.date.localeCompare(a.date));
    for (const snapshot of sorted) {
      for (const product of snapshot.products.values()) {
        const same =
          (wantedLink && normalizeLink(product.link) === wantedLink) ||
          (delisted.article && product.article === delisted.article);
        if (!same) continue;
        const stores = Object.entries(product.byStore)
          .filter(([, qty]) => qty > 0)
          .sort((a, b) => b[1] - a[1]);
        return { date: snapshot.date, stores, total: product.total };
      }
    }
    return null;
  }, [history, delisted]);

  const sizes = useMemo(() => lastKnownSizes(sizeSnapshots, delisted), [sizeSnapshots, delisted]);

  const pseudoProduct: Product = useMemo(
    () => ({
      id: `delisted-${delisted.key}`,
      name: delisted.name,
      brand: delisted.brand,
      category: delisted.category,
      price: delisted.price,
      link: delisted.link || undefined,
      article: delisted.article || undefined,
    }),
    [delisted]
  );

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white flex items-start justify-between gap-3 p-5 border-b border-gray-100 z-10">
          <div className="min-w-0">
            <span className="inline-flex px-2 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold uppercase tracking-wide">
              Распродано · убран с сайта
            </span>
            <h2 className="text-lg font-bold text-gray-800 mt-2 leading-snug break-words">
              {delisted.name}
            </h2>
            <div className="text-xs text-gray-500 mt-1">
              {delisted.brand}
              {delisted.article ? ` · ${delisted.article}` : ''}
              {delisted.price > 0 ? ` · ${delisted.price.toLocaleString('ru-RU')} ₽` : ''}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 flex-shrink-0"
            aria-label="Закрыть"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="h-48 rounded-xl border border-gray-100 bg-gray-50 overflow-hidden flex items-center justify-center">
            <ProductImage product={pseudoProduct} alt={delisted.name} />
          </div>

          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
              <MapPin className="w-4 h-4 text-gray-400" />
              Последнее место нахождения
            </div>
            {lastPresence ? (
              <>
                <div className="text-xs text-gray-500 mb-2">
                  Снимок от {lastPresence.date} · всего в сети {lastPresence.total} шт.
                </div>
                {lastPresence.stores.length === 0 ? (
                  <p className="text-xs text-gray-400">
                    На дату последнего снимка полки уже были пустыми.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {lastPresence.stores.map(([store, qty]) => (
                      <div
                        key={store}
                        className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-3 py-1.5 text-xs"
                      >
                        <span className="text-gray-700 min-w-0 truncate" title={store}>
                          {store}
                          <span className="text-[10px] text-gray-400 ml-1.5">
                            {shortStoreLabel(store)}
                            {isWarehouse(store) ? ' · склад' : ''}
                          </span>
                        </span>
                        <span className="flex-shrink-0 inline-flex items-center justify-center min-w-[2rem] h-6 px-2 rounded text-xs font-semibold bg-emerald-100 text-emerald-700 tabular-nums">
                          {qty} шт
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-gray-400">
                В истории снимков товар не найден — последнего места нахождения нет.
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
              <Ruler className="w-4 h-4 text-gray-400" />
              Последние размеры в наличии
            </div>
            {sizes ? (
              <>
                {sizes.sizes.filter((size) => size !== '—').length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {sizes.sizes
                      .filter((size) => size !== '—')
                      .map((size) => (
                        <span
                          key={size}
                          className="px-2 py-1 rounded bg-gray-100 text-gray-700 text-xs font-medium tabular-nums"
                        >
                          {size}
                        </span>
                      ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">Товар без размерного ряда.</p>
                )}
                <p className="text-[10px] text-gray-400 mt-1.5">
                  По снимку размеров от {sizes.date} — последние размеры, которые сайт показывал
                  в наличии.
                </p>
              </>
            ) : (
              <p className="text-xs text-gray-400">
                Товар без размерного ряда или данных о размерах нет.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
