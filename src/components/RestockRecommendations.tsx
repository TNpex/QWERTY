import { useMemo, useState } from 'react';
import {
  ShoppingCart,
  AlertCircle,
  Info,
  Package,
  Download,
  ExternalLink,
} from 'lucide-react';
import { useFilteredData, useRestockRecommendations } from '../hooks/useAnalytics';
import { MAX_RESTOCK_DISPLAY } from '../utils/analyticsCore';
import { GENDER_LABELS, DEFAULT_MINIMUM } from '../utils/productMeta';
import { ProductCardModal } from './ProductCardModal';
import type { RestockUrgency } from '../types';

const URGENCY_BADGES: Record<RestockUrgency, { label: string; color: string; border: string }> = {
  critical: { label: 'Критично', color: 'bg-red-100 text-red-700', border: 'border-l-red-500 bg-red-50/50' },
  high: { label: 'Срочно', color: 'bg-orange-100 text-orange-700', border: 'border-l-orange-500 bg-orange-50/50' },
  medium: { label: 'Запланировать', color: 'bg-yellow-100 text-yellow-700', border: 'border-l-yellow-500 bg-yellow-50/50' },
};

interface ExportRow {
  article: string;
  name: string;
  brand: string;
  category: string;
  gender: string;
  size: string;
  current: number;
  target: number;
  toOrder: number;
  price: number;
}

/** Выгрузка заявки поставщику в XLSX — построчно по размерам (с учётом фильтров) */
async function exportOrderXlsx(rows: ExportRow[], label: string) {
  const XLSX = await import('xlsx');
  const sheetRows = rows.map((r) => ({
    'Артикул': r.article,
    'Название': r.name,
    'Бренд': r.brand,
    'Категория': r.category,
    'Пол': r.gender,
    'Размер': r.size,
    'В наличии (сеть)': r.current,
    'Норматив (сеть)': r.target,
    'Заказать, шт.': r.toOrder,
    'Цена, ₽': r.price,
    'Сумма, ₽': Math.round(r.price * r.toOrder),
  }));
  const worksheet = XLSX.utils.json_to_sheet(sheetRows);
  worksheet['!cols'] = [
    { wch: 14 }, { wch: 52 }, { wch: 12 }, { wch: 18 }, { wch: 10 },
    { wch: 9 }, { wch: 15 }, { wch: 15 }, { wch: 13 }, { wch: 10 }, { wch: 12 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Заявка');
  const safeLabel = label.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 40);
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `Заявка_${safeLabel}_${date}.xlsx`);
}

