import { useMemo, useState } from 'react';
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
import { useFilteredData, useMetrics } from '../hooks/useAnalytics';
import { compareSizes } from '../utils/sizes';
import { shortStoreLabel } from '../utils/storeGroups';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

const CHART_CARD = 'bg-white rounded-xl shadow-sm border border-gray-100 p-6';
const CHART_TITLE = 'text-lg font-semibold text-gray-800 mb-4';
const CHART_NOTE = 'text-[10px] text-gray-400 mt-2';

// Понятные названия серий (раньше было «SKU с нулём» — непонятно пользователю)
const IN_STOCK_LABEL = 'Единиц в наличии';
const OUT_STOCK_LABEL = 'Позиций без наличия';
const POSITION_HINT = 'Позиция = товар × размер × магазин. «Позиций без наличия» — сколько размерных позиций с нулевым остатком.';

/**
 * Темизированные элементы Recharts.
 *
 * Тёмная тема сделана генерируемым CSS-слоем (src/styles/dark.css), а Recharts
 * рисует свои оси/сетку/тултип инлайном. Поэтому:
 * - оси и подписи-легенды берут цвет из `currentColor` (обёртка text-gray-500 —
 *   её тёмный эквивалент уже есть в dark.css);
 * - сетка — currentColor с низкой прозрачностью;
 * - тултип — CSS-переменные --tip-* из index.html (светлые/тёмные значения),
 *   иначе оставалась бы белая плашка посреди тёмного экрана.
 */
const CHART_BODY = 'text-gray-500';
const AXIS_TICK = { fontSize: 11, fill: 'currentColor' } as const;
const AXIS_TICK_SMALL = { fontSize: 10, fill: 'currentColor' } as const;
const GRID_PROPS = { strokeDasharray: '3 3', stroke: 'currentColor', strokeOpacity: 0.15 } as const;
const TIP_CONTENT = {
  backgroundColor: 'var(--tip-bg, #ffffff)',
  border: '1px solid var(--tip-border, #e5e7eb)',
  borderRadius: 8,
  fontSize: 12,
} as const;
const TIP_LABEL = { color: 'var(--tip-text, #111827)', fontWeight: 600 } as const;
const TIP_ITEM = { color: 'var(--tip-text, #374151)' } as const;
const LEGEND_STYLE = { fontSize: 11, color: 'var(--tip-muted, #6b7280)' } as const;

/** Полное название магазина для тултипа (на оси — короткое) */
function fullStoreName(payload: unknown, fallback: string): string {
  const first = Array.isArray(payload) ? payload[0] : undefined;
  const full = (first as { payload?: { fullName?: string } } | undefined)?.payload?.fullName;
  return full ?? fallback;
}

export function StoreStockChart() {
  const metrics = useMetrics();
  if (!metrics) return null;

  const storeData = metrics.storeMetrics.map((s) => ({
    name: shortStoreLabel(s.name),
    fullName: s.name,
    [IN_STOCK_LABEL]: s.totalItems,
    [OUT_STOCK_LABEL]: s.outOfStock,
  }));

  return (
    <div className={CHART_CARD}>
      <h3 className={CHART_TITLE}>Остатки по магазинам</h3>
      <div className={CHART_BODY}>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={storeData}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="name" tick={AXIS_TICK_SMALL} interval={0} />
            <YAxis tick={AXIS_TICK} />
            <Tooltip
              contentStyle={TIP_CONTENT}
              labelStyle={TIP_LABEL}
              itemStyle={TIP_ITEM}
              formatter={(value: number, name: string) => [value, name]}
              labelFormatter={(label, payload) => fullStoreName(payload, String(label))}
            />
            <Legend wrapperStyle={LEGEND_STYLE} />
            <Bar dataKey={IN_STOCK_LABEL} fill="#3b82f6" radius={[4, 4, 0, 0]} />
            <Bar dataKey={OUT_STOCK_LABEL} fill="#ef4444" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className={CHART_NOTE}>
        {POSITION_HINT} Подписи осей — короткие имена точек; полное название — во всплывающей
        подсказке.
      </p>
    </div>
  );
}

