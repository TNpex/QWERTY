import { SPORT_ICONS, SPORT_LABELS, type Sport } from '../utils/sport';

/** Компактный бейдж ориентации товара (🎾 Теннис / 🏓 Падел / 🎽 Прочее) */
export function SportBadge({ sport, title }: { sport: Sport; title?: string }) {
  const classes =
    sport === 'padel'
      ? 'bg-violet-100 text-violet-700'
      : sport === 'tennis'
        ? 'bg-emerald-100 text-emerald-700'
        : 'bg-gray-100 text-gray-500';
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${classes}`}
      title={title ?? `Ориентация: ${SPORT_LABELS[sport]}`}
    >
      {SPORT_ICONS[sport]} {SPORT_LABELS[sport]}
    </span>
  );
}
