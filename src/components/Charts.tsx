import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { useData } from '../context/DataContext';
import { useMetrics } from '../hooks/useAnalytics';
import { compareSizes } from '../utils/sizes';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

const CHART_CARD = 'bg-white rounded-xl shadow-sm border border-gray-100 p-6';
const CHART_TITLE = 'text-lg font-semibold text-gray-800 mb-4';

export function StoreStockChart() {
  const metrics = useMetrics();
  if (!metrics) return null;

  const storeData = metrics.storeMetrics.map((s) => ({
    name: s.name.length > 20 ? s.name.substring(0, 20) + '...' : s.name,
    fullName: s.name,
    'Единиц в наличии': s.totalItems,
    'SKU с нулём': s.outOfStock,
  }));

  return (
    <div className={CHART_CARD}>
      <h3 className={CHART_TITLE}>Остатки по магазинам</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={storeData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip
            formatter={(value: number, name: string) => [value, name]}
            labelFormatter={(_label, payload) =>
              payload?.[0]?.payload?.fullName ?? String(_label)
            }
          />
          <Legend />
          <Bar dataKey="Единиц в наличии" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          <Bar dataKey="SKU с нулём" fill="#ef4444" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CategoryChart() {
  const metrics = useMetrics();
  if (!metrics) return null;

  const categoryData = metrics.categoryMetrics.map((c) => ({
    name: c.category,
    'Единиц в наличии': c.totalItems,
    'SKU с нулём': c.outOfStock,
  }));

  return (
    <div className={CHART_CARD}>
      <h3 className={CHART_TITLE}>Остатки по категориям</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={categoryData} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis type="number" tick={{ fontSize: 12 }} />
          <YAxis dataKey="name" type="category" tick={{ fontSize: 12 }} width={120} />
          <Tooltip formatter={(value: number, name: string) => [value, name]} />
          <Legend />
          <Bar dataKey="Единиц в наличии" fill="#10b981" radius={[0, 4, 4, 0]} />
          <Bar dataKey="SKU с нулём" fill="#ef4444" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SizeDistributionChart() {
  const { data } = useData();
  if (!data) return null;

  // Агрегация за один проход; служебный размер «—» (без размеров) исключаем
  const stockBySize = new Map<string, number>();
  for (const item of data.inventory) {
    if (item.notCarried || item.size === '—') continue;
    stockBySize.set(item.size, (stockBySize.get(item.size) ?? 0) + item.quantity);
  }

  const sizeData = [...stockBySize.entries()]
    .sort(([a], [b]) => compareSizes(a, b))
    .map(([size, stock]) => ({ size, stock }));

  if (sizeData.length === 0) {
    return (
      <div className={CHART_CARD}>
        <h3 className={CHART_TITLE}>Остатки по размерам</h3>
        <p className="text-sm text-gray-400 py-10 text-center">
          В загруженных данных нет размерной сетки
        </p>
      </div>
    );
  }

  return (
    <div className={CHART_CARD}>
      <h3 className={CHART_TITLE}>Остатки по размерам</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={sizeData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="size" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip formatter={(value: number) => [value, 'Остаток, шт']} />
          <Bar dataKey="stock" name="Остаток" radius={[4, 4, 0, 0]}>
            {sizeData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.stock < 5 ? '#ef4444' : entry.stock < 10 ? '#f59e0b' : '#3b82f6'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function StockoutPieChart() {
  const metrics = useMetrics();
  if (!metrics) return null;

  // Обе доли в одних единицах — SKU-позиции (раньше смешивались штуки и позиции)
  const inStock = metrics.carriedSKUs - metrics.outOfStockSizes;
  const pieData = [
    { name: 'SKU в наличии', value: Math.max(0, inStock) },
    { name: 'SKU без наличия', value: metrics.outOfStockSizes },
  ];

  return (
    <div className={CHART_CARD}>
      <h3 className={CHART_TITLE}>Общий статус наличия (SKU)</h3>
      <ResponsiveContainer width="100%" height={250}>
        <PieChart>
          <Pie
            data={pieData}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={5}
            dataKey="value"
            label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
          >
            <Cell fill="#3b82f6" />
            <Cell fill="#ef4444" />
          </Pie>
          <Tooltip formatter={(value: number, name: string) => [`${value} поз.`, name]} />
        </PieChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-gray-400 mt-2 text-center">
        Учитываются только позиции, которые магазины возят ({metrics.carriedSKUs} SKU
        {metrics.notCarriedSKUs > 0 ? `, вне ассортимента: ${metrics.notCarriedSKUs}` : ''})
      </p>
    </div>
  );
}

export function StoreComparisonChart() {
  const { data } = useData();
  if (!data) return null;

  // Агрегация за один проход
  const totals = new Map<string, number>();
  for (const item of data.inventory) {
    if (item.notCarried) continue;
    totals.set(item.storeId, (totals.get(item.storeId) ?? 0) + item.quantity);
  }

  const pieData = data.stores
    .map((store) => {
      const units = totals.get(store.id) ?? 0;
      return {
        name: store.name.length > 15 ? store.name.substring(0, 15) + '...' : store.name,
        fullName: store.name,
        units,
      };
    })
    .filter((s) => s.units > 0);

  if (pieData.length === 0) {
    return (
      <div className={CHART_CARD}>
        <h3 className={CHART_TITLE}>Распределение по магазинам</h3>
        <p className="text-sm text-gray-400 py-10 text-center">Нет данных об остатках</p>
      </div>
    );
  }

  return (
    <div className={CHART_CARD}>
      <h3 className={CHART_TITLE}>Распределение запасов по магазинам</h3>
      <ResponsiveContainer width="100%" height={250}>
        <PieChart>
          <Pie
            data={pieData}
            cx="50%"
            cy="50%"
            outerRadius={90}
            dataKey="units"
            label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
          >
            {pieData.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: number) => [`${value} шт`, 'Остаток']}
            labelFormatter={(_label, payload) =>
              payload?.[0]?.payload?.fullName ?? String(_label)
            }
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
