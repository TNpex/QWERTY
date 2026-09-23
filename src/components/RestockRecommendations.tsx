import { useMemo, useState } from 'react';
import {
  ShoppingCart,
  AlertCircle,
  Info,
  Package,
  Download,
  Truck,
  ExternalLink,
} from 'lucide-react';
import { useData } from '../context/DataContext';
import { useRestockRecommendations } from '../hooks/useAnalytics';
import { MIN_PER_STORE, MAX_RESTOCK_DISPLAY } from '../utils/analyticsCore';
import { ProductCardModal } from './ProductCardModal';
import type { RestockUrgency } from '../types';

const URGENCY_BADGES: Record<RestockUrgency, { label: string; color: string; border: string }> = {
  critical: { label: 'Критично', color: 'bg-red-100 text-red-700', border: 'border-l-red-500 bg-red-50/50' },
  high: { label: 'Срочно', color: 'bg-orange-100 text-orange-700', border: 'border-l-orange-500 bg-orange-50/50' },
  medium: { label: 'Запланировать', color: 'bg-yellow-100 text-yellow-700', border: 'border-l-yellow-500 bg-yellow-50/50' },
};

/** Выгрузка заявки поставщику в XLSX (учитывает активные фильтры) */
async function exportOrderXlsx(
  rows: {
    article: string;
    name: string;
    brand: string;
    category: string;
    sizes: string;
    toPurchase: number;
    transferCover: number;
    price: number;
  }[],
  brandLabel: string
) {
  const XLSX = await import('xlsx');
  const sheetRows = rows.map((r) => ({
    'Артикул': r.article,
    'Название': r.name,
    'Бренд': r.brand,
    'Категория': r.category,
    'Размеры к заказу': r.sizes,
    'Заказать, шт.': r.toPurchase,
    'Покрыть перемещением, шт.': r.transferCover,
    'Цена, ₽': r.price,
    'Сумма, ₽': Math.round(r.price * r.toPurchase),
  }));
  const worksheet = XLSX.utils.json_to_sheet(sheetRows);
  worksheet['!cols'] = [
    { wch: 14 }, { wch: 52 }, { wch: 12 }, { wch: 18 },
    { wch: 28 }, { wch: 14 }, { wch: 24 }, { wch: 10 }, { wch: 12 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Заявка');
  const safeBrand = brandLabel.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 40);
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `Заявка_${safeBrand}_${date}.xlsx`);
}

