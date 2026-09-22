import { Package, AlertTriangle, TrendingUp, DollarSign, Store, BarChart3 } from 'lucide-react';
import { useData, getMetrics, getTransferRecommendations, getRestockRecommendations } from '../context/DataContext';

export function Dashboard() {
  const { data } = useData();
  if (!data) return null;

  const metrics = getMetrics(data);
  const transfers = getTransferRecommendations(data);
  const restocks = getRestockRecommendations(data);

  const criticalRestocks = restocks.filter(r => r.urgency === 'critical').length;
  const highTransfers = transfers.filter(t => t.priority === 'high').length;

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <KPICard
          icon={<Package className="w-5 h-5" />}
          label="Всего товаров"
          value={metrics.totalProducts.toString()}
          sublabel={`${metrics.totalSKUs} SKU`}
          color="blue"
        />
        <KPICard
          icon={<BarChart3 className="w-5 h-5" />}
          label="Общий остаток"
          value={metrics.totalStock.toString()}
          sublabel="единиц"
          color="emerald"
        />
        <KPICard
          icon={<AlertTriangle className="w-5 h-5" />}
          label="Нет в наличии"
          value={`${metrics.outOfStockPercent}%`}
          sublabel={`${metrics.outOfStockSizes} позиций`}
          color="red"
          alert={metrics.outOfStockPercent > 20}
        />
        <KPICard
          icon={<DollarSign className="w-5 h-5" />}
          label="Стоимость остатков"
          value={metrics.totalValue > 1000000 ? `${(metrics.totalValue / 1000000).toFixed(1)}М` : `${(metrics.totalValue / 1000).toFixed(0)}к`}
          sublabel="рублей"
          color="purple"
        />
        <KPICard
          icon={<TrendingUp className="w-5 h-5" />}
          label="Перемещения"
          value={transfers.length.toString()}
          sublabel={`${highTransfers} срочных`}
          color="amber"
        />
        <KPICard
          icon={<Store className="w-5 h-5" />}
          label="Дозакупка"
          value={`${criticalRestocks}`}
          sublabel="критичных позиций"
          color="rose"
          alert={criticalRestocks > 3}
        />
      </div>

      {/* Store Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.storeMetrics.map(store => (
          <div key={store.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-sm text-gray-800 truncate" title={store.name}>{store.name}</h4>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ml-2 ${
                store.outOfStockPercent > 30 ? 'bg-red-100 text-red-700' :
                store.outOfStockPercent > 15 ? 'bg-amber-100 text-amber-700' :
                'bg-emerald-100 text-emerald-700'
              }`}>
                {store.outOfStockPercent}% нет
              </span>
            </div>
            <div className="text-2xl font-bold text-gray-800">{store.totalItems}</div>
            <div className="text-xs text-gray-500 mt-1">единиц в наличии</div>
            <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all ${
                  store.outOfStockPercent > 30 ? 'bg-red-500' :
                  store.outOfStockPercent > 15 ? 'bg-amber-500' :
                  'bg-emerald-500'
                }`}
                style={{ width: `${100 - store.outOfStockPercent}%` }}
              />
            </div>
            <div className="flex justify-between mt-1.5 text-[10px] text-gray-400">
              <span>Заполненность</span>
              <span>{100 - store.outOfStockPercent}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface KPICardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sublabel: string;
  color: string;
  alert?: boolean;
}

function KPICard({ icon, label, value, sublabel, color, alert }: KPICardProps) {
  const colorClasses: Record<string, { bg: string; text: string; icon: string }> = {
    blue: { bg: 'bg-blue-50', text: 'text-blue-700', icon: 'text-blue-500' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'text-emerald-500' },
    red: { bg: 'bg-red-50', text: 'text-red-700', icon: 'text-red-500' },
    purple: { bg: 'bg-purple-50', text: 'text-purple-700', icon: 'text-purple-500' },
    amber: { bg: 'bg-amber-50', text: 'text-amber-700', icon: 'text-amber-500' },
    rose: { bg: 'bg-rose-50', text: 'text-rose-700', icon: 'text-rose-500' },
  };

  const colors = colorClasses[color] || colorClasses.blue;

  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:shadow-md transition-all ${alert ? 'ring-2 ring-red-200' : ''}`}>
      <div className="flex items-center gap-3">
        <div className={`${colors.bg} p-2 rounded-lg`}>
          <div className={colors.icon}>{icon}</div>
        </div>
        <div>
          <div className={`text-xl font-bold ${colors.text}`}>{value}</div>
          <div className="text-xs text-gray-500">{label}</div>
        </div>
      </div>
      <div className="mt-2 text-xs text-gray-400">{sublabel}</div>
    </div>
  );
}
