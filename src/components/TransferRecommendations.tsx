import { useMemo, useState } from 'react';
import {
  ArrowRight,
  AlertTriangle,
  Package,
  Info,
  Warehouse,
  Banknote,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  MapPin,
} from 'lucide-react';
import { useData } from '../context/DataContext';
import { useTransferRecommendations } from '../hooks/useAnalytics';
import {
  MAX_TRANSFER_DISPLAY,
  STORE_EXCESS_TRIGGER,
  DONOR_KEEP,
  getOverstockPositions,
} from '../utils/analyticsCore';
import { isWarehouse, shortStoreLabel, ROUTE_LABELS, type TransferRoute } from '../utils/storeGroups';
import { ProductCardModal } from './ProductCardModal';
import type { TransferRecommendation } from '../types';

const PRIORITY_STYLES: Record<string, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-blue-100 text-blue-700',
};

const PRIORITY_LABELS: Record<string, string> = {
  high: 'Высокий',
  medium: 'Средний',
  low: 'Низкий',
};

const ROUTE_STYLES: Record<TransferRoute, string> = {
  warehouse: 'bg-blue-50 text-blue-700 border border-blue-200',
  'same-city': 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  intercity: 'bg-gray-100 text-gray-600 border border-gray-200',
  'spb-expensive': 'bg-red-50 text-red-600 border border-red-200',
};

const ROUTE_ICONS: Record<TransferRoute, typeof Warehouse> = {
  warehouse: Warehouse,
  'same-city': MapPin,
  intercity: ArrowRight,
  'spb-expensive': Banknote,
};

interface ProductGroup {
  productId: string;
  productName: string;
  productLink?: string;
  brand: string;
  recs: TransferRecommendation[];
}

