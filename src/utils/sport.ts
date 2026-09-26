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

/**
 * Универсальные товарные группы: одежда, обувь и носки подходят и теннисистам,
 * и падел-игрокам, поэтому по умолчанию получают ориентацию «Теннис/Падел»,
 * а не «Теннис».
 *
 * Почему это важно: магазин с профилем «🏓 Только падел» не получает товары
 * чужой ориентации — пока одежда и обувь считались теннисными, такая точка
 * теряла весь ассортимент одежды (830 позиций из 850). Ориентация «Теннис/Падел»
 * подходит любой точке (см. assortmentBlock в storeRules.ts).
 *
 * Явный падел в названии/категории («Кроссовки Joma Spin Padel») по-прежнему
 * даёт «Падел», а ручная правка в карточке товара важнее автоопределения.
 */
const UNIVERSAL_MARKERS = ['одежда', 'обувь', 'носк', 'socks'];

/**
 * Автоопределение ориентации по категории и названию.
 * Порядок правил: явный падел → сквош/прочее → одежда/обувь/носки = универсальные
 * → явный теннис → прочее.
 */
export function detectSport(category: string, name: string): Sport {
  const cat = (category ?? '').toLowerCase();
  const n = (name ?? '').toLowerCase();

  if (cat.includes('падел') || n.includes('падел') || n.includes('padel')) return 'padel';
  // Сквош — отдельный вид спорта, не теннис и не падел
  if (cat.includes('сквош') || n.includes('сквош') || n.includes('squash')) return 'other';
  // Одежда, обувь и носки — универсальные: в них играют и теннис, и падел
  if (UNIVERSAL_MARKERS.some((m) => cat.includes(m) || n.includes(m))) return 'other';
  if (cat.includes('теннис') || n.includes('теннис') || n.includes('tennis')) return 'tennis';
  return 'other';
}

/**
 * Стабильный ключ товара для ручных настроек (ориентация, исключения,
 * ходовые, минимумы, запреты).
 *
 * Артикул НЕ уникален: разные позиции (цветовые варианты и даже разные
 * модели) могут иметь один артикул — настройки, привязанные к артикулу,
 * «склеивались» между такими товарами. Уникальный идентификатор товара —
 * ссылка на страницу (нормализованная), поэтому порядок такой:
 * ссылка → артикул+название → название.
 */
export function productSettingsKey(product: Pick<Product, 'article' | 'link' | 'name'>): string {
  const link = (product.link ?? '').trim().replace(/\/+$/, '').toLowerCase();
  if (link) return link;
  const article = (product.article ?? '').trim().toLowerCase();
  const name = (product.name ?? '').trim().toLowerCase();
  if (article) return name ? `${article}::${name}` : article;
  return name;
}

/** Итоговая ориентация товара: ручная правка → автоопределение */
export function sportOf(
  product: Pick<Product, 'article' | 'link' | 'name' | 'category'>,
  overrides: Record<string, Sport> = {}
): Sport {
  const key = productSettingsKey(product);
  return overrides[key] ?? detectSport(product.category ?? '', product.name ?? '');
}
