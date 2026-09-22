import { ShoppingCart, AlertCircle, Info, Package } from 'lucide-react';
import { useData } from '../context/DataContext';
import { useRestockRecommendations } from '../hooks/useAnalytics';
import { MIN_PER_STORE } from '../utils/analyticsCore';
import type { RestockUrgency } from '../types';

export function RestockRecommendations() {
  const { data } = useData();
  const recommendations = useRestockRecommendations();

  if (!data) return null;

  const getUrgencyColor = (urgency: RestockUrgency) => {
    switch (urgency) {
      case 'critical':
        return 'border-l-red-500 bg-red-50/50';
      case 'high':
        return 'border-l-orange-500 bg-orange-50/50';
      case 'medium':
        return 'border-l-yellow-500 bg-yellow-50/50';
    }
  };

  const getUrgencyBadge = (urgency: RestockUrgency) => {
    switch (urgency) {
      case 'critical':
        return { label: 'Критично', color: 'bg-red-100 text-red-700' };
      case 'high':
        return { label: 'Срочно', color: 'bg-orange-100 text-orange-700' };
      case 'medium':
        return { label: 'Запланировать', color: 'bg-yellow-100 text-yellow-700' };
    }
  };

  const criticalCount = recommendations.filter((r) => r.urgency === 'critical').length;
  const highCount = recommendations.filter((r) => r.urgency === 'high').length;
  const totalUnits = recommendations.reduce((sum, r) => sum + r.totalNeeded, 0);

  const productById = new Map(data.products.map((p) => [p.id, p]));
  const estimatedCost = recommendations.reduce((sum, r) => {
    const price = productById.get(r.productId)?.price ?? 0;
    return sum + price * r.totalNeeded;
  }, 0);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-emerald-600" />
            Рекомендации по дозакупке
          </h3>
          <p className="text-sm text-gray-500 mt-1">Какие товары нужно закупить у поставщика</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-red-50 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-red-700">{criticalCount}</div>
          <div className="text-xs text-red-600">Критичных</div>
        </div>
        <div className="bg-orange-50 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-orange-700">{highCount}</div>
          <div className="text-xs text-orange-600">Срочных</div>
        </div>
        <div className="bg-blue-50 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-blue-700">{totalUnits}</div>
          <div className="text-xs text-blue-600">Единиц нужно</div>
        </div>
        <div className="bg-emerald-50 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-emerald-700">
            {estimatedCost > 1000000
              ? `${(estimatedCost / 1000000).toFixed(1)}М`
              : `${(estimatedCost / 1000).toFixed(0)}к`}
          </div>
          <div className="text-xs text-emerald-600">Оценка, ₽</div>
        </div>
      </div>

      {/* Методология — детерминированная, без случайных чисел */}
      <div className="mb-4 flex items-start gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-gray-400" />
        <p>
          Норматив запаса: {MIN_PER_STORE} шт. на каждый возящий магазин на размер. Срочность:{' '}
          <b>критично</b> — товара нет совсем; <b>срочно</b> — покрытие норматива &lt; 50% или
          более половины размеров с нулём; иначе — <b>запланировать</b>. Прогноз дней до исчерпания
          появится после подключения истории продаж.
        </p>
      </div>

      <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
        {recommendations.map((rec) => {
          const badge = getUrgencyBadge(rec.urgency);
          return (
            <div
              key={rec.productId}
              className={`p-4 rounded-lg border border-gray-100 border-l-4 ${getUrgencyColor(rec.urgency)} hover:shadow-md transition-all`}
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <div className="font-medium text-sm text-gray-800">{rec.productName}</div>
                  <div className="text-xs text-gray-500">{rec.brand}</div>
                </div>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${badge.color}`}
                >
                  {badge.label}
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5 mb-3">
                {rec.sizes.map((s) => (
                  <span
                    key={s.size}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 text-xs"
                  >
                    <span className="font-medium">{s.size}</span>
                    <span className="text-gray-500">×{s.quantity}</span>
                  </span>
                ))}
              </div>

              <div className="flex items-center gap-4 text-xs text-gray-600 flex-wrap">
                <span className="flex items-center gap-1">
                  <Package className="w-3 h-3" />
                  Сейчас: <span className="font-semibold">{rec.currentStock} шт.</span>
                </span>
                <span className="flex items-center gap-1">
                  Покрытие: <span className="font-semibold">{rec.coveragePercent}%</span>
                </span>
                <span className="flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  Нужно: <span className="font-bold">{rec.totalNeeded} шт.</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {recommendations.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          <ShoppingCart className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p>Все товары в наличии</p>
          <p className="text-xs mt-1">Дозакупка не требуется</p>
        </div>
      )}
    </div>
  );
}
