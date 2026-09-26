import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useFilteredData, useHistorySales } from '../hooks/useAnalytics';
import { isWarehouse, shortStoreLabel, sortStoresForDisplay } from '../utils/storeGroups';
import { runwayDays } from '../utils/insights';
import { navigate, routeToPath } from '../utils/router';
import type { Product } from '../types';

/**
 * Матрица «товар × магазин»: весь срез сети одним экраном.
 *
 * Цвет ячейки = состояние полки точки (нет/последняя штука/умеренно/много),
 * в подсказке — количество и «дней до обнуления» по снимкам истории.
 * Клик по строке открывает карточку товара (как в «Инвентаре»).
 */

const MAX_ROWS = 200;

interface CellState {
  carried: boolean;
  qty: number;
}

interface MatrixRow {
  product: Product;
  cells: Map<string, CellState>;
  zeros: number;
  total: number;
}

function cellClass(cell: CellState): string {
  if (!cell.carried) return 'bg-gray-100 text-gray-400';
  if (cell.qty <= 0) return 'bg-red-100 text-red-700';
  if (cell.qty === 1) return 'bg-amber-100 text-amber-700';
  if (cell.qty <= 3) return 'bg-emerald-100 text-emerald-700';
  return 'bg-emerald-200 text-emerald-800';
}