export function CategoryChart() {
  const metrics = useMetrics();
  if (!metrics) return null;

  const categoryData = metrics.categoryMetrics.map((c) => ({
    name: c.category,
    [IN_STOCK_LABEL]: c.totalItems,
    [OUT_STOCK_LABEL]: c.outOfStock,
  }));

  return (
    <div className={CHART_CARD}>
      <h3 className={CHART_TITLE}>Остатки по категориям</h3>
      <div className={CHART_BODY}>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={categoryData} layout="vertical">
            <CartesianGrid {...GRID_PROPS} />
            <XAxis type="number" tick={AXIS_TICK} />
            <YAxis dataKey="name" type="category" tick={AXIS_TICK} width={120} />
            <Tooltip
              contentStyle={TIP_CONTENT}
              labelStyle={TIP_LABEL}
              itemStyle={TIP_ITEM}
              formatter={(value: number, name: string) => [value, name]}
            />
            <Legend wrapperStyle={LEGEND_STYLE} />
            <Bar dataKey={IN_STOCK_LABEL} fill="#10b981" radius={[0, 4, 4, 0]} />
            <Bar dataKey={OUT_STOCK_LABEL} fill="#ef4444" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className={CHART_NOTE}>{POSITION_HINT}</p>
    </div>
  );
}

/**
 * Остатки по размерам с переключателем категорий (Обувь / Одежда / ...):
 * размерные сетки обуви и одежды осмысленно смотреть отдельно.
 */
export function SizeDistributionChart() {
  const data = useFilteredData();
  const [selectedCategory, setSelectedCategory] = useState('all');

  const categories = useMemo(() => {
    if (!data) return [];
    // Только категории, у которых есть товары с размерами
    const productCategories = new Map(data.products.map((p) => [p.id, p.category]));
    const withSizes = new Set<string>();
    for (const item of data.inventory) {
      if (item.notCarried || item.size === '—') continue;
      const category = productCategories.get(item.productId);
      if (category) withSizes.add(category);
    }
    return [...withSizes].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [data]);

  const sizeData = useMemo(() => {
    if (!data) return [];
    const productCategories = new Map(data.products.map((p) => [p.id, p.category]));
    const stockBySize = new Map<string, number>();
    for (const item of data.inventory) {
      if (item.notCarried || item.size === '—') continue;
      if (selectedCategory !== 'all' && productCategories.get(item.productId) !== selectedCategory) {
        continue;
      }
      stockBySize.set(item.size, (stockBySize.get(item.size) ?? 0) + item.quantity);
    }
    return [...stockBySize.entries()]
      .sort(([a], [b]) => compareSizes(a, b))
      .map(([size, stock]) => ({ size, stock }));
  }, [data, selectedCategory]);

  if (!data) return null;

  return (
    <div className={CHART_CARD}>
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <h3 className="text-lg font-semibold text-gray-800">Остатки по размерам</h3>
        <div className="flex gap-1.5 flex-wrap">
          {['all', ...categories].map((category) => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                selectedCategory === category
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {category === 'all' ? 'Все' : category}
            </button>
          ))}
        </div>
      </div>
      {sizeData.length === 0 ? (
        <p className="text-sm text-gray-400 py-10 text-center">
          Нет размерных товаров в выбранной категории
        </p>
      ) : (
        <div className={CHART_BODY}>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={sizeData}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis
                dataKey="size"
                tick={AXIS_TICK_SMALL}
                interval={0}
                angle={-35}
                textAnchor="end"
                height={55}
              />
              <YAxis tick={AXIS_TICK} />
              <Tooltip
                contentStyle={TIP_CONTENT}
                labelStyle={TIP_LABEL}
                itemStyle={TIP_ITEM}
                formatter={(value: number) => [value, 'Остаток, шт']}
                labelFormatter={(label) => `Размер ${label}`}
              />
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
      )}
      <p className={CHART_NOTE}>
        Красный — меньше 5 шт на сеть, жёлтый — меньше 10. Товары без размеров («—») не показываются.
      </p>
    </div>
  );
}