export function TransferRecommendations() {
  const { data } = useData();
  const recommendations = useTransferRecommendations();
  const [toStoreId, setToStoreId] = useState('all');
  const [fromStoreId, setFromStoreId] = useState('all');
  const [selectedBrand, setSelectedBrand] = useState('all');
  const [showSpbExpensive, setShowSpbExpensive] = useState(false);
  const [showOverstock, setShowOverstock] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);

  const brands = useMemo(
    () =>
      ['all', ...new Set(recommendations.map((r) => r.brand))].sort((a, b) =>
        a === 'all' ? -1 : b === 'all' ? 1 : a.localeCompare(b, 'ru')
      ),
    [recommendations]
  );

  // Остатки по товарам для наглядных чипов: productId → (storeId → qty)
  const productStoreTotals = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    if (!data) return map;
    for (const item of data.inventory) {
      if (item.notCarried) continue;
      let byStore = map.get(item.productId);
      if (!byStore) {
        byStore = new Map();
        map.set(item.productId, byStore);
      }
      byStore.set(item.storeId, (byStore.get(item.storeId) ?? 0) + item.quantity);
    }
    return map;
  }, [data]);

  const overstock = useMemo(() => (data ? getOverstockPositions(data) : []), [data]);

  const spbExpensiveCount = recommendations.filter((r) => r.route === 'spb-expensive').length;

  const filtered = useMemo(
    () =>
      recommendations.filter(
        (r) =>
          (toStoreId === 'all' || r.toStoreId === toStoreId) &&
          (fromStoreId === 'all' || r.fromStoreId === fromStoreId) &&
          (selectedBrand === 'all' || r.brand === selectedBrand) &&
          (showSpbExpensive || r.route !== 'spb-expensive')
      ),
    [recommendations, toStoreId, fromStoreId, selectedBrand, showSpbExpensive]
  );

  const groups = useMemo(() => {
    const byProduct = new Map<string, ProductGroup>();
    for (const rec of filtered) {
      let group = byProduct.get(rec.productId);
      if (!group) {
        group = {
          productId: rec.productId,
          productName: rec.productName,
          productLink: rec.productLink,
          brand: '',
          recs: [],
        };
        byProduct.set(rec.productId, group);
      }
      group.recs.push(rec);
    }
    return [...byProduct.values()].slice(0, MAX_TRANSFER_DISPLAY);
  }, [filtered]);

  if (!data) return null;

  const selectedToStore = data.stores.find((s) => s.id === toStoreId);
  const totalVisibleUnits = filtered.reduce((sum, r) => sum + r.quantity, 0);

  return (
    <div className="space-y-4">
      {/* Панель фильтров */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <Package className="w-5 h-5 text-blue-600" />
              {selectedToStore
                ? `Отсутствующий ассортимент: ${selectedToStore.name}`
                : 'Рекомендации по перемещению'}
            </h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {filtered.length} перемещений · {totalVisibleUnits} шт.
              {toStoreId !== 'all' && ' — чем заполнить выбранный магазин'}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <select
              value={selectedBrand}
              onChange={(e) => setSelectedBrand(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white cursor-pointer focus:ring-2 focus:ring-blue-500"
            >
              {brands.map((brand) => (
                <option key={brand} value={brand}>
                  {brand === 'all' ? 'Все бренды' : brand}
                </option>
              ))}
            </select>
            <select
              value={toStoreId}
              onChange={(e) => setToStoreId(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white cursor-pointer focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">Куда: все магазины</option>
              {data.stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {isWarehouse(store.name) ? '📦 ' : ''}
                  Куда: {store.name}
                </option>
              ))}
            </select>
            <select
              value={fromStoreId}
              onChange={(e) => setFromStoreId(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white cursor-pointer focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">Откуда: все</option>
              {data.stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {isWarehouse(store.name) ? '📦 ' : ''}
                  Откуда: {store.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Предупреждение про дорогую логистику из СПб */}
        {spbExpensiveCount > 0 && (
          <div className="mt-3 flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <Banknote className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-amber-800 flex-1">
              <b>Перемещения из Санкт-Петербурга в другие города стоят дорого.</b> Обычно выгоднее
              дозаказать у поставщика или оставить товар в СПб. Скрыто по умолчанию:{' '}
              {spbExpensiveCount} таких рекомендаций.
              <label className="ml-2 inline-flex items-center gap-1.5 cursor-pointer font-medium underline decoration-dotted">
                <input
                  type="checkbox"
                  checked={showSpbExpensive}
                  onChange={(e) => setShowSpbExpensive(e.target.checked)}
                  className="rounded border-amber-400"
                />
                Показать
              </label>
            </div>
          </div>
        )}

        <div className="mt-3 flex items-start gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-gray-400" />
          <p>
            Логика: товар со <b>склада</b> направляется в магазины, где его нет; размер с{' '}
            <b>переизбытком ≥ {STORE_EXCESS_TRIGGER} шт.</b> в магазине — частично (оставляя{' '}
            {DONOR_KEEP}) едет туда, где его нет или мало. Маршруты: 📦 со склада · 🟢 внутри
            города · ⚪ между городами · 💸 из СПб (дорого).
          </p>
        </div>
      </div>

      {/* Карточки товаров */}
      <div className="space-y-3">
        {groups.map((group) => {
          const storeTotals = productStoreTotals.get(group.productId);
          const brand = data.products.find((p) => p.id === group.productId)?.brand ?? '';
          return (
            <div
              key={group.productId}
              className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <button
                    onClick={() => setSelectedProduct(group.productId)}
                    className="font-medium text-sm text-gray-800 hover:text-blue-600 hover:underline text-left"
                    title="Открыть карточку товара"
                  >
                    {group.productName}
                  </button>
                  {group.productLink && (
                    <a
                      href={group.productLink}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-1.5 text-gray-400 hover:text-blue-500"
                      title="Открыть на saletennis.com"
                    >
                      <ExternalLink className="w-3 h-3 inline" />
                    </a>
                  )}
                  <div className="text-xs text-gray-500 mt-0.5">{brand}</div>
                </div>
                <span className="text-xs font-bold text-gray-700 bg-gray-100 px-2.5 py-1 rounded-full flex-shrink-0">
                  {group.recs.length} перем. ·{' '}
                  {group.recs.reduce((s, r) => s + r.quantity, 0)} шт.
                </span>
              </div>

              {/* Наглядные текущие остатки по магазинам */}
              {storeTotals && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {data.stores
                    .filter((s) => storeTotals.has(s.id))
                    .map((store) => {
                      const qty = storeTotals.get(store.id) ?? 0;
                      const warehouse = isWarehouse(store.name);
                      return (
                        <span
                          key={store.id}
                          title={`${store.name}: ${qty} шт.`}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border ${
                            warehouse
                              ? 'bg-blue-50 border-blue-200 text-blue-700'
                              : qty === 0
                                ? 'bg-red-50 border-red-200 text-red-600'
                                : qty >= STORE_EXCESS_TRIGGER
                                  ? 'bg-amber-50 border-amber-200 text-amber-700'
                                  : 'bg-gray-50 border-gray-200 text-gray-600'
                          }`}
                        >
                          {shortStoreLabel(store.name)}: <b>{qty}</b>
                        </span>
                      );
                    })}
                </div>
              )}

              {/* Перемещения по размерам */}
              <div className="space-y-1.5">
                {group.recs.map((rec) => {
                  const RouteIcon = ROUTE_ICONS[rec.route];
                  return (
                    <div
                      key={`${rec.fromStoreId}|${rec.toStoreId}|${rec.size}`}
                      className="flex items-center gap-2 flex-wrap text-xs bg-gray-50 rounded-lg px-3 py-2"
                    >
                      <span className="font-bold text-gray-800 bg-white border border-gray-200 rounded px-2 py-0.5">
                        {rec.size}
                      </span>
                      <span className="text-gray-600">
                        {shortStoreLabel(rec.fromStore)}{' '}
                        <span className="text-gray-400">({rec.fromQty} шт.)</span>
                      </span>
                      <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
                      <span className="text-gray-600">
                        {shortStoreLabel(rec.toStore)}{' '}
                        <span className="text-red-400">({rec.toQty} шт.)</span>
                      </span>
                      <span className="font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5">
                        везти {rec.quantity}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${ROUTE_STYLES[rec.route]}`}
                      >
                        <RouteIcon className="w-3 h-3" />
                        {ROUTE_LABELS[rec.route]}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${PRIORITY_STYLES[rec.priority]}`}
                      >
                        {PRIORITY_LABELS[rec.priority]}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length > groups.reduce((s, g) => s + g.recs.length, 0) && (
        <p className="text-xs text-gray-500 text-center">
          Показаны первые {groups.length} товаров из большого списка — уточните фильтр магазином
        </p>
      )}

      {filtered.length === 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 text-center text-gray-500">
          <Package className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p>Нет рекомендаций по выбранным фильтрам</p>
          <p className="text-xs mt-1">
            {spbExpensiveCount > 0 && !showSpbExpensive
              ? 'Возможно, всё скрыто как дорогая логистика из СПб — включите показ выше'
              : 'Все размеры распределены равномерно'}
          </p>
        </div>
      )}

      {/* Переизбыток */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <button
          onClick={() => setShowOverstock(!showOverstock)}
          className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Переизбыток: позиции ≥ {STORE_EXCESS_TRIGGER} шт. одного размера ({overstock.length})
          </div>
          {showOverstock ? (
            <ChevronUp className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          )}
        </button>
        {showOverstock && (
          <div className="border-t border-gray-100 p-4 max-h-[400px] overflow-y-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {overstock.slice(0, 200).map((pos, i) => (
                <div
                  key={`${pos.productId}|${pos.storeId}|${pos.size}|${i}`}
                  className="flex items-center justify-between gap-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2"
                >
                  <div className="min-w-0">
                    <button
                      onClick={() => setSelectedProduct(pos.productId)}
                      className="text-xs font-medium text-gray-800 hover:text-blue-600 hover:underline truncate block max-w-full text-left"
                      title={pos.productName}
                    >
                      {pos.productName}
                    </button>
                    <div className="text-[10px] text-gray-500">
                      {isWarehouse(pos.storeName) ? '📦 ' : ''}
                      {shortStoreLabel(pos.storeName)} · размер {pos.size}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-bold text-amber-700">{pos.quantity} шт.</div>
                    <div className="text-[10px] text-amber-600">избыток {pos.excess}</div>
                  </div>
                </div>
              ))}
            </div>
            {overstock.length > 200 && (
              <p className="text-xs text-gray-400 text-center mt-3">
                Показаны первые 200 из {overstock.length}
              </p>
            )}
          </div>
        )}
      </div>

      {selectedProduct && (
        <ProductCardModal productId={selectedProduct} onClose={() => setSelectedProduct(null)} />
      )}
    </div>
  );
}