export function StockMatrix() {
  const data = useFilteredData();
  const sales = useHistorySales();
  const [query, setQuery] = useState('');
  const [onlyProblems, setOnlyProblems] = useState(true);

  const stores = useMemo(() => (data ? sortStoresForDisplay(data.stores) : []), [data]);

  const rows = useMemo<MatrixRow[]>(() => {
    if (!data) return [];
    const productById = new Map(data.products.map((p) => [p.id, p]));
    const storeNameById = new Map(data.stores.map((s) => [s.id, s.name]));
    const byProduct = new Map<string, Map<string, CellState>>();
    for (const item of data.inventory) {
      const storeName = storeNameById.get(item.storeId);
      if (!storeName) continue;
      let cells = byProduct.get(item.productId);
      if (!cells) {
        cells = new Map();
        byProduct.set(item.productId, cells);
      }
      const prev = cells.get(storeName);
      const carried = !item.notCarried;
      // товар может встречаться в нескольких размерах: суммуруем количества
      cells.set(storeName, {
        carried: carried || (prev?.carried ?? false),
        qty: (prev?.qty ?? 0) + (item.notCarried ? 0 : item.quantity),
      });
    }
    const result: MatrixRow[] = [];
    const q = query.trim().toLowerCase();
    for (const [productId, cells] of byProduct) {
      const product = productById.get(productId);
      if (!product) continue;
      if (q) {
        const haystack = `${product.name} ${product.brand} ${product.article ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) continue;
      }
      let zeros = 0;
      let total = 0;
      for (const cell of cells.values()) {
        total += cell.qty;
        if (cell.carried && cell.qty <= 0) zeros += 1;
      }
      if (onlyProblems && zeros === 0) continue;
      result.push({ product, cells, zeros, total });
    }
    return result.sort((a, b) => b.zeros - a.zeros || b.total - a.total || a.product.name.localeCompare(b.product.name, 'ru'));
  }, [data, query, onlyProblems]);

  if (!data) return null;

  const visible = rows.slice(0, MAX_ROWS);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h3 className="text-lg font-semibold text-gray-800">Матрица остатков: товар × магазин</h3>
        <div className="relative ml-auto">
          <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Название, бренд, артикул…"
            className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 w-56"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={onlyProblems}
            onChange={(e) => setOnlyProblems(e.target.checked)}
            className="rounded border-gray-300"
          />
          Только с дырами (есть точка с нулём)
        </label>
      </div>

      <div className="flex flex-wrap gap-3 mb-3 text-[10px] text-gray-500">
        <span className="flex items-center gap-1">
          <i className="w-3 h-3 rounded bg-red-100 border border-red-200 inline-block" /> нет на полке
        </span>
        <span className="flex items-center gap-1">
          <i className="w-3 h-3 rounded bg-amber-100 border border-amber-200 inline-block" /> последняя штука
        </span>
        <span className="flex items-center gap-1">
          <i className="w-3 h-3 rounded bg-emerald-100 border border-emerald-200 inline-block" /> 2–3 шт
        </span>
        <span className="flex items-center gap-1">
          <i className="w-3 h-3 rounded bg-emerald-200 border border-emerald-300 inline-block" /> 4 и больше
        </span>
        <span className="flex items-center gap-1">
          <i className="w-3 h-3 rounded bg-gray-100 border border-gray-200 inline-block" /> не возит
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-gray-400 py-10 text-center">
          {onlyProblems
            ? 'Проблемных позиций не найдено: у всех товаров под фильтрами есть остаток в каждой возимой точке.'
            : 'Ничего не найдено по запросу.'}
        </p>
      ) : (
        <div className="overflow-x-auto border border-gray-100 rounded-lg">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50 text-gray-500">
                <th className="text-left py-2 px-3 font-medium sticky left-0 bg-gray-50 min-w-[240px]">
                  Товар
                </th>
                <th className="text-center py-2 px-2 font-medium w-16">Всего</th>
                {stores.map((store) => (
                  <th
                    key={store.id}
                    className={`text-center py-2 px-1 font-bold w-12 ${
                      isWarehouse(store.name) ? 'text-blue-600' : 'text-gray-500'
                    }`}
                    title={store.name}
                  >
                    {shortStoreLabel(store.name)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr
                  key={row.product.id}
                  className="border-t border-gray-100 hover:bg-blue-50/40 cursor-pointer transition-colors"
                  onClick={(e) => {
                    // клик по внутренней ссылке обрабатывает сама ссылка
                    if ((e.target as HTMLElement).closest('a[href]')) return;
                    navigate({ tab: 'inventory', product: row.product.id });
                  }}
                  title="Открыть карточку товара"
                >
                  <td className="py-1.5 px-3 sticky left-0 bg-white">
                    <a
                      href={routeToPath({ tab: 'inventory', product: row.product.id })}
                      onClick={(e) => e.stopPropagation()}
                      className="font-medium text-gray-800 leading-snug line-clamp-1 hover:text-blue-600 hover:underline cursor-pointer"
                      title="Открыть карточку товара (Ctrl/средняя кнопка — в новой вкладке)"
                    >
                      {row.product.name}
                    </a>
                    <div className="text-[10px] text-gray-400">
                      {row.product.brand}
                      {row.product.article ? ` · ${row.product.article}` : ''}
                    </div>
                  </td>
                  <td className="text-center text-gray-600 font-semibold tabular-nums px-2">
                    {row.total}
                  </td>
                  {stores.map((store) => {
                    const cell = row.cells.get(store.name);
                    if (!cell || !cell.carried) {
                      return (
                        <td key={store.id} className="text-center py-1 px-1">
                          <span
                            className={`inline-flex items-center justify-center w-8 h-6 rounded text-[10px] font-medium ${cellClass(
                              { carried: false, qty: 0 }
                            )}`}
                            title={`${store.name}: не возит`}
                          >
                            —
                          </span>
                        </td>
                      );
                    }
                    const sold = row.product.link
                      ? (sales?.byProduct.get(row.product.link)?.byStore.get(store.name) ?? 0)
                      : 0;
                    const days = runwayDays(cell.qty, sold, sales?.days ?? 1);
                    const daysText =
                      cell.qty <= 0 ? '0 дн.' : days === null ? 'продаж не было' : `~${days} дн.`;
                    return (
                      <td key={store.id} className="text-center py-1 px-1">
                        <span
                          className={`inline-flex items-center justify-center w-8 h-6 rounded text-[10px] font-semibold tabular-nums ${cellClass(
                            cell
                          )}`}
                          title={`${store.name}: ${cell.qty} шт · дней до обнуления: ${daysText}`}
                        >
                          {cell.qty}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-[10px] text-gray-400">
        Показаны первые {visible.length} строк из {rows.length} (сортировка: у кого больше дыр).
        Фильтры сверху действуют на матрицу. Клик по строке — карточка товара; в подсказке ячейки —
        остаток и дни до обнуления точки.
      </p>
    </div>
  );
}
