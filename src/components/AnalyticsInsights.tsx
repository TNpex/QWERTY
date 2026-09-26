import { useMemo, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import {
  CartesianGrid,
  Bar,
  BarChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  useAbcClasses,
  useAvailabilityTrend,
  useFilteredData,
  useHistorySales,
  useSizeSalesReport,
} from '../hooks/useAnalytics';
import { deadStock, sizeProfile, stockValueByStore, type AbcClass } from '../utils/insights';
import { isWarehouse, shortStoreLabel, sortStoresForDisplay } from '../utils/storeGroups';
import { useStoreScope } from '../hooks/useStoreScope';
import { ALL_SCOPE } from '../utils/storeScope';

/**
 * Дополнительные аналитические карточки вкладки «Аналитика»:
 * динамика доступности, деньги в остатках, ABC-покрытие, мёртвый запас
 * (с выгрузкой XLSX) и размерный профиль точки.
 */

const CARD = 'bg-white rounded-xl shadow-sm border border-gray-100 p-6';
const TITLE = 'text-lg font-semibold text-gray-800 mb-4';
const NOTE = 'text-[10px] text-gray-400 mt-2';
const CHART_BODY = 'text-gray-500';
const AXIS_TICK = { fontSize: 11, fill: 'currentColor' } as const;
const GRID_PROPS = { strokeDasharray: '3 3', stroke: 'currentColor', strokeOpacity: 0.15 } as const;
const TIP_CONTENT = {
  backgroundColor: 'var(--tip-bg, #ffffff)',
  border: '1px solid var(--tip-border, #e5e7eb)',
  borderRadius: 8,
  fontSize: 12,
} as const;
const TIP_LABEL = { color: 'var(--tip-text, #111827)', fontWeight: 600 } as const;
const TIP_ITEM = { color: 'var(--tip-text, #374151)' } as const;

/** Динамика доли нулевых позиций: сеть или выбранный магазин */
export function AvailabilityTrendChart() {
  const trend = useAvailabilityTrend();
  const data = useFilteredData();
  const [store, setStore] = useState<string>('network');

  const stores = useMemo(() => (data ? sortStoresForDisplay(data.stores) : []), [data]);

  if (trend.length < 2) {
    return (
      <div className={CARD}>
        <h3 className={TITLE}>Динамика доступности</h3>
        <p className="text-sm text-gray-400 py-10 text-center">
          Нужно минимум два снимка остатков — история ещё накапливается.
        </p>
      </div>
    );
  }

  const series = trend.map((point) => ({
    date: point.date.slice(5), // ММ-ДД — короче и читабельнее на оси
    fullDate: point.date,
    'Нет в наличии, %': store === 'network' ? point.networkOosPercent : (point.byStore[store] ?? 0),
  }));

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <h3 className="text-lg font-semibold text-gray-800">Динамика доступности</h3>
        <select
          value={store}
          onChange={(e) => setStore(e.target.value)}
          className="px-2 py-1 text-xs border border-gray-200 rounded-lg bg-white text-gray-600"
        >
          <option value="network">Вся сеть</option>
          {stores.map((s) => (
            <option key={s.id} value={s.name}>
              {shortStoreLabel(s.name)} — {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className={CHART_BODY}>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={series}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="date" tick={AXIS_TICK} />
            <YAxis tick={AXIS_TICK} unit="%" />
            <Tooltip
              contentStyle={TIP_CONTENT}
              labelStyle={TIP_LABEL}
              itemStyle={TIP_ITEM}
              formatter={(value: number) => [`${value}%`, 'Нет в наличии']}
              labelFormatter={(_label, payload) =>
                `Снимок ${(payload?.[0]?.payload as { fullDate?: string } | undefined)?.fullDate ?? _label}`
              }
            />
            <Line
              type="monotone"
              dataKey="Нет в наличии, %"
              stroke="#ef4444"
              strokeWidth={2}
              dot={{ r: 2, fill: '#ef4444' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className={NOTE}>
        Доля размерных позиций с нулевым остатком среди тех, что точка возит. Рост линии = полки
        пустеют. Снимки: {trend[0].date} … {trend[trend.length - 1].date}.
      </p>
    </div>
  );
}

/** Деньги, замороженные в остатках, по магазинам */
export function StockValueChart() {
  const data = useFilteredData();
  const rows = useMemo(() => (data ? stockValueByStore(data) : []), [data]);
  if (!data) return null;

  const chartData = rows
    .filter((r) => r.value > 0)
    .map((r) => ({
      name: shortStoreLabel(r.name),
      fullName: r.name,
      'Стоимость запасов, тыс ₽': Math.round(r.value / 1000),
      units: r.units,
    }));

  return (
    <div className={CARD}>
      <h3 className={TITLE}>Деньги в остатках</h3>
      <div className={CHART_BODY}>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData} layout="vertical">
            <CartesianGrid {...GRID_PROPS} />
            <XAxis type="number" tick={AXIS_TICK} />
            <YAxis dataKey="name" type="category" tick={AXIS_TICK} width={60} />
            <Tooltip
              contentStyle={TIP_CONTENT}
              labelStyle={TIP_LABEL}
              itemStyle={TIP_ITEM}
              formatter={(value: number, _name, entry) => {
                const row = (entry as { payload?: { fullName?: string; units?: number } })?.payload;
                return [
                  `${Number(value).toLocaleString('ru-RU')} тыс ₽ (${row?.units ?? 0} шт)`,
                  row?.fullName ?? '',
                ];
              }}
            />
            <Bar dataKey="Стоимость запасов, тыс ₽" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className={NOTE}>
        Цена × количество по каждой точке (вне ассортимента не считается). Помогает видеть, где
        оборот заморожен в полке, а не в кассе.
      </p>
    </div>
  );
}

/** ABC-классы: покрытие запасом товаров, дающих выручку */
export function AbcCoverageCard() {
  const data = useFilteredData();
  const sales = useHistorySales();
  const abc = useAbcClasses();

  const stats = useMemo(() => {
    if (!data || !sales) return null;
    const linkById = new Map(data.products.map((p) => [p.id, p.link ?? '']));
    const counters: Record<AbcClass, { products: number; sold: number; carried: number; inStock: number }> = {
      A: { products: 0, sold: 0, carried: 0, inStock: 0 },
      B: { products: 0, sold: 0, carried: 0, inStock: 0 },
      C: { products: 0, sold: 0, carried: 0, inStock: 0 },
    };
    for (const product of data.products) {
      const cls = linkById.get(product.id) ? abc.get(linkById.get(product.id)!) : undefined;
      if (!cls) continue;
      counters[cls].products += 1;
      counters[cls].sold += sales.byProduct.get(linkById.get(product.id)!)?.total ?? 0;
    }
    for (const item of data.inventory) {
      if (item.notCarried) continue;
      const product = data.products.find((p) => p.id === item.productId);
      const link = product?.link ?? '';
      const cls = link ? abc.get(link) : undefined;
      if (!cls) continue;
      counters[cls].carried += 1;
      if (item.quantity > 0) counters[cls].inStock += 1;
    }
    const totalSold = counters.A.sold + counters.B.sold + counters.C.sold;
    return { counters, totalSold };
  }, [data, sales, abc]);

  if (!stats) {
    return (
      <div className={CARD}>
        <h3 className={TITLE}>ABC-анализ запасов</h3>
        <p className="text-sm text-gray-400 py-10 text-center">
          Классы считаются по продажам из снимков — нужно минимум два снимка истории.
        </p>
      </div>
    );
  }

  const DESCRIPTION: Record<AbcClass, string> = {
    A: 'дают 80% продаж — должны быть на полке всегда',
    B: 'следующие 15% продаж',
    C: 'хвост ассортимента и товары без продаж',
  };

  return (
    <div className={CARD}>
      <h3 className={TITLE}>ABC-анализ запасов</h3>
      <div className="space-y-2">
        {(['A', 'B', 'C'] as AbcClass[]).map((cls) => {
          const c = stats.counters[cls];
          const coverage = c.carried > 0 ? Math.round((c.inStock / c.carried) * 100) : 0;
          const soldShare = stats.totalSold > 0 ? Math.round((c.sold / stats.totalSold) * 100) : 0;
          return (
            <div key={cls} className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2">
              <span
                className={`w-7 h-7 flex-shrink-0 rounded-lg flex items-center justify-center text-sm font-bold ${
                  cls === 'A'
                    ? 'bg-emerald-100 text-emerald-700'
                    : cls === 'B'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-gray-200 text-gray-600'
                }`}
              >
                {cls}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-gray-700">
                  {c.products} тов. · {soldShare}% продаж · покрытие запасом {coverage}%
                </div>
                <div className="text-[10px] text-gray-400">{DESCRIPTION[cls]}</div>
              </div>
              <div className="w-24 h-2 rounded-full bg-gray-200 overflow-hidden flex-shrink-0">
                <div
                  className={`h-full ${cls === 'A' ? 'bg-emerald-500' : cls === 'B' ? 'bg-amber-500' : 'bg-gray-400'}`}
                  style={{ width: `${coverage}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <p className={NOTE}>
        Покрытие = доля возимых позиций класса с остатком &gt; 0. Провал покрытия у класса A —
        прямой повод для «Перемещений» и «Дозакупки».
      </p>
    </div>
  );
}

/** Мёртвый запас: лежит без продаж дольше порога — кандидат на скидку/перемещение */
export function DeadStockCard() {
  const data = useFilteredData();
  const sales = useHistorySales();
  const [exporting, setExporting] = useState(false);

  const rows = useMemo(() => {
    if (!data) return [];
    const toDate = sales?.toDate ?? data.asOf ?? new Date().toISOString().slice(0, 10);
    return deadStock(data, sales, toDate);
  }, [data, sales]);

  if (!data) return null;

  const totalValue = rows.reduce((sum, r) => sum + r.value, 0);

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const sheetRows = rows.map((r) => ({
        'Товар': r.product.name,
        'Бренд': r.product.brand,
        'Артикул': r.product.article ?? '',
        'Остаток, шт': r.quantity,
        'Стоимость, ₽': r.value,
        'Дней без продаж': r.daysSinceSale ?? 'не продавался в окне истории',
        'Последняя продажа': r.lastSaleDate ?? '',
      }));
      const worksheet = XLSX.utils.json_to_sheet(sheetRows);
      worksheet['!cols'] = [
        { wch: 48 },
        { wch: 14 },
        { wch: 14 },
        { wch: 12 },
        { wch: 14 },
        { wch: 20 },
        { wch: 18 },
      ];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Мёртвый запас');
      XLSX.writeFile(workbook, `dead-stock-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-2 mb-4">
        <h3 className="text-lg font-semibold text-gray-800">Мёртвый запас</h3>
        {rows.length > 0 && (
          <button
            onClick={exportXlsx}
            disabled={exporting}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-60"
            title="Скачать полный список мёртвого запаса в XLSX"
          >
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            XLSX
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400 py-10 text-center">
        Мёртвого запаса нет: у всех позиций с остатком были продажи за окно истории.
        </p>
      ) : (
        <>
          <div className="text-xs text-gray-600 mb-3">
            {rows.length} позиций с остатком без продаж ≥ 60 дней · заморожено{' '}
            <b className="text-gray-800">{totalValue.toLocaleString('ru-RU')} ₽</b>
          </div>
          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {rows.slice(0, 30).map((r) => (
              <div
                key={r.product.id}
                className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-1.5 text-xs"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-700 truncate" title={r.product.name}>
                    {r.product.name}
                  </div>
                  <div className="text-[10px] text-gray-400">
                    {r.product.brand}
                    {r.product.article ? ` · ${r.product.article}` : ''}
                  </div>
                </div>
                <span className="text-gray-600 tabular-nums flex-shrink-0">{r.quantity} шт</span>
                <span className="text-gray-800 font-semibold tabular-nums flex-shrink-0 w-24 text-right">
                  {r.value.toLocaleString('ru-RU')} ₽
                </span>
                <span
                  className="flex-shrink-0 w-24 text-right text-[10px] text-gray-500"
                  title={r.lastSaleDate ? `Последняя продажа: ${r.lastSaleDate}` : 'Продаж в окне истории не было'}
                >
                  {r.daysSinceSale === null ? 'не продавался' : `${r.daysSinceSale} дн. без продаж`}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      <p className={NOTE}>
        Кандидаты на скидку, перемещение в продающую точку или возврат поставщику. В XLSX — весь
        список, здесь — первые 30 по стоимости.
      </p>
    </div>
  );
}

/** Размерный профиль точки: спрос сети против факта на полке */
export function SizeProfileCard() {
  const data = useFilteredData();
  const sizeSales = useSizeSalesReport();
  const { scope } = useStoreScope();
  const stores = useMemo(() => (data ? sortStoresForDisplay(data.stores) : []), [data]);
  const firstRetail = stores.find((s) => !isWarehouse(s.name))?.name ?? '';
  const [storeName, setStoreName] = useState<string>('');
  const effective = storeName || (scope !== ALL_SCOPE && scope ? scope : firstRetail);

  const rows = useMemo(
    () => (data ? sizeProfile(data, sizeSales, effective).slice(0, 12) : []),
    [data, sizeSales, effective]
  );

  if (!data) return null;

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <h3 className="text-lg font-semibold text-gray-800">Размерный профиль точки</h3>
        <select
          value={effective}
          onChange={(e) => setStoreName(e.target.value)}
          className="px-2 py-1 text-xs border border-gray-200 rounded-lg bg-white text-gray-600"
        >
          {stores.map((s) => (
            <option key={s.id} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400 py-10 text-center">Нет размерных позиций в точке.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 border-b border-gray-100">
              <th className="text-left py-1.5 font-medium">Размер</th>
              <th className="text-right py-1.5 font-medium">На полке</th>
              <th className="text-right py-1.5 font-medium">Доля полки</th>
              <th className="text-right py-1.5 font-medium">Продажи сети</th>
              <th className="text-right py-1.5 font-medium">Доля спроса</th>
              <th className="text-right py-1.5 font-medium">Разрыв</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.size} className="border-b border-gray-50">
                <td className="py-1.5 font-medium text-gray-700">{r.size}</td>
                <td className="py-1.5 text-right text-gray-600 tabular-nums">{r.stock} шт</td>
                <td className="py-1.5 text-right text-gray-500 tabular-nums">{r.stockShare}%</td>
                <td className="py-1.5 text-right text-gray-600 tabular-nums">{r.sold} шт</td>
                <td className="py-1.5 text-right text-gray-500 tabular-nums">{r.soldShare}%</td>
                <td className="py-1.5 text-right tabular-nums">
                  <span
                    className={`inline-flex min-w-[3rem] justify-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                      r.gap >= 10
                        ? 'bg-red-100 text-red-700'
                        : r.gap <= -10
                          ? 'bg-sky-100 text-sky-700'
                          : 'bg-gray-100 text-gray-500'
                    }`}
                    title={
                      r.gap >= 10
                        ? 'Размер покупают чаще, чем он представлен на полке — кандидат на довоз'
                        : r.gap <= -10
                          ? 'Размер занимает полку сверх спроса — кандидат на перемещение/скидку'
                          : 'Спрос и полка сбалансированы'
                    }
                  >
                    {r.gap > 0 ? `+${r.gap}` : r.gap}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className={NOTE}>
        Спрос — продажи размеров по сети за окно истории (снимки sizes); полка — факт точки.
        Красный разрыв — размер выметают, а на полке его мало; синий — полка сверх спроса.
      </p>
    </div>
  );
}
