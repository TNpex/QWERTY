import { useMemo } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  DollarSign,
  Flame,
  Info,
  Package,
  ShoppingCart,
  Store as StoreIcon,
  TrendingUp,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  useOverview,
  useRestockRecommendations,
  useTransferRecommendations,
} from '../hooks/useAnalytics';
import { useData } from '../context/DataContext';
import { getOverstockPositions } from '../utils/analyticsCore';
import { isWarehouse, shortStoreLabel } from '../utils/storeGroups';
import {
  ALL_SCOPE,
  sharePercent,
  totalsRow,
  type StoreOverviewRow,
} from '../utils/storeScope';
import { useStoreScope } from '../hooks/useStoreScope';
import type { TabId } from '../types';

/**
 * 📊 Обзор — понятные числа вместо процентов.
 *
 * Область: «🌐 Вся сеть» или конкретный магазин (подставляется из «Моего
 * магазина» в сайдбаре) — всё пересчитывается: позиции, артикулы, остатки,
 * стоимость, перемещения, дозакупка и переизбыток.
 *
 * Единица учёта — позиция (товар × размер × магазин, который товар возит).
 * «—» (не возит) в знаменатель не попадает.
 */

const TONES = {
  red: { card: 'bg-white', text: 'text-red-700', bar: 'bg-red-500', chip: 'bg-red-50' },
  orange: { card: 'bg-white', text: 'text-orange-700', bar: 'bg-orange-500', chip: 'bg-orange-50' },
  emerald: { card: 'bg-white', text: 'text-emerald-700', bar: 'bg-emerald-500', chip: 'bg-emerald-50' },
  blue: { card: 'bg-white', text: 'text-blue-700', bar: 'bg-blue-500', chip: 'bg-blue-50' },
  purple: { card: 'bg-white', text: 'text-purple-700', bar: 'bg-purple-500', chip: 'bg-purple-50' },
  amber: { card: 'bg-white', text: 'text-amber-700', bar: 'bg-amber-500', chip: 'bg-amber-50' },
  rose: { card: 'bg-white', text: 'text-rose-700', bar: 'bg-rose-500', chip: 'bg-rose-50' },
} as const;

type Tone = keyof typeof TONES;

interface FractionCardProps {
  icon: React.ReactNode;
  label: string;
  part: number;
  total: number;
  /** Подпись под дробью (по умолчанию — процент доли) */
  caption?: string;
  sublabel?: string;
  tone: Tone;
  /** Полоса показывает «плохую» долю (иначе — долю part/total) */
  invert?: boolean;
  onClick?: () => void;
}

function FractionCard({
  icon,
  label,
  part,
  total,
  caption,
  sublabel,
  tone,
  onClick,
}: FractionCardProps) {
  const colors = TONES[tone];
  const percent = sharePercent(part, total);
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick
        ? {
            onClick,
            type: 'button' as const,
            title: 'Открыть соответствующую вкладку',
          }
        : {})}
      className={`${colors.card} rounded-xl shadow-sm border border-gray-100 p-4 text-left w-full ${
        onClick ? 'hover:shadow-md hover:border-gray-200 transition-all cursor-pointer' : ''
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className={`${colors.chip} ${colors.text} p-1.5 rounded-lg`}>{icon}</span>
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <div className={`text-xl font-bold ${colors.text}`}>
        {part} <span className="text-gray-400 font-medium text-base">из</span> {total}
      </div>
      <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${colors.bar}`}
          style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[10px] text-gray-400">{caption ?? `${percent}%`}</span>
        {sublabel && <span className="text-[10px] text-gray-400 truncate">{sublabel}</span>}
      </div>
    </Tag>
  );
}

interface NumberCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sublabel?: string;
  tone: Tone;
  onClick?: () => void;
}

