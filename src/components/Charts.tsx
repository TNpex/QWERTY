import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { getMetrics, stores, inventory, products } from '../data/mockData';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export function StoreStockChart() {
  const metrics = getMetrics();
  const data = metrics.storeMetrics.map(s => ({
    name: s.name.replace('SaleTennis ', ''),
    'В наличии': s.totalItems,
    'Нет в наличии': s.outOfStock,
  }));

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">Наличие по магазинам</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip />
          <Legend />
          <Bar dataKey="В наличии" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Нет в наличии" fill="#ef4444" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CategoryChart() {
  const metrics = getMetrics();
  const data = metrics.categoryMetrics.map(c => ({
    name: c.category,
    'В наличии': c.totalItems,
    'Нет в наличии': c.outOfStock,
  }));

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">Наличие по категориям</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis type="number" tick={{ fontSize: 12 }} />
          <YAxis dataKey="name" type="category" tick={{ fontSize: 12 }} width={80} />
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
  const shoeProducts = products.filter(p => p.category === 'Обувь');
  const sizes = ['39', '40', '41', '42', '43', '44', '45'];
  
  const data = sizes.map(size => {
    const total = inventory
      .filter(i => shoeProducts.some(p => p.id === i.productId) && i.size === size)
      .reduce((sum, i) => sum + i.quantity, 0);
    return { size: `${size} р.`, stock: total };
  });

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">Остатки обуви по размерам</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="size" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip />
          <Bar dataKey="stock" name="Остаток" radius={[4, 4, 0, 0]}>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.stock < 5 ? '#ef4444' : entry.stock < 10 ? '#f59e0b' : '#3b82f6'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function StockoutPieChart() {
  const metrics = getMetrics();
  const data = [
    { name: 'В наличии', value: metrics.totalStock },
    { name: 'Нет в наличии', value: metrics.outOfStockSizes },
  ];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">Общий статус наличия</h3>
      <ResponsiveContainer width="100%" height={250}>
        <PieChart>
          <Pie
            data={data}
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
  const data = stores.map(store => {
    const storeItems = inventory.filter(i => i.storeId === store.id);
    const total = storeItems.reduce((sum, i) => sum + i.quantity, 0);
    return {
      name: store.name.replace('SaleTennis ', ''),
      units: total,
    };
  });

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">Сравнение магазинов по объёму</h3>
      <ResponsiveContainer width="100%" height={250}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            outerRadius={90}
            dataKey="units"
            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
          >
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
