import { useMemo, useState } from 'react';
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
  ClipboardList,
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
import {
  useMetrics,
  useSalesReport,
  useFilteredData,
  useSizeSalesReport,
} from '../hooks/useAnalytics';
import { MAX_SALES_DISPLAY } from '../utils/analyticsCore';
import { detectGender, GENDER_LABELS } from '../utils/productMeta';
import { normalizeLink } from '../utils/historyCore';
import type { ProductMovement, ParserChange } from '../utils/historyCore';
import { ProductCardModal } from './ProductCardModal';

const CHANGE_TYPES = [
  'all',
  'Товар закончился',
  'Изменение количества',
  'Новый товар',
  'Товар удалён с сайта',
] as const;

const CHANGE_BADGE: Record<string, string> = {
  'Товар закончился': 'bg-red-100 text-red-700',
  'Изменение количества': 'bg-amber-100 text-amber-700',
  'Новый товар': 'bg-emerald-100 text-emerald-700',
  'Товар удалён с сайта': 'bg-gray-200 text-gray-600',
};

function formatChangeDate(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Журнал изменений, который ведёт сам парсер (changes.csv) */
function ParserChangeJournal({ changes }: { changes: ParserChange[] }) {
  const { filters } = useData();
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const filtered = useMemo(
    () =>
      changes.filter(
        (change) =>
          (typeFilter === 'all' || change.changeType === typeFilter) &&
          (filters.category === 'all' || change.category === filters.category) &&
          (filters.gender === 'all' || detectGender(change.name, change.category) === filters.gender)
      ),
    [changes, typeFilter, filters]
  );

  if (changes.length === 0) return null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-1 flex items-center gap-2">
        <ClipboardList className="w-5 h-5 text-indigo-500" />
        Журнал изменений парсера
        <span className="text-sm font-normal text-gray-400">({filtered.length})</span>
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        Фиксируется автоматически при каждом парсинге: продажи, окончания товаров, поступления и новинки.
      </p>
      <div className="flex gap-1.5 flex-wrap mb-3">
        {CHANGE_TYPES.map((type) => (
          <button
            key={type}
            onClick={() => setTypeFilter(type)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              typeFilter === type
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {type === 'all' ? 'Все' : type}
          </button>
        ))}
      </div>
      <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
        {filtered.slice(0, 200).map((change, i) => (
          <div key={`${change.article}|${change.name}|${i}`} className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2 text-xs">
            <span className="text-gray-400 flex-shrink-0 w-24">{formatChangeDate(change.date)}</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0 ${CHANGE_BADGE[change.changeType] ?? 'bg-gray-100 text-gray-600'}`}>
              {change.changeType}
            </span>
            <span className="flex-1 min-w-0 truncate text-gray-700" title={change.name}>
              {change.name}
              {change.article ? <span className="text-gray-400"> · {change.article}</span> : null}
            </span>
            {change.changeType === 'Изменение количества' && (
              <span className="flex-shrink-0 text-gray-500">
                {change.oldValue} → {change.newValue}{' '}
                <b className={change.diff < 0 ? 'text-red-600' : 'text-emerald-600'}>
                  ({change.diff > 0 ? '+' : ''}{change.diff})
                </b>
              </span>
            )}
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-4">Нет изменений по выбранным фильтрам</p>
        )}
        {filtered.length > 200 && (
          <p className="text-[10px] text-gray-400 text-center">Показаны первые 200</p>
        )}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return isNaN(date.getTime()) ? iso : date.toLocaleDateString('ru-RU');
}

function MovementRow({
  mv,
  days,
  onSelect,
}: {
  mv: ProductMovement;
  days: number;
  onSelect?: (mv: ProductMovement) => void;
}) {
  const perDay = days > 0 ? (mv.sold / days).toFixed(1) : '—';
  return (
    <div className="flex items-center justify-between gap-3 p-3 bg-gray-50 rounded-lg">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-gray-800 truncate" title={mv.name}>
          {onSelect ? (
            <button
              onClick={() => onSelect(mv)}
              className="hover:text-blue-600 hover:underline text-left"
            >
              {mv.name}
            </button>
          ) : (
            mv.name
          )}
          {mv.link && (
            <a
              href={mv.link}
              target="_blank"
              rel="noreferrer"
              className="ml-1.5 text-gray-400 hover:text-blue-500"
              title="Открыть на saletennis.com"
            >
              <ExternalLink className="w-3 h-3 inline" />
            </a>
          )}
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
  const { data, history, parserChanges, filters } = useData();
  const filteredData = useFilteredData();
  const report = useSalesReport();
  const metrics = useMetrics();
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);

  // Сопоставление движения товара с текущим каталогом (для клика → карточка)
  const productIdForMovement = (mv: ProductMovement): string | null => {
    if (!data) return null;
    const link = mv.link ? normalizeLink(mv.link) : '';
    for (const p of data.products) {
      if (link && p.link && normalizeLink(p.link) === link) return p.id;
    }
    for (const p of data.products) {
      if (mv.article && p.article === mv.article && p.name === mv.name) return p.id;
    }
    return null;
  };

  const openMovement = (mv: ProductMovement) => {
    const id = productIdForMovement(mv);
    if (id) setSelectedProduct(id);
    else if (mv.link) window.open(mv.link, '_blank', 'noopener');
  };

  // Глобальные фильтры (бренд/категория/пол) применяются и к движению товаров
  const matchesFilters = (m: { category: string; brand: string; name: string }) =>
    (filters.brand === 'all' || m.brand === filters.brand) &&
    (filters.category === 'all' || m.category === filters.category) &&
    (filters.gender === 'all' || detectGender(m.name, m.category) === filters.gender);

  // Распроданные товары текущего снимка (с нулевым суммарным остатком)
  const currentSoldOut = useMemo(() => {
    if (!filteredData) return [];
    const totals = new Map<string, number>();
    for (const item of filteredData.inventory) {
      if (item.notCarried) continue;
      totals.set(item.productId, (totals.get(item.productId) ?? 0) + item.quantity);
    }
    return filteredData.products.filter((p) => (totals.get(p.id) ?? 0) === 0);
  }, [filteredData]);

  if (!data) return null;

  const topSold = report ? report.topSold.filter(matchesFilters) : [];
  const soldOutFiltered = report ? report.soldOutProducts.filter(matchesFilters) : [];

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

          <p className="text-[11px] text-gray-400 -mt-2">
            Продажа = уменьшение суммарного остатка между снимками; сравниваем по артикулам.
            Ранние снимки могут содержать ошибки старого парсинга (переименования, дубли
            артикулов) — сверяйте цифры с журналом изменений парсера ниже, он точнее.
          </p>

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
                {topSold.slice(0, MAX_SALES_DISPLAY).map((mv) => (
                  <MovementRow
                    key={mv.link || `${mv.article}|${mv.name}`}
                    mv={mv}
                    days={report.days}
                    onSelect={openMovement}
                  />
                ))}
                {topSold.length === 0 && (
                  <p className="text-sm text-gray-400 py-6 text-center">За период продаж не зафиксировано</p>
                )}
              </div>
              {topSold.length > MAX_SALES_DISPLAY && (
                <p className="mt-3 text-xs text-gray-500 text-center">
                  Показаны первые {MAX_SALES_DISPLAY} из {topSold.length}
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
                {soldOutFiltered.slice(0, MAX_SALES_DISPLAY).map((mv) => (
                  <div
                    key={mv.link || `${mv.article}|${mv.name}`}
                    className="p-3 bg-red-50 border border-red-100 rounded-lg"
                  >
                    <div className="text-sm font-medium text-gray-800 truncate" title={mv.name}>
                      <button
                        onClick={() => openMovement(mv)}
                        className="hover:text-blue-600 hover:underline text-left"
                      >
                        {mv.name}
                      </button>
                      {mv.link && (
                        <a
                          href={mv.link}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-1.5 text-gray-400 hover:text-blue-500"
                        >
                          <ExternalLink className="w-3 h-3 inline" />
                        </a>
                      )}
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
                {soldOutFiltered.length === 0 && (
                  <p className="text-sm text-gray-400 py-6 text-center">
                    За период ничего не распродано до нуля
                  </p>
                )}
              </div>
            </div>
          </div>

          <SizeSalesSection />

          <ParserChangeJournal changes={parserChanges} />
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

          <SizeSalesSection />

          <ParserChangeJournal changes={parserChanges} />
        </>
      )}

      {selectedProduct && (
        <ProductCardModal productId={selectedProduct} onClose={() => setSelectedProduct(null)} />
      )}
    </div>
  );
}

/** Продажи по размерам — популярность размерного ряда (мужчины/женщины/дети) */
function SizeSalesSection() {
  const sizeReport = useSizeSalesReport();
  const { sizeSnapshots } = useData();

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-1 flex items-center gap-2">
        <TrendingDown className="w-5 h-5 text-pink-500" />
        Продажи по размерам
      </h3>
      {!sizeReport ? (
        <p className="text-sm text-gray-400 mt-2">
          Накоплено снимков размеров: {sizeSnapshots.length}. Размерная аналитика появится,
          когда их станет минимум два — скрипт <code className="bg-gray-100 px-1 rounded">npm run snapshot</code>{' '}
          уже автоматически сохраняет снимки sizes.csv в историю.
        </p>
      ) : (
        <>
          <p className="text-xs text-gray-500 mb-4">
            Период: {new Date(sizeReport.fromDate).toLocaleDateString('ru-RU')} →{' '}
            {new Date(sizeReport.toDate).toLocaleDateString('ru-RU')} — какие размеры продавались
            (уменьшение остатков между снимками размеров).
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            {sizeReport.byGender.map((g) => (
              <div key={g.gender} className="bg-gray-50 rounded-lg p-3">
                <div className="text-sm font-semibold text-gray-700 mb-2">
                  {GENDER_LABELS[g.gender] ?? g.gender}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {g.rows.slice(0, 14).map((row) => (
                    <span
                      key={row.size}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-gray-200 text-xs"
                    >
                      <b>{row.size}</b>
                      <span className="text-pink-600">−{row.sold}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
            {sizeReport.entries.slice(0, 60).map((entry) => (
              <div
                key={`${entry.key}|${entry.size}`}
                className="flex items-center justify-between gap-3 bg-gray-50 rounded-lg px-3 py-2 text-xs"
              >
                <span className="truncate text-gray-700" title={entry.name}>
                  {entry.name}
                  <span className="text-gray-400"> · {entry.size}</span>
                </span>
                <span className="font-bold text-pink-600 flex-shrink-0">−{entry.sold}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
