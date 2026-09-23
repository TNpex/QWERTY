import { useMemo } from 'react';
import { useData } from '../context/DataContext';
import {
  getMetrics,
  getTransferRecommendations,
  getRestockRecommendations,
  type Metrics,
} from '../utils/analyticsCore';
import { analyzeSales, type SalesReport } from '../utils/historyCore';
import type { ParsedData, TransferRecommendation, RestockRecommendation } from '../types';

/**
 * Мемоизированные хуки аналитики. Расчёт выполняется один раз на изменение
 * данных/фильтра; компоненты могут вызывать хуки многократно без повторных
 * вычислений.
 */

/** Список всех брендов в данных (для фильтров) */
export function useBrands(): string[] {
  const { data } = useData();
  return useMemo(() => {
    if (!data) return [];
    return [...new Set(data.products.map((p) => p.brand))].sort((a, b) =>
      a.localeCompare(b, 'ru')
    );
  }, [data]);
}

/**
 * Данные с применённым глобальным фильтром по бренду (вкладки «Обзор» и
 * «Аналитика»). Магазины не меняются; товары и остатки отсекаются по бренду.
 */
export function useBrandFilteredData(): ParsedData | null {
  const { data, brandFilter } = useData();
  return useMemo(() => {
    if (!data || brandFilter === 'all') return data;
    const products = data.products.filter((p) => p.brand === brandFilter);
    const productIds = new Set(products.map((p) => p.id));
    const inventory = data.inventory.filter((i) => productIds.has(i.productId));
    return { ...data, products, inventory };
  }, [data, brandFilter]);
}

export function useMetrics(): Metrics | null {
  const data = useBrandFilteredData();
  return useMemo(() => (data ? getMetrics(data) : null), [data]);
}

export function useTransferRecommendations(): TransferRecommendation[] {
  const { data } = useData();
  return useMemo(() => (data ? getTransferRecommendations(data) : []), [data]);
}

export function useRestockRecommendations(): RestockRecommendation[] {
  const { data } = useData();
  return useMemo(() => (data ? getRestockRecommendations(data) : []), [data]);
}

/** Отчёт о продажах/движении по истории снимков; null, если снимков меньше двух */
export function useSalesReport(): SalesReport | null {
  const { history } = useData();
  return useMemo(() => analyzeSales(history), [history]);
}
