import { useMetrics } from '../hooks/useAnalytics';
import { oosLevel } from '../utils/analyticsCore';
import { isWarehouse } from '../utils/storeGroups';
import {
  StoreStockChart,
  CategoryChart,
  SizeDistributionChart,
  StockoutPieChart,
  StoreComparisonChart,
} from './Charts';
import {
  AvailabilityTrendChart,
  StockValueChart,
  AbcCoverageCard,
  DeadStockCard,
  SizeProfileCard,
} from './AnalyticsInsights';

/**
 * Страница «Аналитика»: графики + производные отчёты (динамика доступности,
 * деньги в остатках, ABC, мёртвый запас, размерный профиль, сводка).
 * Вынесена в отдельный модуль, чтобы грузиться ленивым чанком (Recharts
 * не утяжеляет первый экран).
 */
function StoreSummary() {
  const metrics = useMetrics();
  if (!metrics) return null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">Сводка по магазинам</h3>
      <div className="space-y-3">
        {metrics.storeMetrics.map((store) => {
          const warehouse = isWarehouse(store.name);
          const styles = warehouse
            ? { dot: 'bg-blue-500', text: 'text-blue-600' }
            : OOS_LEVEL_STYLES[oosLevel(store.outOfStockPercent)];
          return (
            <div
              key={store.id}
              className={`flex items-center justify-between p-3 rounded-lg ${
                warehouse ? 'bg-blue-50 border border-blue-100' : 'bg-gray-50'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${styles.dot}`} />
                <span className={`font-medium text-sm ${warehouse ? 'text-blue-800' : 'text-gray-700'}`}>
                  {store.name}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-gray-500">Остаток: {store.totalItems} шт.</span>
                <span className={`text-xs font-medium ${styles.text}`}>
                  {store.outOfStockPercent}% нет
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[10px] text-gray-400">
        Доля «нет в наличии» считается только по позициям, которые магазин возит.
      </p>
    </div>
  );
}

const OOS_LEVEL_STYLES = {
  ok: { dot: 'bg-emerald-500', text: 'text-emerald-600' },
  warn: { dot: 'bg-amber-500', text: 'text-amber-600' },
  bad: { dot: 'bg-red-500', text: 'text-red-600' },
} as const;

export function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <StoreStockChart />
        <CategoryChart />
        <SizeDistributionChart />
        <StockoutPieChart />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AvailabilityTrendChart />
        <StockValueChart />
        <AbcCoverageCard />
        <SizeProfileCard />
        <DeadStockCard />
        <StoreSummary />
      </div>
      <StoreComparisonChart />
    </div>
  );
}
