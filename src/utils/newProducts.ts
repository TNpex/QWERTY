import type { ParserChange } from './historyCore';

/**
 * Новые товары (новинки) — по журналу парсера (changes.csv).
 *
 * Парсер пишет событие «Новый товар» / «Товар появился» с датой, поэтому
 * «новинка» = товар, который впервые попал в каталог недавно.
 *
 * ВАЖНО про первый парсинг: на самом первом снимке журнал помечает «новыми»
 * почти весь каталог (923 товара из 2240 за 23.09.2026) — это базовый срез,
 * а не поступление. Такая дата автоматически считается базовой и исключается
 * (если на неё приходится больше половины всех событий «новый товар»).
 */

/** Сколько дней товар считается новинкой */
export const NEW_PRODUCT_DAYS = 14;

/** Типы событий журнала, означающие появление товара */
export const NEW_PRODUCT_CHANGE_TYPES = ['Новый товар', 'Товар появился'];

export interface NewProductInfo {
  /** Дата первого появления (ISO или «ГГГГ-ММ-ДД ЧЧ:ММ:СС» из журнала) */
  firstSeen: string;
  /** Название из журнала (для подсказок) */
  name?: string;
}

export interface NewProductsOptions {
  /** Доля событий «новый товар» на самой ранней дате, при которой она считается базовым срезом */
  baselineShare?: number;
}

const normalizeArticle = (article: string): string => article.trim().toLowerCase();

/** Время события журнала (мс); 0, если дату не разобрать */
export function changeTime(date: string): number {
  const time = Date.parse(date);
  if (isFinite(time)) return time;
  // «2026-09-23 16:52:05» — Safari/старые браузеры не понимают пробел вместо T
  const iso = date.trim().replace(' ', 'T');
  const parsed = Date.parse(iso);
  return isFinite(parsed) ? parsed : 0;
}

/**
 * Карта «артикул → первое появление» по событиям «новый товар».
 * Базовый срез (первый парсинг, где «новыми» помечена половина каталога) исключается.
 */
export function collectNewProducts(
  changes: ParserChange[],
  options: NewProductsOptions = {}
): Map<string, NewProductInfo> {
  const baselineShare = options.baselineShare ?? 0.5;
  const newEvents = changes.filter((c) => NEW_PRODUCT_CHANGE_TYPES.includes(c.changeType));
  if (newEvents.length === 0) return new Map();

  // самая ранняя дата журнала — кандидат в «базовый срез»
  const dayOf = (date: string): string => date.trim().slice(0, 10);
  const byDay = new Map<string, number>();
  for (const event of newEvents) {
    const day = dayOf(event.date);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  const sortedDays = [...byDay.keys()].sort();
  const firstDay = sortedDays[0];
  const isBaseline =
    sortedDays.length > 1 && (byDay.get(firstDay) ?? 0) >= newEvents.length * baselineShare;

  const result = new Map<string, NewProductInfo>();
  for (const event of newEvents) {
    const article = normalizeArticle(event.article);
    if (!article) continue;
    if (isBaseline && dayOf(event.date) === firstDay) continue;
    const time = changeTime(event.date);
    const existing = result.get(article);
    if (!existing || (time > 0 && changeTime(existing.firstSeen) > time)) {
      result.set(article, {
        firstSeen: event.date,
        ...(event.name ? { name: event.name } : {}),
      });
    }
  }
  return result;
}

/** Товар считается новинкой: первое появление не раньше `days` дней от даты данных */
export function isNewProduct(
  info: NewProductInfo | undefined,
  asOf: string | undefined,
  days: number = NEW_PRODUCT_DAYS
): boolean {
  if (!info) return false;
  const seen = changeTime(info.firstSeen);
  if (!seen) return false;
  const now = asOf ? changeTime(asOf) || Date.parse(asOf) : Date.now();
  const reference = isFinite(now) && now ? now : Date.now();
  const ageDays = (reference - seen) / 86_400_000;
  return ageDays >= -1 && ageDays <= days;
}

/**
 * Готовый набор новинок: множество артикулов (в нижнем регистре), которые
 * считаются новыми на дату снимка данных.
 */
export function newProductArticles(
  changes: ParserChange[],
  asOf: string | undefined,
  days: number = NEW_PRODUCT_DAYS
): Set<string> {
  const collected = collectNewProducts(changes);
  const result = new Set<string>();
  for (const [article, info] of collected) {
    if (isNewProduct(info, asOf, days)) result.add(article);
  }
  return result;
}