function NumberCard({ icon, label, value, sublabel, tone, onClick }: NumberCardProps) {
  const colors = TONES[tone];
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { onClick, type: 'button' as const } : {})}
      className={`${colors.card} rounded-xl shadow-sm border border-gray-100 p-4 text-left w-full ${
        onClick ? 'hover:shadow-md hover:border-gray-200 transition-all cursor-pointer' : ''
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className={`${colors.chip} ${colors.text} p-1.5 rounded-lg`}>{icon}</span>
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <div className={`text-xl font-bold ${colors.text}`}>{value}</div>
      {sublabel && <div className="mt-1 text-[10px] text-gray-400">{sublabel}</div>}
    </Tag>
  );
}

function money(value: number): string {
  return value > 1000000
    ? `${(value / 1000000).toFixed(1)}М ₽`
    : `${Math.round(value / 1000)}к ₽`;
}

export function Dashboard({ onNavigate }: { onNavigate?: (tab: TabId) => void }) {
  const { data, storeProfile, settings } = useData();
  // Область обзора общая для всех вкладок и живёт в адресе (?scope=Уфа):
  // ссылку можно скопировать, перезагрузка оставляет выбранный магазин,
  // а переход в «Инвентарь» открывает его на той же точке
  const { scope, setScope } = useStoreScope();

  const overview = useOverview(scope);
  const transfers = useTransferRecommendations();
  const restocks = useRestockRecommendations();

  const overstock = useMemo(() => (data ? getOverstockPositions(data) : []), [data]);

  const scopedOverstock = useMemo(
    () => (scope === ALL_SCOPE ? overstock : overstock.filter((p) => p.storeName === scope)),
    [overstock, scope]
  );

  // Перемещения: «везти в магазин» (входящие) и «отдать из магазина» (исходящие)
  const incoming = useMemo(
    () => (scope === ALL_SCOPE ? transfers : transfers.filter((t) => t.toStore === scope)),
    [transfers, scope]
  );
  const outgoing = useMemo(
    () => (scope === ALL_SCOPE ? transfers : transfers.filter((t) => t.fromStore === scope)),
    [transfers, scope]
  );
  const incomingMoves = useMemo(() => new Set(incoming.map((t) => t.optionGroup)).size, [incoming]);
  const outgoingMoves = useMemo(
    () => new Set(outgoing.map((t) => `${t.productId}|${t.size}|${t.fromStoreId}`)).size,
    [outgoing]
  );
  const incomingUnits = useMemo(
    () => incoming.reduce((sum, t) => sum + t.quantity, 0),
    [incoming]
  );
  const restockUnits = useMemo(
    () => restocks.reduce((sum, r) => sum + r.toPurchase, 0),
    [restocks]
  );

  /** «Чем заполнить магазин»: ближайшие дефициты точки (первые товары входящих перемещений) */
  const fillStore = useMemo(() => {
    if (scope === ALL_SCOPE) return [];
    const byProduct = new Map<
      string,
      { productName: string; sizes: string[]; units: number; sources: Set<string> }
    >();
    for (const rec of incoming) {
      let entry = byProduct.get(rec.productId);
      if (!entry) {
        entry = { productName: rec.productName, sizes: [], units: 0, sources: new Set() };
        byProduct.set(rec.productId, entry);
      }
      if (!entry.sizes.includes(rec.size)) entry.sizes.push(rec.size);
      entry.units += rec.quantity;
      entry.sources.add(shortStoreLabel(rec.fromStore));
    }
    return [...byProduct.entries()]
      .map(([productId, entry]) => ({ productId, ...entry }))
      .sort((a, b) => b.units - a.units)
      .slice(0, 8);
  }, [incoming, scope]);

  const comparison = useMemo(() => {
    if (!overview) return [];
    return overview.stores;
  }, [overview]);
  const totals = useMemo(() => totalsRow(comparison), [comparison]);

  if (!data || !overview) return null;

  const scopeStore = scope === ALL_SCOPE ? null : data.stores.find((s) => s.name === scope);
  const snapshotDate = overview.asOf
    ? new Date(overview.asOf).toLocaleDateString('ru-RU')
    : data.uploadedAt
      ? new Date(data.uploadedAt).toLocaleDateString('ru-RU')
      : null;
  const chartData = overview.categories.slice(0, 12).map((c) => ({
    name: c.category.length > 24 ? `${c.category.slice(0, 24)}…` : c.category,
    fullName: c.category,
    'С наличием': c.inStock,
    'Без наличия': c.outOfStock,
  }));

  const storeRow = (row: StoreOverviewRow) => (
    <tr
      key={row.storeId}
      className={`border-t border-gray-50 ${scopeStore?.id === row.storeId ? 'bg-indigo-50/60' : ''}`}
    >
      <td className="py-2 px-3 text-left">
        <button
          onClick={() => setScope(row.storeName)}
          className="text-xs font-medium text-gray-700 hover:text-blue-600 hover:underline text-left"
          title="Открыть обзор этого магазина"
        >
          {row.isWarehouse ? '📦 ' : ''}
          {row.storeName}
        </button>
      </td>
      <td className="py-2 px-2 text-center text-xs text-gray-700 whitespace-nowrap">
        <b>{row.inStock}</b>
        <span className="text-gray-400"> / {row.carried}</span>
      </td>
      <td className="py-2 px-2 text-center text-xs text-red-600">{row.outOfStock}</td>
      <td className="py-2 px-2 text-center text-xs text-gray-500">
        {sharePercent(row.inStock, row.carried)}%
      </td>
      <td className="py-2 px-2 text-center text-xs text-gray-700">{row.stock}</td>
      <td className="py-2 px-2 text-center text-xs text-gray-500">{money(row.value)}</td>
      <td className="py-2 px-2 text-center text-xs text-gray-500">{row.products}</td>
      <td className="py-2 px-2 text-center text-xs text-orange-600">{row.soldOutProducts}</td>
    </tr>
  );

  return (
    <div className="space-y-6">
      {/* Область обзора */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-[220px]">
            <h3 className="text-lg font-semibold text-gray-800">
              {scope === ALL_SCOPE ? '🌐 Вся сеть' : `🏬 ${scope}`}
            </h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {snapshotDate ? `Источник: снимок остатков от ${snapshotDate}` : 'Источник: загруженный файл'} ·{' '}
              {overview.positions.carried} позиций в расчёте
              {overview.hiddenByProfile > 0 &&
                ` · ${overview.hiddenByProfile} позиций скрыто профилем магазина`}
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-500">
            Область:
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white cursor-pointer focus:ring-2 focus:ring-blue-500 max-w-[320px]"
              title="Обзор всей сети или одного магазина (по умолчанию подставляется «Мой магазин»)"
            >
              <option value={ALL_SCOPE}>🌐 Вся сеть</option>
              {data.stores.map((store) => (
                <option key={store.id} value={store.name}>
                  {isWarehouse(store.name) ? '📦 ' : ''}
                  {store.name}
                </option>
              ))}
            </select>
          </label>
          {storeProfile && scope !== storeProfile && (
            <button
              onClick={() => setScope(storeProfile)}
              className="px-3 py-2 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
              title="Вернуться к обзору «Моего магазина»"
            >
              📍 Мой магазин: {storeProfile}
            </button>
          )}
        </div>

        {/* Как считаются эти цифры */}
        <div className="mt-3 flex items-start gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-gray-400" />
          <div>
            <b className="text-gray-600">Как считаются эти цифры</b>
            <ul className="mt-1 space-y-0.5 list-disc list-inside">
              <li>
                <b>Позиция</b> = товар × размер × магазин, который этот товар возит. Одна модель
                обуви в трёх размерах в двух магазинах — это 6 позиций.
              </li>
              <li>
                <b>«—» (магазин не возит товар)</b> в знаменатель не попадает: это не дефицит, а
                отсутствие товара в ассортименте точки.
              </li>
              <li>
                <b>Распроданный артикул</b> — в области нет ни одной штуки этого товара (включая
                товары без строк остатков).
              </li>
              <li>
                <b>Источник</b> — снимок остатков{snapshotDate ? ` от ${snapshotDate}` : ''}
                {scope !== ALL_SCOPE &&
                  ' ; ассортимент точки сужен её профилем (вид спорта, скрытые категории) — вкладка «🏬 Магазины»'}
                .
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Карточки: дроби вместо процентов */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <FractionCard
          icon={<AlertTriangle className="w-4 h-4" />}
          label="Позиции без наличия"
          part={overview.positions.outOfStock}
          total={overview.positions.carried}
          tone="red"
          caption={`${sharePercent(overview.positions.outOfStock, overview.positions.carried)}% позиций с нулём`}
          sublabel="товар × размер × магазин"
          onClick={onNavigate ? () => onNavigate('inventory') : undefined}
        />
        <FractionCard
          icon={<Flame className="w-4 h-4" />}
          label="Распроданные артикулы"
          part={overview.soldOutProducts}
          total={overview.products}
          tone="orange"
          caption="нет ни одной штуки"
          sublabel={scope === ALL_SCOPE ? 'по всей сети' : `в «${scope}»`}
          onClick={onNavigate ? () => onNavigate('sales') : undefined}
        />
        <FractionCard
          icon={<Package className="w-4 h-4" />}
          label="Товары в наличии"
          part={overview.productsInStock}
          total={overview.products}
          tone="emerald"
          caption="хотя бы одна штука"
          sublabel={`артикулов всего: ${overview.products}`}
          onClick={onNavigate ? () => onNavigate('inventory') : undefined}
        />
        <NumberCard
          icon={<BarChart3 className="w-4 h-4" />}
          label="Остаток, шт."
          value={overview.stock.toLocaleString('ru-RU')}
          sublabel={`${overview.positions.inStock} позиций с наличием`}
          tone="blue"
        />
        <NumberCard
          icon={<DollarSign className="w-4 h-4" />}
          label="Стоимость остатков"
          value={money(overview.value)}
          sublabel="в ценах сайта"
          tone="purple"
        />
        <NumberCard
          icon={<ArrowDownToLine className="w-4 h-4" />}
          label={scope === ALL_SCOPE ? 'Везти в магазины' : 'Везти в магазин'}
          value={`${incomingMoves} поз.`}
          sublabel={`${incomingUnits} шт. · ${incoming.length} вариантов`}
          tone="amber"
          onClick={onNavigate ? () => onNavigate('transfers') : undefined}
        />
        <NumberCard
          icon={<ArrowUpFromLine className="w-4 h-4" />}
          label={scope === ALL_SCOPE ? 'Отдать из магазинов' : 'Отдать из магазина'}
          value={`${outgoingMoves} поз.`}
          sublabel={scope === ALL_SCOPE ? 'размер × магазин-донор' : 'можно вывезти из точки'}
          tone="amber"
          onClick={onNavigate ? () => onNavigate('transfers') : undefined}
        />
        <NumberCard
          icon={<ShoppingCart className="w-4 h-4" />}
          label="Дозакупка"
          value={`${restocks.length} поз.`}
          sublabel={`${restockUnits} шт. у поставщика`}
          tone="rose"
          onClick={onNavigate ? () => onNavigate('restock') : undefined}
        />
        <NumberCard
          icon={<TrendingUp className="w-4 h-4" />}
          label="Переизбыток"
          value={`${scopedOverstock.length} поз.`}
          sublabel="размеров сверх неснижаемого остатка"
          tone="orange"
          onClick={onNavigate ? () => onNavigate('transfers') : undefined}
        />
      </div>

      {/* Доля позиций с наличием по каждому магазину */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <h3 className="text-base font-semibold text-gray-800 mb-1">
          Позиции с наличием по магазинам
        </h3>
        <p className="text-xs text-gray-500 mb-4">
          Клик по магазину открывает его обзор. «{totals.inStock} / {totals.carried}» — сколько
          размерных позиций точки реально в наличии.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {comparison.map((row) => {
            const percent = sharePercent(row.inStock, row.carried);
            const active = scopeStore?.id === row.storeId;
            return (
              <button
                key={row.storeId}
                onClick={() => setScope(row.storeName)}
                className={`text-left rounded-xl border p-3 transition-all ${
                  active
                    ? 'border-indigo-300 bg-indigo-50/60 shadow-sm'
                    : 'border-gray-100 bg-white hover:border-gray-200 hover:shadow-sm'
                }`}
                title={`Открыть обзор: ${row.storeName}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-gray-700 truncate">
                    {row.isWarehouse ? '📦 ' : ''}
                    {row.storeName}
                  </span>
                  <span className="text-[10px] text-gray-400 flex-shrink-0">
                    {shortStoreLabel(row.storeName)}
                  </span>
                </div>
                <div className="mt-1.5 text-sm font-bold text-gray-800">
                  {row.inStock} <span className="text-gray-400 font-medium">/</span> {row.carried}{' '}
                  <span className="text-[10px] font-normal text-gray-400">позиций с наличием</span>
                </div>
                <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      percent >= 85 ? 'bg-emerald-500' : percent >= 70 ? 'bg-amber-500' : 'bg-red-500'
                    }`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px] text-gray-400">
                  <span>{percent}%</span>
                  <span>
                    без наличия: <b className="text-red-500">{row.outOfStock}</b>
                    {row.hiddenByProfile > 0 && ` · скрыто профилем: ${row.hiddenByProfile}`}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Стековая диаграмма: с наличием / без наличия по категориям */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">
            Наличие по категориям
            {scope !== ALL_SCOPE && <span className="text-sm text-gray-400"> · {scope}</span>}
          </h3>
          <ResponsiveContainer width="100%" height={Math.max(260, chartData.length * 30)}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 10 }} />
              <Tooltip
                formatter={(value: number, name: string) => [`${value} позиций`, name]}
                labelFormatter={(_label, payload) =>
                  payload?.[0]?.payload?.fullName ?? String(_label)
                }
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="С наличием" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
              <Bar dataKey="Без наличия" stackId="a" fill="#ef4444" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <p className="text-[10px] text-gray-400 mt-2">
            Позиция = товар × размер × магазин, который товар возит.
          </p>
        </div>

        {/* Чем заполнить магазин */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-1">
            {scope === ALL_SCOPE ? 'Ближайшие дефициты сети' : `Чем заполнить «${scope}»`}
          </h3>
          <p className="text-xs text-gray-500 mb-4">
            {scope === ALL_SCOPE
              ? 'Выберите магазин в «Области» выше — покажем, чем его заполнить.'
              : 'Ближайшие дефициты точки: что и откуда везти (полный список — вкладка «🔄 Перемещения»).'}
          </p>
          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {fillStore.length === 0 && scope !== ALL_SCOPE && (
              <p className="text-xs text-gray-400 py-6 text-center">
                Дефицитов нет — магазин заполнен (или перемещения точки выключены в профиле).
              </p>
            )}
            {(scope === ALL_SCOPE
              ? (() => {
                  const byProduct = new Map<string, { productName: string; sizes: string[]; units: number; sources: Set<string> }>();
                  for (const rec of transfers) {
                    let entry = byProduct.get(rec.productId);
                    if (!entry) {
                      entry = { productName: rec.productName, sizes: [], units: 0, sources: new Set() };
                      byProduct.set(rec.productId, entry);
                    }
                    if (!entry.sizes.includes(rec.size)) entry.sizes.push(rec.size);
                    entry.units += rec.quantity;
                    entry.sources.add(shortStoreLabel(rec.toStore));
                  }
                  return [...byProduct.values()]
                    .sort((a, b) => b.units - a.units)
                    .slice(0, 8)
                    .map((entry, i) => ({ productId: String(i), ...entry }));
                })()
              : fillStore
            ).map((entry) => (
              <div
                key={entry.productId}
                className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-gray-800 truncate">
                    {entry.productName}
                  </div>
                  <div className="text-[10px] text-gray-500">
                    размеры: {entry.sizes.slice(0, 6).join(', ')}
                    {entry.sizes.length > 6 ? '…' : ''} ·{' '}
                    {scope === ALL_SCOPE ? 'куда: ' : 'откуда: '}
                    {[...entry.sources].slice(0, 4).join(', ')}
                  </div>
                </div>
                <span className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5 flex-shrink-0">
                  {entry.units} шт.
                </span>
              </div>
            ))}
          </div>
          {onNavigate && (
            <button
              onClick={() => onNavigate('transfers')}
              className="mt-3 text-xs text-blue-600 hover:text-blue-800 hover:underline"
            >
              Открыть «🔄 Перемещения» →
            </button>
          )}
        </div>
      </div>

      {/* Сравнение магазинов */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-5 pb-3">
          <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <StoreIcon className="w-4 h-4 text-gray-400" />
            Сравнение магазинов
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Клик по названию открывает обзор магазина. Итоговая строка — сумма по сети (позиции
            одного товара в разных магазинах считаются отдельно).
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-gray-500">
                <th className="py-2 px-3 text-left font-medium">Магазин</th>
                <th className="py-2 px-2 text-center font-medium" title="Позиций с наличием из всех позиций, которые магазин возит">
                  с наличием
                </th>
                <th className="py-2 px-2 text-center font-medium">без наличия</th>
                <th className="py-2 px-2 text-center font-medium">доля</th>
                <th className="py-2 px-2 text-center font-medium">остаток, шт.</th>
                <th className="py-2 px-2 text-center font-medium">стоимость</th>
                <th className="py-2 px-2 text-center font-medium">артикулов</th>
                <th className="py-2 px-2 text-center font-medium" title="Артикулы, в которых нет ни одной штуки">
                  распродано
                </th>
              </tr>
            </thead>
            <tbody>
              {comparison.map(storeRow)}
              <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                <td className="py-2 px-3 text-left text-gray-700">{totals.storeName}</td>
                <td className="py-2 px-2 text-center text-gray-700">
                  {totals.inStock} / {totals.carried}
                </td>
                <td className="py-2 px-2 text-center text-red-600">{totals.outOfStock}</td>
                <td className="py-2 px-2 text-center text-gray-500">
                  {sharePercent(totals.inStock, totals.carried)}%
                </td>
                <td className="py-2 px-2 text-center text-gray-700">{totals.stock}</td>
                <td className="py-2 px-2 text-center text-gray-500">{money(totals.value)}</td>
                <td className="py-2 px-2 text-center text-gray-500">{totals.products}</td>
                <td className="py-2 px-2 text-center text-orange-600">{totals.soldOutProducts}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="px-5 py-3 text-[10px] text-gray-400">
          «Артикулов» и «распродано» — по товарам, которые магазин возит; сумма по сети может
          превышать число артикулов в каталоге (один товар есть в нескольких магазинах).
          {Object.keys(settings.storeProfiles).length > 0 &&
            ' Профили магазинов сужают ассортимент точки — такие позиции не попадают в её знаменатель.'}
        </p>
      </div>
    </div>
  );
}
