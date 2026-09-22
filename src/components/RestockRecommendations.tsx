import { ShoppingCart, AlertCircle, Clock, TrendingUp } from 'lucide-react';
import { getRestockRecommendations } from '../data/mockData';

export function RestockRecommendations() {
  const recommendations = getRestockRecommendations();

  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case 'critical': return 'border-l-red-500 bg-red-50/50';
      case 'high': return 'border-l-orange-500 bg-orange-50/50';
      case 'medium': return 'border-l-yellow-500 bg-yellow-50/50';
      default: return 'border-l-gray-300';
    }
  };

  const getUrgencyBadge = (urgency: string) => {
    switch (urgency) {
      case 'critical': return { label: 'Критично', color: 'bg-red-100 text-red-700' };
      case 'high': return { label: 'Срочно', color: 'bg-orange-100 text-orange-700' };
      case 'medium': return { label: 'Запланировать', color: 'bg-yellow-100 text-yellow-700' };
      default: return { label: urgency, color: 'bg-gray-100 text-gray-700' };
    }
  };

  const criticalCount = recommendations.filter(r => r.urgency === 'critical').length;
  const highCount = recommendations.filter(r => r.urgency === 'high').length;
  const totalUnits = recommendations.reduce((sum, r) => sum + r.totalNeeded, 0);
  const estimatedCost = recommendations.reduce((sum, r) => {
    const product = { p1: 8990, p2: 12490, p3: 11990, p4: 24990, p5: 19990, p6: 3490, p7: 2990, p8: 3990, p9: 9990, p10: 8490, p11: 13990, p12: 2790 };
    return sum + (product[r.productId as keyof typeof product] || 0) * r.totalNeeded;
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
          <div className="text-2xl font-bold text-emerald-700">{(estimatedCost / 1000).toFixed(0)}к</div>
          <div className="text-xs text-emerald-600">Оценка, ₽</div>
        </div>
      </div>

      <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
        {recommendations.map((rec, index) => {
          const badge = getUrgencyBadge(rec.urgency);
          return (
            <div key={index} className={`p-4 rounded-lg border border-gray-100 border-l-4 ${getUrgencyColor(rec.urgency)} hover:shadow-md transition-all`}>
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <div className="font-medium text-sm text-gray-800">{rec.productName}</div>
                  <div className="text-xs text-gray-500">{rec.brand}</div>
                </div>
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${badge.color}`}>
                  {badge.label}
                </span>
              </div>
              
              <div className="flex flex-wrap gap-1.5 mb-3">
                {rec.sizes.map(s => (
                  <span key={s.size} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 text-xs">
                    <span className="font-medium">{s.size}</span>
                    <span className="text-gray-500">×{s.quantity}</span>
                  </span>
                ))}
              </div>
              
              <div className="flex items-center gap-4 text-xs text-gray-600">
                <span className="flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" />
                  ~{rec.avgDailySales} шт/день
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {rec.daysUntilStockout} дн. до конца
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
        </div>
      )}
    </div>
  );
}
