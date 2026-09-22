import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { useData, getMetrics } from '../context/DataContext';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export function StoreStockChart() {
  const { data } = useData();
  if (!data) return null;
  
  const metrics = getMetrics(data);
  const storeData = metrics.storeMetrics.map(s => ({
    name: s.name.length > 20 ? s.name.substring(0, 20) + '...' : s.name,
    fullName: s.name,
    'В наличии': s.totalItems,
    'Нет в наличии': s.outOfStock,
  }));

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">Наличие по магазинам</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={storeData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip formatter={(value: number) => [value, '']} />
          <Legend />
          <Bar dataKey="В наличии" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Нет в наличии" fill="#ef4444" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CategoryChart() {
  const { data } = useData();
  if (!data) return null;
  
  const metrics = getMetrics(data);
  const categoryData = metrics.categoryMetrics.map(c => ({
    name: c.category,
    'В наличии': c.totalItems,
    'Нет в наличии': c.outOfStock,
  }));

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">Наличие по категориям</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={categoryData} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis type="number" tick={{ fontSize: 12 }} />
          <YAxis dataKey="name" type="category" tick={{ fontSize: 12 }} width={100} />
          <Tooltip />
          <Legend />
          <Bar dataKey="В наличии" fill="#10b981" radius={[0, 4, 4, 0]} />
          <Bar dataKey="Нет в наличии" fill="#ef4444" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SizeDistributionChart() {
  const { data } = useData();
  if (!data) return null;
  
  const { products, inventory } = data;
  
  // Получаем все размеры
  const allSizes = [...new Set(inventory.map(i => i.size))].sort((a, b) => {
    const numA = parseInt(a);
    const numB = parseInt(b);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return a.localeCompare(b);
  });
  
  const sizeData = allSizes.map(size => {
    const total = inventory
      .filter(i => i.size === size)
      .reduce((sum, i) => sum + i.quantity, 0);
    return { size: `${size}`, stock: total };
  });

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">Остатки по размерам</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={sizeData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="size" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip />
          <Bar dataKey="stock" name="Остаток" radius={[4, 4, 0, 0]}>
            {sizeData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.stock < 5 ? '#ef4444' : entry.stock < 10 ? '#f59e0b' : '#3b82f6'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function StockoutPieChart() {
  const { data } = useData();
  if (!data) return null;
  
  const metrics = getMetrics(data);
  const pieData = [
    { name: 'В наличии', value: metrics.totalStock },
    { name: 'Нет в наличии', value: metrics.outOfStockSizes },
  ];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">Общий статус наличия</h3>
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
            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
          >
            <Cell fill="#3b82f6" />
            <Cell fill="#ef4444" />
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function StoreComparisonChart() {
  const { data } = useData();
  if (!data) return null;
  
  const { stores, inventory } = data;
  const pieData = stores.map(store => {
    const storeItems = inventory.filter(i => i.storeId === store.id);
    const total = storeItems.reduce((sum, i) => sum + i.quantity, 0);
    return {
      name: store.name.length > 15 ? store.name.substring(0, 15) + '...' : store.name,
      fullName: store.name,
      units: total,
    };
  });

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">Распределение по магазинам</h3>
      <ResponsiveContainer width="100%" height={250}>
        <PieChart>
          <Pie
            data={pieData}
            cx="50%"
            cy="50%"
            outerRadius={90}
            dataKey="units"
            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
          >
            {pieData.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
