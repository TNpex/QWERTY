import type { Product } from '../types';

/**
 * Спортивная ориентация товара: Падел / Теннис / Прочее.
 *
 * Определяется автоматически по категории и названию («Падел - Ракетки»,
 * «…для падела», «Теннисные струны», «сквош»…), но может быть переопределена
 * вручную в карточке товара — правка хранится в настройках (settings.ts)
 * и переживает перезагрузку. Ориентация используется:
 * - фильтром «Вид спорта» на всех вкладках;
 * - профилями магазинов (точка «только падел», «50/50», «только теннис»).
 */

export type Sport = 'padel' | 'tennis' | 'other';

export const SPORT_LABELS: Record<Sport, string> = {
  padel: 'Падел',
  tennis: 'Теннис',
  other: 'Теннис/Падел',
};

export const SPORT_ICONS: Record<Sport, string> = {
  padel: '🏓',
  tennis: '🎾',
  other: '🎽',
};

/** Категории, где товар по умолчанию теннисный (основа ассортимента сети) */
const TENNIS_BY_DEFAULT_MARKERS = ['одежда', 'обувь'];

/**
 * Автоопределение ориентации по категории и названию.
 * Порядок правил: падел → сквош/прочее → явный теннис → одежда/обувь = теннис → прочее.
 */
export function detectSport(category: string, name: string): Sport {
  const cat = (category ?? '').toLowerCase();
  const n = (name ?? '').toLowerCase();

  if (cat.includes('падел') || n.includes('падел') || n.includes('padel')) return 'padel';
  // Сквош — отдельный вид спорта, не теннис и не падел
  if (cat.includes('сквош') || n.includes('сквош') || n.includes('squash')) return 'other';
  if (cat.includes('теннис') || n.includes('теннис') || n.includes('tennis')) return 'tennis';
  // Одежда и обувь сети по умолчанию теннисные (падел-вещи помечены в названии)
  if (TENNIS_BY_DEFAULT_MARKERS.some((m) => cat.includes(m))) return 'tennis';
  return 'other';
}

/**
 * Стабильный ключ товара для ручных настроек (ориентация, исключения).
 * Артикул не уникален у цветовых вариантов, но настройки у вариантов одной
 * модели одинаковые; ссылка же меняется между парсингами — поэтому артикул,
 * затем нормализованная ссылка, затем название.
 */
export function productSettingsKey(product: Pick<Product, 'article' | 'link' | 'name'>): string {
  const article = (product.article ?? '').trim().toLowerCase();
  if (article) return article;
  const link = (product.link ?? '').trim().replace(/\/+$/, '').toLowerCase();
  if (link) return link;
  return (product.name ?? '').trim().toLowerCase();
}

/** Итоговая ориентация товара: ручная правка → автоопределение */
export function sportOf(
  product: Pick<Product, 'article' | 'link' | 'name' | 'category'>,
  overrides: Record<string, Sport> = {}
): Sport {
  const key = productSettingsKey(product);
  return overrides[key] ?? detectSport(product.category ?? '', product.name ?? '');
}
