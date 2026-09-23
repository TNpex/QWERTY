import { useMemo } from 'react';
import {
  Flame,
  TrendingDown,
  TrendingUp,
  PackageX,
  ArrowLeftRight,
  History,
  CalendarDays,
  ExternalLink,
  Info,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useData } from '../context/DataContext';
import { useMetrics, useSalesReport } from '../hooks/useAnalytics';
import { MAX_SALES_DISPLAY } from '../utils/analyticsCore';
import type { ProductMovement } from '../utils/historyCore';

function formatDate(iso: string): string {
  const date = new Date(iso);
  return isNaN(date.getTime()) ? iso : date.toLocaleDateString('ru-RU');
}

function MovementRow({ mv, days }: { mv: ProductMovement; days: number }) {
  const perDay = days > 0 ? (mv.sold / days).toFixed(1) : '—';
  return (
    <div className="flex items-center justify-between gap-3 p-3 bg-gray-50 rounded-lg">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-gray-800 truncate" title={mv.name}>
          {mv.name}
        </div>
        <div className="text-xs text-gray-500">
          {mv.brand}
          {mv.article ? ` · ${mv.article}` : ''}
          {mv.soldOut && (
            <span className="ml-2 inline-flex items-center gap-1 text-red-600 font-semibold">
              <PackageX className="w-3 h-3" /> распродан
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-4 text-xs flex-shrink-0">
        <span className="text-red-600 font-bold flex items-center gap-1">
          <TrendingDown className="w-3 h-3" />
          −{mv.sold} шт.
        </span>
        <span className="text-gray-500 hidden sm:inline">~{perDay}/день</span>
        <span className="text-gray-600 hidden md:inline">остаток: {mv.currentTotal}</span>
      </div>
    </div>
  );
}

export function SalesHistory() {
  const { data, history } = useData();
  const report = useSalesReport();
  const metrics = useMetrics();

  // Распроданные товары текущего снимка (с нулевым суммарным остатком)
  const currentSoldOut = useMemo(() => {
    if (!data) return [];
    const totals = new Map<string, number>();
    for (const item of data.inventory) {
      if (item.notCarried) continue;
      totals.set(item.productId, (totals.get(item.productId) ?? 0) + item.quantity);
    }
    return data.products.filter((p) => (totals.get(p.id) ?? 0) === 0);
  }, [data]);

  if (!data) return null;

  const storeChartData = report
    ? report.byStore.map((s) => ({
        name: s.store.length > 22 ? s.store.substring(0, 22) + '...' : s.store,
        fullName: s.store,
        'Продано': s.sold,
        'Поступило': s.restocked,
      }))
    : [];

  return (
    <div className="space-y-6">
      {/* Заголовок периода */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <History className="w-5 h-5 text-orange-500" />
              Движение товаров и продажи
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              {report
                ? `Период: ${formatDate(report.fromDate)} → ${formatDate(report.toDate)} (${report.days} дн., снимков: ${report.snapshotsCount})`
                : `Накоплено снимков: ${history.length}. Для анализа продаж нужно минимум два снимка.`}
            </p>
          </div>
          {data.asOf && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 rounded-full text-xs font-medium text-blue-700">
              <CalendarDays className="w-3.5 h-3.5" />
              Данные на {formatDate(data.asOf)}
            </span>
          )}
        </div>
      </div>

      {report ? (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center gap-2 text-red-500 mb-1">
                <TrendingDown className="w-4 h-4" />
                <span className="text-xs text-gray-500">Продано, шт.</span>
              </div>
              <div className="text-2xl font-bold text-gray-800">{report.totalSold}</div>
              <div className="text-xs text-gray-400 mt-1">
                ~{(report.totalSold / report.days).toFixed(1)} в день
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center gap-2 text-orange-500 mb-1">
                <Flame className="w-4 h-4" />
                <span className="text-xs text-gray-500">Распродано товаров</span>
              </div>
              <div className="text-2xl font-bold text-gray-800">{report.soldOutProducts.length}</div>
              <div className="text-xs text-gray-400 mt-1">остаток стал нулевым</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center gap-2 text-emerald-500 mb-1">
                <TrendingUp className="w-4 h-4" />
                <span className="text-xs text-gray-500">Поступило, шт.</span>
              </div>
              <div className="text-2xl font-bold text-gray-800">{report.totalRestocked}</div>
              <div className="text-xs text-gray-400 mt-1">новых позиций: {report.newProducts}</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center gap-2 text-blue-500 mb-1">
                <ArrowLeftRight className="w-4 h-4" />
                <span className="text-xs text-gray-500">Перемещено, шт.</span>
              </div>
              <div className="text-2xl font-bold text-gray-800">{report.totalTransferred}</div>
              <div className="text-xs text-gray-400 mt-1">между магазинами</div>
            </div>
          </div>

          {/* Продажи по магазинам */}
          {storeChartData.some((d) => d['Продано'] > 0 || d['Поступило'] > 0) && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Движение по магазинам</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={storeChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={70} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value: number, name: string) => [value, name]}
                    labelFormatter={(_l, payload) => payload?.[0]?.payload?.fullName ?? String(_l)}
                  />
                  <Bar dataKey="Продано" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Поступило" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Лидеры продаж */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <TrendingDown className="w-5 h-5 text-red-500" />
                Лидеры продаж
              </h3>
              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                {report.topSold.slice(0, MAX_SALES_DISPLAY).map((mv) => (
                  <MovementRow key={mv.link || `${mv.article}|${mv.name}`} mv={mv} days={report.days} />
                ))}
                {report.topSold.length === 0 && (
                  <p className="text-sm text-gray-400 py-6 text-center">За период продаж не зафиксировано</p>
                )}
              </div>
              {report.topSold.length > MAX_SALES_DISPLAY && (
                <p className="mt-3 text-xs text-gray-500 text-center">
                  Показаны первые {MAX_SALES_DISPLAY} из {report.topSold.length}
                </p>
              )}
            </div>

            {/* Распроданные */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <Flame className="w-5 h-5 text-orange-500" />
                Распродано за период
              </h3>
              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                {report.soldOutProducts.slice(0, MAX_SALES_DISPLAY).map((mv) => (
                  <div
                    key={mv.link || `${mv.article}|${mv.name}`}
                    className="p-3 bg-red-50 border border-red-100 rounded-lg"
                  >
                    <div className="text-sm font-medium text-gray-800 truncate" title={mv.name}>
                      {mv.name}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {mv.brand}
                      {mv.article ? ` · ${mv.article}` : ''}
                    </div>
                    <div className="text-xs text-red-600 font-semibold mt-1">
                      Продано {mv.sold} шт. — остаток 0
                      {mv.disappeared && ' (убран из каталога)'}
                    </div>
                  </div>
                ))}
                {report.soldOutProducts.length === 0 && (
                  <p className="text-sm text-gray-400 py-6 text-center">
                    За период ничего не распродано до нуля
                  </p>
                )}
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Один снимок: показываем текущие распроданные товары и инструкцию */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-800">
                <p className="font-semibold mb-1">Как включить анализ продаж</p>
                <p className="mb-2">
                  Сайт сравнивает соседние снимки остатков. Сейчас загружен{' '}
                  {history.length === 0 ? 'только текущий каталог' : `один снимок (${formatDate(history[0].date)})`}.
                  Сохраняйте результат каждого парсинга — и здесь появятся продажи, перемещения и
                  товары, распроданные между снимками.
                </p>
                <pre className="bg-white/70 rounded-lg p-3 text-xs overflow-x-auto">
{`# ежедневный парсинг saletennis.com сохраните в CSV, затем:
npm run snapshot -- путь/к/2026-09-24.csv

# скрипт положит файл в public/data/history/,
# обновит manifest.json и products.csv`}
                </pre>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <PackageX className="w-5 h-5 text-red-500" />
              Распродано на текущий момент
              <span className="text-sm font-normal text-gray-400">
                ({metrics?.soldOutProducts ?? currentSoldOut.length} товаров с нулевым остатком)
              </span>
            </h3>
            {currentSoldOut.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p className="text-sm">Все товары каталога имеют остатки 🎉</p>
                <p className="text-xs mt-1 text-gray-400">
                  Полностью распроданных позиций на {data.asOf ? formatDate(data.asOf) : 'сегодня'} нет
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[500px] overflow-y-auto pr-1">
                {currentSoldOut.map((product) => (
                  <div
                    key={product.id}
                    className="flex items-center justify-between gap-3 p-3 bg-red-50 border border-red-100 rounded-lg"
                  >
                    <div className="min-w-0">
                      {product.link ? (
                        <a
                          href={product.link}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm font-medium text-gray-800 hover:text-blue-600 truncate block"
                          title={product.name}
                        >
                          {product.name} <ExternalLink className="w-3 h-3 inline" />
                        </a>
                      ) : (
                        <div className="text-sm font-medium text-gray-800 truncate" title={product.name}>
                          {product.name}
                        </div>
                      )}
                      <div className="text-xs text-gray-500">
                        {product.brand} · {product.category}
                        {product.article ? ` · ${product.article}` : ''}
                      </div>
                    </div>
                    <span className="text-xs font-bold text-red-600 flex-shrink-0">0 шт.</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
