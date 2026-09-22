import { useMemo } from 'react';
import { useData } from '../context/DataContext';
import {
  getMetrics,
  getTransferRecommendations,
  getRestockRecommendations,
  type Metrics,
} from '../utils/analyticsCore';
import type { TransferRecommendation, RestockRecommendation } from '../types';

/**
 * Тонкие мемоизированные обёртки над чистыми функциями из analyticsCore.
 * Расчёт выполняется один раз на загрузку данных; компоненты могут вызывать
 * эти хуки многократно без повторных вычислений.
 */

export function useMetrics(): Metrics | null {
  const { data } = useData();
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
