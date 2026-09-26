import { runwayLevel, RUNWAY_LEVEL_LABELS, type RunwayLevel } from '../utils/insights';

const LEVEL_CLASS: Record<RunwayLevel, string> = {
  out: 'bg-red-100 text-red-700',
  low: 'bg-red-100 text-red-700',
  mid: 'bg-amber-100 text-amber-700',
  ok: 'bg-emerald-100 text-emerald-700',
  idle: 'bg-gray-100 text-gray-500',
};

/**
 * Бейдж «дней до обнуления» полки: остаток / средняя скорость продаж по
 * снимкам. «—» — продаж за окно истории не было, скорость неизвестна.
 */
export function RunwayBadge({
  quantity,
  days,
  storeName,
  className = '',
}: {
  quantity: number;
  days: number | null;
  /** Подсказка уточняет, по какой точке посчитано */
  storeName?: string;
  className?: string;
}) {
  const level = runwayLevel(quantity, days);
  const text = quantity <= 0 ? '0 дн.' : days === null ? '—' : `~${days} дн.`;
  const detail =
    days === null && quantity > 0
      ? 'продаж за окно истории не было — скорость неизвестна'
      : `при текущей скорости продаж`;
  const title = `Дней до обнуления: ${text} ${detail}${storeName ? ` (${storeName})` : ''}. ${RUNWAY_LEVEL_LABELS[level]}.`;
  return (
    <span
      title={title}
      className={`inline-flex items-center justify-center min-w-[2rem] h-6 px-1.5 rounded text-[10px] font-semibold tabular-nums ${LEVEL_CLASS[level]} ${className}`}
    >
      {text}
    </span>
  );
}