export function RestockRecommendations() {
  const { data } = useData();
  const recommendations = useRestockRecommendations();
  const [selectedBrand, setSelectedBrand] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [onlyToPurchase, setOnlyToPurchase] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const brands = useMemo(
    () => ['all', ...new Set(recommendations.map((r) => r.brand))].sort((a, b) => a.localeCompare(b, 'ru')),
    [recommendations]
  );
  const categories = useMemo(
    () => ['all', ...new Set(recommendations.map((r) => r.category))].sort((a, b) => a.localeCompare(b, 'ru')),
    [recommendations]
  );

  const filtered = useMemo(
    () =>
      recommendations.filter(
        (r) =>
          (selectedBrand === 'all' || r.brand === selectedBrand) &&
          (selectedCategory === 'all' || r.category === selectedCategory) &&
          (!onlyToPurchase || r.toPurchase > 0)
      ),
    [recommendations, selectedBrand, selectedCategory, onlyToPurchase]
  );

  const productById = useMemo(
    () => new Map((data?.products ?? []).map((p) => [p.id, p])),
    [data]
  );

  // KPI — по отфильтрованному набору (заявка конкретного бренда)
  const stats = useMemo(() => {
    let critical = 0;
    let high = 0;
    let toPurchase = 0;
    let transferCover = 0;
    let cost = 0;
    for (const r of filtered) {
      if (r.urgency === 'critical') critical++;
      if (r.urgency === 'high') high++;
      toPurchase += r.toPurchase;
      transferCover += r.transferCover;
      cost += (productById.get(r.productId)?.price ?? 0) * r.toPurchase;
    }
    return { critical, high, toPurchase, transferCover, cost };
  }, [filtered, productById]);

  if (!data) return null;

  const visible = filtered.slice(0, MAX_RESTOCK_DISPLAY);

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportOrderXlsx(
        filtered
          .filter((r) => r.toPurchase > 0)
          .map((r) => ({
            article: productById.get(r.productId)?.article ?? '',
            name: r.productName,
            brand: r.brand,
            category: r.category,
            sizes: r.sizes
              .filter((s) => s.toPurchase > 0)
              .map((s) => `${s.size}×${s.toPurchase}`)
              .join(', '),
            toPurchase: r.toPurchase,
            transferCover: r.transferCover,
            price: productById.get(r.productId)?.price ?? 0,
          })),
        selectedBrand === 'all' ? 'все_бренды' : selectedBrand
      );
    } finally {
      setExporting(false);
    }
  };

  const brandLabel = selectedBrand === 'all' ? 'все бренды' : selectedBrand;
  const categoryLabel = selectedCategory === 'all' ? 'все категории' : selectedCategory;

  return (
    <div className="space-y-4">
      {/* Фильтры */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-emerald-600" />
              Дозакупка у поставщика
            </h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {brandLabel} · {categoryLabel} · позиций: {filtered.length}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <select
              value={selectedBrand}
              onChange={(e) => setSelectedBrand(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white cursor-pointer focus:ring-2 focus:ring-emerald-500"
            >
              {brands.map((b) => (
                <option key={b} value={b}>
                  {b === 'all' ? 'Все бренды' : `Бренд: ${b}`}
                </option>
              ))}
            </select>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white cursor-pointer focus:ring-2 focus:ring-emerald-500"
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c === 'all' ? 'Все категории' : `Категория: ${c}`}
                </option>
              ))}
            </select>
            <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer px-2">
              <input
                type="checkbox"
                checked={onlyToPurchase}
                onChange={(e) => setOnlyToPurchase(e.target.checked)}
                className="rounded border-gray-300"
              />
              Только требующие закупки
            </label>
            <button
              onClick={handleExport}
              disabled={exporting || stats.toPurchase === 0}
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Выгрузить заявку поставщику в XLSX (с учётом фильтров)"
            >
              <Download className="w-4 h-4" />
              {exporting ? 'Формируем…' : 'Заявка в XLSX'}
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-start gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-gray-400" />
          <p>
            Норматив: {MIN_PER_STORE} шт. на возящий магазин на размер. Перед закупкой дефицит
            проверяется на покрытие <b>перемещением</b> (со склада или из переизбытка магазинов) —
            в заявку попадает только то, что реально нужно заказать. Срочность: <b>критично</b> —
            товара нет совсем; <b>срочно</b> — покрытие &lt; 50% или половина размеров с нулём.
          </p>
        </div>
      </div>

      {/* KPI по выборке */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-red-50 rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-red-700">{stats.critical}</div>
          <div className="text-xs text-red-600">Критичных</div>
        </div>
        <div className="bg-orange-50 rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-orange-700">{stats.high}</div>
          <div className="text-xs text-orange-600">Срочных</div>
        </div>
        <div className="bg-blue-50 rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-blue-700">{stats.toPurchase}</div>
          <div className="text-xs text-blue-600">К заказу, шт.</div>
        </div>
        <div className="bg-purple-50 rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-purple-700">{stats.transferCover}</div>
          <div className="text-xs text-purple-600">
            <Truck className="w-3 h-3 inline" /> Покроем перемещением
          </div>
        </div>
        <div className="bg-emerald-50 rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-emerald-700">
            {stats.cost > 1000000
              ? `${(stats.cost / 1000000).toFixed(1)}М`
              : `${(stats.cost / 1000).toFixed(0)}к`}
          </div>
          <div className="text-xs text-emerald-600">Сумма заявки, ₽</div>
        </div>
      </div>

      {/* Список позиций */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="space-y-3 max-h-[640px] overflow-y-auto pr-2">
          {visible.map((rec) => {
            const badge = URGENCY_BADGES[rec.urgency];
            const article = productById.get(rec.productId)?.article;
            return (
              <div
                key={rec.productId}
                className={`p-4 rounded-lg border border-gray-100 border-l-4 ${badge.border} hover:shadow-md transition-all`}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <button
                      onClick={() => setSelectedProduct(rec.productId)}
                      className="font-medium text-sm text-gray-800 hover:text-blue-600 hover:underline text-left"
                      title="Открыть карточку товара"
                    >
                      {rec.productName}
                    </button>
                    {rec.productLink && (
                      <a
                        href={rec.productLink}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-1.5 text-gray-400 hover:text-blue-500"
                        title="Открыть на saletennis.com"
                      >
                        <ExternalLink className="w-3 h-3 inline" />
                      </a>
                    )}
                    <div className="text-xs text-gray-500">
                      {rec.brand}
                      {rec.category ? ` · ${rec.category}` : ''}
                      {article ? ` · ${article}` : ''}
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide flex-shrink-0 ${badge.color}`}
                  >
                    {badge.label}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5 mb-2">
                  {rec.sizes.map((s) => (
                    <span
                      key={s.size}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border ${
                        s.toPurchase > 0
                          ? 'bg-gray-100 border-gray-200'
                          : 'bg-purple-50 border-purple-200'
                      }`}
                      title={`Нужно ${s.quantity}${s.transferCover > 0 ? `, из них ${s.transferCover} покрывается перемещением` : ''}`}
                    >
                      <span className="font-medium">{s.size}</span>
                      {s.toPurchase > 0 ? (
                        <span className="text-gray-600">заказ ×{s.toPurchase}</span>
                      ) : (
                        <span className="text-purple-600">перем. ×{s.transferCover}</span>
                      )}
                    </span>
                  ))}
                </div>

                <div className="flex items-center gap-4 text-xs text-gray-600 flex-wrap">
                  <span className="flex items-center gap-1">
                    <Package className="w-3 h-3" />
                    Сейчас: <span className="font-semibold">{rec.currentStock} шт.</span>
                  </span>
                  <span>
                    Покрытие: <span className="font-semibold">{rec.coveragePercent}%</span>
                  </span>
                  {rec.transferCover > 0 && (
                    <span className="flex items-center gap-1 text-purple-600">
                      <Truck className="w-3 h-3" />
                      Перемещением: <b>{rec.transferCover}</b>
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Заказать: <span className="font-bold text-gray-800">{rec.toPurchase} шт.</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {filtered.length > visible.length && (
          <p className="mt-4 text-xs text-gray-500 text-center">
            Показаны первые {visible.length} из {filtered.length} позиций — уточните бренд или
            категорию (выгрузка в XLSX включает весь отфильтрованный список)
          </p>
        )}

        {filtered.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <ShoppingCart className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>По выбранным фильтрам дозакупка не требуется</p>
          </div>
        )}
      </div>

      {selectedProduct && (
        <ProductCardModal productId={selectedProduct} onClose={() => setSelectedProduct(null)} />
      )}
    </div>
  );
}
