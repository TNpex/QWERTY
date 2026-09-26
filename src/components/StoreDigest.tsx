import { useMemo } from 'react';
import { AlertTriangle, ArrowDownToLine, Flame, Timer, Wallet } from 'lucide-react';
import { useData } from '../context/DataContext';
import {
  useAbcClasses,
  useHistorySales,
  useTransferRecommendations,
} from '../hooks/useAnalytics';
import { runwayDays, runwayLevel, stockValueByStore } from '../utils/insights';
import { shortStoreLabel } from '../utils/storeGroups';

/**
 * «Утренний дайджест» точки: четыре числа и два коротких списка, с которыми
 * магазин открывает день: что продали с последнего снимка, что приедет,
 * где полка пустая у ходовых товаров и что скоро кончится.
 */
export function StoreDigest({ storeName }: { storeName: string }) {
  const { data, history } = useData();
  const sales = useHistorySales();
  const abc = useAbcClasses();
  const transfers = useTransferRecommendations();

  const digest = useMemo(() => {
    if (!data) return null;
    const store = data.stores.find((s) => s.name === storeName);
    if (!store) return null;

    // Движение с последнего снимка: пара последних снимков истории
    let sold = 0;
    let restocked = 0;
    let lastDate: string | null = null;
    const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length >= 2) {
      const prev = sorted[sorted.length - 2];
      const next = sorted[sorted.length - 1];
      lastDate = next.date;
      for (const [link, prevProduct] of prev.products) {
        const before = prevProduct.byStore[storeName] ?? 0;
        const after = next.products.get(link)?.byStore[storeName] ?? 0;
        if (before > after) sold += before - after;
        if (after > before) restocked += after - before;
      }
    }

    // Полка точки: нули и «скоро кончится»
    const zeros: { name: string; isA: boolean }[] = [];
    const risky: { name: string; days: number }[] = [];
    for (const item of data.inventory) {
      if (item.storeId !== store.id || item.notCarried) continue;
      const product = data.products.find((p) => p.id === item.productId);
      if (!product) continue;
      const link = product.link ?? '';
      const cls = link ? abc.get(link) : undefined;
      const soldInWindow = link ? (sales?.byProduct.get(link)?.byStore.get(storeName) ?? 0) : 0;
      if (item.quantity <= 0) {
        zeros.push({ name: product.name, isA: cls === 'A' });
        continue;
      }
      const days = runwayDays(item.quantity, soldInWindow, sales?.days ?? 1);
      if (days !== null && runwayLevel(item.quantity, days) === 'low') {
        risky.push({ name: product.name, days });
      }
    }
    zeros.sort((a, b) => Number(b.isA) - Number(a.isA) || a.name.localeCompare(b.name, 'ru'));
    risky.sort((a, b) => a.days - b.days);

    const incoming = transfers.filter((t) => t.toStore === storeName);
    const value = stockValueByStore(data).find((r) => r.name === storeName)?.value ?? 0;

    return { sold, restocked, lastDate, zeros, risky, incoming, value };
  }, [data, history, sales, abc, transfers, storeName]);

  if (!digest) return null;

  const cards = [
    {
      icon: Flame,
      label: `Продано с прошлого снимка${digest.lastDate ? ` (${digest.lastDate})` : ''}`,
      value: `${digest.sold} шт`,
      hint: 'Уменьшение остатков точки между двумя последними снимками; поступления отдельно.',
      color: 'text-emerald-600',
    },
    {
      icon: ArrowDownToLine,
      label: 'Приедет по перемещениям',
      value: `${digest.incoming.length} поз.`,
      hint: 'Входящие рекомендации перемещений на эту точку (вкладка «Перемещения»).',
      color: 'text-blue-600',
    },
    {
      icon: AlertTriangle,
      label: 'Пустая полка',
      value: `${digest.zeros.length} поз.`,
      hint: 'Возимые позиции с нулём; сначала перечислены товары класса A.',
      color: 'text-red-600',
    },
    {
      icon: Timer,
      label: 'Кончится в ближайшие 2 недели',
      value: `${digest.risky.length} поз.`,
      hint: 'Позиции с запасом ≤ 14 дней при текущей скорости продаж точки.',
      color: 'text-amber-600',
    },
    {
      icon: Wallet,
      label: 'Деньги на полке',
      value: `${Math.round(digest.value / 1000).toLocaleString('ru-RU')} тыс ₽`,
      hint: 'Стоимость остатка точки по текущим ценам.',
      color: 'text-violet-600',
    },
  ];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-1">
        Утро магазина · {shortStoreLabel(storeName)}
      </h3>
      <p className="text-xs text-gray-500 mb-4">{storeName}</p>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="bg-gray-50 rounded-lg px-3 py-2.5" title={card.hint}>
              <div className={`flex items-center gap-1.5 text-[10px] uppercase tracking-wide font-semibold ${card.color}`}>
                <Icon className="w-3.5 h-3.5" />
                <span className="line-clamp-1">{card.label}</span>
              </div>
              <div className="mt-1 text-xl font-bold text-gray-800 tabular-nums">{card.value}</div>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <div>
          <div className="text-xs font-semibold text-gray-600 mb-1.5">
            Пусто на полке (класс A — первыми)
          </div>
          {digest.zeros.length === 0 ? (
            <p className="text-xs text-gray-400">Нет нулевых позиций — полка заполнена.</p>
          ) : (
            <ul className="space-y-1">
              {digest.zeros.slice(0, 5).map((z, i) => (
                <li key={i} className="text-xs text-gray-600 flex items-center gap-1.5">
                  {z.isA && (
                    <span className="px-1 rounded bg-emerald-100 text-emerald-700 text-[10px] font-bold">
                      A
                    </span>
                  )}
                  <span className="truncate" title={z.name}>
                    {z.name}
                  </span>
                </li>
              ))}
              {digest.zeros.length > 5 && (
                <li className="text-[10px] text-gray-400">и ещё {digest.zeros.length - 5}…</li>
              )}
            </ul>
          )}
        </div>
        <div>
          <div className="text-xs font-semibold text-gray-600 mb-1.5">Скоро кончится (≤ 14 дней)</div>
          {digest.risky.length === 0 ? (
            <p className="text-xs text-gray-400">Риска обнуления в ближайшие две недели нет.</p>
          ) : (
            <ul className="space-y-1">
              {digest.risky.slice(0, 5).map((r, i) => (
                <li key={i} className="text-xs text-gray-600 flex items-center gap-1.5">
                  <span className="px-1 rounded bg-red-100 text-red-700 text-[10px] font-bold tabular-nums">
                    ~{r.days} дн
                  </span>
                  <span className="truncate" title={r.name}>
                    {r.name}
                  </span>
                </li>
              ))}
              {digest.risky.length > 5 && (
                <li className="text-[10px] text-gray-400">и ещё {digest.risky.length - 5}…</li>
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
