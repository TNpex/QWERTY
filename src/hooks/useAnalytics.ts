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
 * данных/фильтров; компоненты могут вызывать хуки многократно без повторных
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

/** Список всех категорий в данных (для фильтров) */
export function useCategories(): string[] {
  const { data } = useData();
  return useMemo(() => {
    if (!data) return [];
    return [...new Set(data.products.map((p) => p.category))].sort((a, b) =>
      a.localeCompare(b, 'ru')
    );
  }, [data]);
}

/**
 * Данные с применёнными глобальными фильтрами (бренд / категория / пол).
 * Используют все вкладки: KPI, графики, таблицы, рекомендации.
 */
export function useFilteredData(): ParsedData | null {
  const { data, filters } = useData();
  return useMemo(() => {
    if (!data) return null;
    const { brand, category, gender } = filters;
    if (brand === 'all' && category === 'all' && gender === 'all') return data;
    const products = data.products.filter(
      (p) =>
        (brand === 'all' || p.brand === brand) &&
        (category === 'all' || p.category === category) &&
        (gender === 'all' || (p.gender ?? 'unisex') === gender)
    );
    const productIds = new Set(products.map((p) => p.id));
    const inventory = data.inventory.filter((i) => productIds.has(i.productId));
    return { ...data, products, inventory };
  }, [data, filters]);
}

export function useMetrics(): Metrics | null {
  const data = useFilteredData();
  return useMemo(() => (data ? getMetrics(data) : null), [data]);
}

export function useTransferRecommendations(): TransferRecommendation[] {
  const data = useFilteredData();
  return useMemo(() => (data ? getTransferRecommendations(data) : []), [data]);
}

export function useRestockRecommendations(): RestockRecommendation[] {
  const data = useFilteredData();
  return useMemo(() => (data ? getRestockRecommendations(data) : []), [data]);
}

/** Отчёт о продажах/движению по истории снимков; null, если снимков меньше двух */
export function useSalesReport(): SalesReport | null {
  const { history } = useData();
  return useMemo(() => analyzeSales(history), [history]);
}
