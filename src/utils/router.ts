import { useCallback, useEffect, useState } from 'react';
import type { TabId } from '../types';

/**
 * Маршрутизация вкладок: у каждой страницы свой адрес, поэтому работают
 * кнопки «Назад»/«Вперёд» браузера, ссылка на нужный раздел копируется,
 * а перезагрузка страницы оставляет вас там же, где вы были.
 *
 * Адреса:
 *   /                 — 📊 Обзор
 *   /inventory        — 🎾 Инвентарь
 *   /sales            — 🔥 Продажи
 *   /transfers        — 🔄 Перемещения
 *   /restock          — 🛒 Дозакупка
 *   /stores           — 🏬 Магазины
 *   /analytics        — 📈 Аналитика
 *   ?product=<id>     — карточка товара поверх раздела (кнопка «Назад» её закрывает)
 *   /?scope=<магазин> — область «Обзора» (конкретный магазин вместо всей сети)
 *
 * Роутер свой (без зависимостей): History API + событие popstate. Если
 * history.pushState недоступен (открытие файла прямо с диска, ограничения
 * браузера) — приложение продолжает работать, просто без смены адреса.
 *
 * ⚠️ Для «чистых» адресов хостинг должен отдавать index.html на любой путь:
 * - Vercel: vercel.json → rewrites (добавлен в репозиторий);
 * - nginx:  location / { try_files $uri $uri/ /index.html; }
 * - Apache: RewriteCond/RewriteRule из README (раздел «Страницы и ссылки»).
 */

export const TAB_PATHS: Record<TabId, string> = {
  dashboard: '/',
  inventory: '/inventory',
  matrix: '/matrix',
  sales: '/sales',
  transfers: '/transfers',
  restock: '/restock',
  stores: '/stores',
  analytics: '/analytics',
};

const PATH_TO_TAB = new Map<string, TabId>(
  (Object.keys(TAB_PATHS) as TabId[]).map((tab) => [TAB_PATHS[tab], tab])
);

export interface Route {
  tab: TabId;
  /** id товара: карточка открыта поверх раздела */
  product?: string;
  /** область «Обзора»: название магазина ('all' не пишется в адрес) */
  scope?: string;
}

export const HOME_ROUTE: Route = { tab: 'dashboard' };

const hasWindow = typeof window !== 'undefined';

/** Базовый путь приложения (если сайт лежит не в корне домена) */
export function basePath(): string {
  const base = import.meta.env?.BASE_URL ?? '/';
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

/** Разбор адреса → маршрут (чистая функция, покрыта тестами) */
export function parseRoute(pathname: string, search = ''): Route {
  const base = basePath();
  let path = pathname || '/';
  if (base && path.startsWith(base)) path = path.slice(base.length) || '/';
  // хвостовой слэш не важен: /transfers/ == /transfers
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

  const tab = PATH_TO_TAB.get(path) ?? PATH_TO_TAB.get(path.toLowerCase()) ?? 'dashboard';
  const route: Route = { tab };

  const params = new URLSearchParams(search);
  const product = params.get('product')?.trim();
  if (product) route.product = product;
  const scope = params.get('scope')?.trim();
  if (scope && scope !== 'all') route.scope = scope;
  return route;
}

/** Маршрут → адрес (чистая функция, покрыта тестами) */
export function routeToPath(route: Route): string {
  const params = new URLSearchParams();
  if (route.product) params.set('product', route.product);
  if (route.scope && route.scope !== 'all') params.set('scope', route.scope);
  const query = params.toString();
  const path = `${basePath()}${TAB_PATHS[route.tab] ?? '/'}`;
  return query ? `${path}?${query}` : path;
}

export function currentRoute(): Route {
  if (!hasWindow) return { ...HOME_ROUTE };
  return parseRoute(window.location.pathname, window.location.search);
}

// ---- История переходов ----

type Listener = () => void;
const listeners = new Set<Listener>();
let popstateBound = false;

function emit(): void {
  for (const listener of [...listeners]) listener();
}

function bindPopstate(): void {
  if (popstateBound || !hasWindow) return;
  popstateBound = true;
  window.addEventListener('popstate', emit);
}

export function subscribe(listener: Listener): () => void {
  bindPopstate();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export interface NavigateOptions {
  /** Заменить текущую запись истории вместо добавления (кнопка «Назад» не вернётся сюда) */
  replace?: boolean;
}

/** Переход на раздел/карточку товара (с обновлением адреса и истории) */
export function navigate(route: Route, options: NavigateOptions = {}): void {
  if (!hasWindow) return;
  const url = routeToPath(route);
  const sameUrl = url === `${window.location.pathname}${window.location.search}`;
  if (sameUrl) return;
  try {
    if (options.replace) window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
  } catch {
    /* файл с диска / ограничения браузера — работаем без смены адреса */
  }
  emit();
}

/** Назад силами браузера (работает для карточки товара и вкладок) */
export function navigateBack(fallback: Route = HOME_ROUTE): void {
  if (!hasWindow) return;
  if (window.history.length > 1) window.history.back();
  else navigate(fallback, { replace: true });
}

/** Хук текущей страницы: перечитывается при переходах и на «Назад»/«Вперёд» */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(currentRoute);
  useEffect(() => subscribe(() => setRoute(currentRoute())), []);
  return route;
}

/**
 * Переход на вкладку (для кнопок сайдбара и карточек «Обзора»).
 * Выбранный магазин (?scope=…) переносится между вкладками: выбрали точку
 * в «Обзоре» → перешли в «Инвентарь» → он открыт на ней же.
 */
export function useNavigateTab(): (tab: TabId) => void {
  const route = useRoute();
  return useCallback(
    (tab: TabId) => navigate({ tab, ...(route.scope ? { scope: route.scope } : {}) }),
    [route.scope]
  );
}

/**
 * Карточка товара как часть адреса: `?product=<id>`.
 * Открытие добавляет запись в историю, закрытие — заменяет её, поэтому
 * «Назад» в браузере закрывает карточку и возвращает в список, а ссылка
 * на конкретный товар копируется и открывается напрямую.
 */
export function useProductRoute(tab: TabId): {
  productId: string | null;
  openProduct: (id: string) => void;
  closeProduct: () => void;
} {
  const route = useRoute();
  const productId = route.tab === tab ? route.product ?? null : null;

  const openProduct = useCallback(
    (id: string) => navigate({ ...route, tab, product: id }),
    [route, tab]
  );
  const closeProduct = useCallback(() => {
    const next: Route = { tab };
    if (route.scope && tab === 'dashboard') next.scope = route.scope;
    navigate(next, { replace: true });
  }, [route.scope, tab]);

  return { productId, openProduct, closeProduct };
}
