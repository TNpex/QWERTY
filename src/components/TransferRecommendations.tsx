import { ArrowRight, AlertTriangle, Package, Info } from 'lucide-react';
import { useTransferRecommendations } from '../hooks/useAnalytics';
import { MAX_TRANSFER_DISPLAY } from '../utils/analyticsCore';

export function TransferRecommendations() {
  const recommendations = useTransferRecommendations();

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'bg-red-50 border-red-200 text-red-800';
      case 'medium':
        return 'bg-amber-50 border-amber-200 text-amber-800';
      case 'low':
        return 'bg-blue-50 border-blue-200 text-blue-800';
      default:
        return 'bg-gray-50 border-gray-200 text-gray-800';
    }
  };

  const getPriorityLabel = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'Высокий';
      case 'medium':
        return 'Средний';
      case 'low':
        return 'Низкий';
      default:
        return priority;
    }
  };

  const highPriority = recommendations.filter((r) => r.priority === 'high').length;
  const medPriority = recommendations.filter((r) => r.priority === 'medium').length;
  const visible = recommendations.slice(0, MAX_TRANSFER_DISPLAY);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <Package className="w-5 h-5 text-blue-600" />
            Рекомендации по перемещению
          </h3>
          <p className="text-sm text-gray-500 mt-1">Куда лучше переместить товар между магазинами</p>
        </div>
        <div className="flex gap-2">
          {highPriority > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
              <AlertTriangle className="w-3 h-3" /> {highPriority} срочных
            </span>
          )}
          {medPriority > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
              {medPriority} средних
            </span>
          )}
        </div>
      </div>

      <div className="mb-4 flex items-start gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-gray-400" />
        <p>
          Учитываются только магазины, которые возят товар. Донор оставляет себе запас не ниже
          среднего по сети, каждое перемещение — не более 3 единиц, один и тот же остаток не
          распределяется дважды.
        </p>
      </div>

      <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
        {visible.map((rec) => (
          <div
            key={`${rec.productId}|${rec.size}|${rec.fromStore}|${rec.toStore}`}
            className={`p-4 rounded-lg border ${getPriorityColor(rec.priority)} transition-all hover:shadow-md`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="font-medium text-sm mb-1">{rec.productName}</div>
                <div className="text-xs opacity-80 mb-2">
                  Размер: <span className="font-semibold">{rec.size}</span> | Количество:{' '}
                  <span className="font-semibold">{rec.quantity} шт.</span>
                </div>
                <div className="flex items-center gap-2 text-xs flex-wrap">
                  <span className="font-medium bg-white/60 px-2 py-0.5 rounded">{rec.fromStore}</span>
                  <ArrowRight className="w-3 h-3" />
                  <span className="font-medium bg-white/60 px-2 py-0.5 rounded">{rec.toStore}</span>
                </div>
                <div className="text-xs mt-2 opacity-70 italic">{rec.reason}</div>
              </div>
              <div className="flex-shrink-0">
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${
                    rec.priority === 'high'
                      ? 'bg-red-200 text-red-800'
                      : rec.priority === 'medium'
                        ? 'bg-amber-200 text-amber-800'
                        : 'bg-blue-200 text-blue-800'
                  }`}
                >
                  {getPriorityLabel(rec.priority)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {recommendations.length > visible.length && (
        <p className="mt-4 text-xs text-gray-500 text-center">
          Показаны первые {visible.length} из {recommendations.length} рекомендаций (отсортированы
          по приоритету)
        </p>
      )}

      {recommendations.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          <Package className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p>Нет рекомендаций по перемещению</p>
          <p className="text-xs mt-1">Все размеры равномерно распределены по магазинам</p>
        </div>
      )}
    </div>
  );
}