export function RestockRecommendations() {
  const data = useFilteredData();
  const recommendations = useRestockRecommendations();
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const productById = useMemo(
    () => new Map((data?.products ?? []).map((p) => [p.id, p])),
    [data]
  );

  // KPI и сумма — по текущей выборке (глобальные фильтры бренд/категория/пол)
  const stats = useMemo(() => {
    let critical = 0;
    let high = 0;
    let toPurchase = 0;
    let sizesCount = 0;
    let cost = 0;
    for (const r of recommendations) {
      if (r.urgency === 'critical') critical++;
      if (r.urgency === 'high') high++;
      toPurchase += r.toPurchase;
      sizesCount += r.sizes.length;
      cost += (productById.get(r.productId)?.price ?? 0) * r.toPurchase;
    }
    return { critical, high, toPurchase, sizesCount, cost };
  }, [recommendations, productById]);

  if (!data) return null;

  const visible = recommendations.slice(0, MAX_RESTOCK_DISPLAY);

  const filterLabel = [
    data.products.length > 0 ? new Set(data.products.map((p) => p.brand)).size === 1
      ? [...new Set(data.products.map((p) => p.brand))][0]
      : null
      : null,
    new Set(data.products.map((p) => p.category)).size === 1
      ? [...new Set(data.products.map((p) => p.category))][0]
      : null,
  ]
    .filter(Boolean)
    .join('_') || 'все_бренды';

  const handleExport = async () => {
    setExporting(true);
    try {
      const rows: ExportRow[] = [];
      for (const r of recommendations) {
        const product = productById.get(r.productId);
        for (const s of r.sizes) {
          if (s.quantity <= 0) continue;
          rows.push({
            article: product?.article ?? '',
            name: r.productName,
            brand: r.brand,
            category: r.category,
            gender: GENDER_LABELS[r.gender] ?? '',
            size: s.size,
            current: s.current,
            target: s.target,
            toOrder: s.quantity,
            price: product?.price ?? 0,
          });
        }
      }
      await exportOrderXlsx(rows, filterLabel);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Показываются только товары, отмеченные «Поставляется» */}
      <div className="bg-sky-50 border border-sky-200 rounded-xl px-4 py-2.5 text-xs text-sky-800">
        Здесь только товары, отмеченные <b>«Поставляется»</b> в карточке товара (ходовые из
        hot-products.json добавляются автоматически). Большинство позиций закупается разово —
        отмечайте те, которые поставщик возит регулярно.
        {recommendations.length === 0 && (
          <span className="block mt-1 font-semibold">
            Пока ни один товар не отмечен — откройте карточку товара (клик по названию в
            «Инвентаре») и нажмите «Не поставляется → Поставляется».
          </span>
        )}
      </div>

      {/* Шапка и действия */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-emerald-600" />
              Дозакупка у поставщика
            </h3>
            <p className="text-sm text-gray-500 mt-0.5">
              Позиций: {recommendations.length} · к заказу: {stats.toPurchase} шт.
              (фильтры по бренду/категории/полу — в панели сверху)
            </p>
          </div>
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

        <div className="mt-3 flex items-start gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-gray-400" />
          <p>
            Нормативы остатка <b>на размер по всей сети</b> (включая склад): женская одежда —
            XXS 3, XS 4, <b>S 11, M 11</b>, L 3, XL 0; мужская — XS 1, S 4, <b>M 12, L 13</b>, XL 8;
            детская — XS 4, S 6, M 7, L 6, XL 4; женская обувь — 35:4 … 39:10, 40:8; мужская обувь —
            41:8 … 43:11 … 47:1. Неизвестный пол или уникальный размер (сет, банка, ростовка и т.п.) —
            минимум {DEFAULT_MINIMUM}. Срочность: <b>критично</b> — товара нет совсем;{' '}
            <b>срочно</b> — покрытие нормативов &lt; 50%.
          </p>
        </div>
      </div>

      {/* KPI по выборке */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
          <div className="text-xs text-blue-600">К заказу, шт. ({stats.sizesCount} размеров)</div>
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
                      {rec.brand} · {rec.category} · {GENDER_LABELS[rec.gender]}
                      {article ? ` · ${article}` : ''}
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide flex-shrink-0 ${badge.color}`}
                  >
                    {badge.label}
                  </span>
                </div>

                {/* Размеры: сколько есть / норматив / заказать */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {rec.sizes.map((s) => (
                    <span
                      key={s.size}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-gray-100 border border-gray-200"
                      title={`Размер ${s.size}: есть ${s.current}, норматив ${s.target}, заказать ${s.quantity}`}
                    >
                      <span className="font-bold">{s.size}</span>
                      <span className="text-gray-500">
                        {s.current}/{s.target}
                      </span>
                      <span className="font-bold text-emerald-700">+{s.quantity}</span>
                    </span>
                  ))}
                </div>

                <div className="flex items-center gap-4 text-xs text-gray-600 flex-wrap">
                  <span className="flex items-center gap-1">
                    <Package className="w-3 h-3" />
                    Сейчас в сети: <span className="font-semibold">{rec.currentStock} шт.</span>
                  </span>
                  <span>
                    Покрытие норматива:{' '}
                    <span className="font-semibold">{rec.coveragePercent}%</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Заказать: <span className="font-bold text-gray-800">{rec.toPurchase} шт.</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {recommendations.length > visible.length && (
          <p className="mt-4 text-xs text-gray-500 text-center">
            Показаны первые {visible.length} из {recommendations.length} позиций — уточните фильтры
            сверху (выгрузка в XLSX включает весь список)
          </p>
        )}

        {recommendations.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <ShoppingCart className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>По выбранной выборке дозакупка не требуется</p>
          </div>
        )}
      </div>

      {selectedProduct && (
        <ProductCardModal productId={selectedProduct} onClose={() => setSelectedProduct(null)} />
      )}
    </div>
  );
}
