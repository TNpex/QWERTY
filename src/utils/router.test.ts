import { describe, it, expect } from 'vitest';
import {
  HOME_ROUTE,
  TAB_PATHS,
  navigate,
  parseRoute,
  routeToPath,
  subscribe,
  type Route,
} from './router';
import type { TabId } from '../types';

describe('адреса разделов', () => {
  it('у каждой вкладки свой путь', () => {
    expect(TAB_PATHS).toEqual({
      dashboard: '/',
      inventory: '/inventory',
      sales: '/sales',
      transfers: '/transfers',
      restock: '/restock',
      stores: '/stores',
      analytics: '/analytics',
    });
  });

  it('путь → вкладка', () => {
    expect(parseRoute('/')).toEqual({ tab: 'dashboard' });
    expect(parseRoute('/inventory')).toEqual({ tab: 'inventory' });
    expect(parseRoute('/transfers')).toEqual({ tab: 'transfers' });
    expect(parseRoute('/stores')).toEqual({ tab: 'stores' });
    expect(parseRoute('/restock')).toEqual({ tab: 'restock' });
    expect(parseRoute('/sales')).toEqual({ tab: 'sales' });
    expect(parseRoute('/analytics')).toEqual({ tab: 'analytics' });
  });

  it('неизвестный адрес и хвостовой слэш → «Обзор» / та же вкладка', () => {
    expect(parseRoute('/какая-то-ерунда')).toEqual({ tab: 'dashboard' });
    expect(parseRoute('')).toEqual({ tab: 'dashboard' });
    expect(parseRoute('/transfers/')).toEqual({ tab: 'transfers' });
  });

  it('карточка товара — параметр ?product, область обзора — ?scope', () => {
    expect(parseRoute('/inventory', '?product=abc123')).toEqual({
      tab: 'inventory',
      product: 'abc123',
    });
    expect(parseRoute('/', '?scope=Уфа')).toEqual({ tab: 'dashboard', scope: 'Уфа' });
    // 'all' в адрес не пишется и из адреса не берётся
    expect(parseRoute('/', '?scope=all')).toEqual({ tab: 'dashboard' });
    expect(parseRoute('/transfers', '?product=x&scope=Уфа')).toEqual({
      tab: 'transfers',
      product: 'x',
      scope: 'Уфа',
    });
    // пустые значения игнорируются
    expect(parseRoute('/inventory', '?product=')).toEqual({ tab: 'inventory' });
  });

  it('маршрут → адрес (round-trip)', () => {
    const routes: Route[] = [
      { tab: 'dashboard' },
      { tab: 'inventory' },
      { tab: 'transfers', product: 'p1' },
      { tab: 'dashboard', scope: 'Екатеринбург (Парина)' },
      { tab: 'restock', product: 'p2', scope: 'Уфа' },
    ];
    for (const route of routes) {
      const path = routeToPath(route);
      const [pathname, search] = path.split('?');
      expect(parseRoute(pathname, search ? `?${search}` : '')).toEqual(route);
    }
  });

  it('адрес карточки товара кодируется и читается обратно (кириллица, пробелы)', () => {
    const path = routeToPath({ tab: 'stores', product: 'товар 1/2' });
    expect(path.startsWith('/stores?product=')).toBe(true);
    expect(parseRoute('/stores', path.slice(path.indexOf('?')))).toEqual({
      tab: 'stores',
      product: 'товар 1/2',
    });
  });

  it('область магазина в адресе — кириллица и скобки сохраняются', () => {
    const path = routeToPath({ tab: 'dashboard', scope: 'Екатеринбург (Елизаветинское шоссе)' });
    expect(parseRoute('/', path.slice(path.indexOf('?'))).scope).toBe(
      'Екатеринбург (Елизаветинское шоссе)'
    );
  });

  it('HOME_ROUTE — «Обзор» без параметров', () => {
    expect(HOME_ROUTE).toEqual({ tab: 'dashboard' });
    expect(routeToPath(HOME_ROUTE)).toBe('/');
  });
});

describe('переходы и подписка', () => {
  it('subscribe/navigate в среде без window не падают', () => {
    // тесты идут в node-окружении: роутер обязан это переживать
    const unsubscribe = subscribe(() => undefined);
    expect(() => navigate({ tab: 'transfers' })).not.toThrow();
    expect(() => navigate({ tab: 'inventory', product: 'p1' }, { replace: true })).not.toThrow();
    unsubscribe();
  });

  it('все вкладки достижимы переходом', () => {
    const tabs = Object.keys(TAB_PATHS) as TabId[];
    expect(tabs).toHaveLength(7);
    for (const tab of tabs) {
      expect(parseRoute(TAB_PATHS[tab]).tab).toBe(tab);
    }
  });
});