export function StockoutPieChart() {
  const metrics = useMetrics();
  if (!metrics) return null;

  // Обе доли в одних единицах — размерные позиции (товар × размер × магазин)
  const inStock = metrics.carriedSKUs - metrics.outOfStockSizes;
  const pieData = [
    { name: 'Позиции в наличии', value: Math.max(0, inStock) },
    { name: 'Позиции без наличия', value: metrics.outOfStockSizes },
  ];
  const total = pieData[0].value + pieData[1].value;
  const percentOf = (value: number) => (total > 0 ? Math.round((value / total) * 100) : 0);

  return (
    <div className={CHART_CARD}>
      <h3 className={CHART_TITLE}>Статус наличия (размерные позиции)</h3>
      <div className={CHART_BODY}>
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
            >
              <Cell fill="#3b82f6" />
              <Cell fill="#ef4444" />
            </Pie>
            <Tooltip
              contentStyle={TIP_CONTENT}
              labelStyle={TIP_LABEL}
              itemStyle={TIP_ITEM}
              formatter={(value: number, name: string) => [
                `${value} поз. (${percentOf(value)}%)`,
                name,
              ]}
            />
            <Legend
              wrapperStyle={LEGEND_STYLE}
              formatter={(value, entry) => {
                const idx = (entry as { payload?: { index?: number } })?.payload?.index ?? 0;
                const row = pieData[idx] ?? pieData[0];
                return `${value} — ${percentOf(row.value)}%`;
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <p className={CHART_NOTE}>
        {POSITION_HINT} Учтены только позиции, которые магазины возят ({metrics.carriedSKUs}
        {metrics.notCarriedSKUs > 0 ? `; вне ассортимента: ${metrics.notCarriedSKUs}` : ''}).
      </p>
    </div>
  );
}

export function StoreComparisonChart() {
  const data = useFilteredData();

  const pieData = useMemo(() => {
    if (!data) return [];
    const totals = new Map<string, number>();
    for (const item of data.inventory) {
      if (item.notCarried) continue;
      totals.set(item.storeId, (totals.get(item.storeId) ?? 0) + item.quantity);
    }
    return data.stores
      .map((store) => {
        const units = totals.get(store.id) ?? 0;
        return {
          name: store.name,
          fullName: store.name,
          units,
        };
      })
      .filter((s) => s.units > 0);
  }, [data]);

  const totalUnits = useMemo(() => pieData.reduce((sum, s) => sum + s.units, 0), [pieData]);

  if (!data) return null;

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
      <div className={CHART_BODY}>
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie data={pieData} cx="50%" cy="50%" outerRadius={90} dataKey="units">
              {pieData.map((_, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={TIP_CONTENT}
              labelStyle={TIP_LABEL}
              itemStyle={TIP_ITEM}
              formatter={(value: number, _name, entry) => {
                const units = Number(value);
                const percent = totalUnits > 0 ? Math.round((units / totalUnits) * 100) : 0;
                void entry;
                return [`${units} шт (${percent}%)`, 'Остаток'];
              }}
              labelFormatter={(label, payload) => fullStoreName(payload, String(label))}
            />
            <Legend
              wrapperStyle={LEGEND_STYLE}
              layout="vertical"
              align="right"
              verticalAlign="middle"
              formatter={(value) => {
                const row = pieData.find((s) => s.name === value);
                const percent = row && totalUnits > 0 ? Math.round((row.units / totalUnits) * 100) : 0;
                return `${shortStoreLabel(String(value))} — ${percent}%`;
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <p className={CHART_NOTE}>
        Доли — в штуках остатка по точкам. Полное название магазина — в подсказке на секторе.
      </p>
    </div>
  );
}
