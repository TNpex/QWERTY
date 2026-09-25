import { useCallback, useMemo } from 'react';
import { useData } from '../context/DataContext';
import { navigate, useRoute } from '../utils/router';
import { ALL_SCOPE, type OverviewScope } from '../utils/storeScope';
import type { Store } from '../types';

/**
 * Общая область «какой магазин сейчас смотрим» — одна на все вкладки.
 *
 * Значение живёт в адресе (`?scope=Уфа`), поэтому:
 * - выбор магазина переносится между вкладками: выбрали точку в «Обзоре» →
 *   перешли в «Инвентарь» → он открыт на ней же;
 * - «Мой магазин» из сайдбара — значение по умолчанию (если в адресе области нет);
 * - ссылка на раздел с конкретным магазином копируется и открывается как есть;
 * - «🌐 Вся сеть» — область без параметра (`?scope` не пишется).
 */
export interface StoreScope {
  /** 'all' или точное название магазина */
  scope: OverviewScope;
  isAll: boolean;
  /** Магазин области (null для «всей сети» и для неизвестного названия) */
  store: Store | null;
  storeId: string | null;
  /** Переключить область (пишется в адрес, заменяя текущую запись истории) */
  setScope: (next: OverviewScope) => void;
}

export function useStoreScope(): StoreScope {
  const { data, storeProfile } = useData();
  const route = useRoute();

  const store = useMemo(() => {
    const requested = route.scope || storeProfile || '';
    if (!requested || !data) return null;
    return data.stores.find((s) => s.name === requested) ?? null;
  }, [data, route.scope, storeProfile]);

  // Пустая строка («Вся сеть (не выбран)» в сайдбаре) и неизвестное название —
  // это ВСЯ СЕТЬ: раньше '' уходило в расчёт как имя магазина и давало нули.
  const scope: OverviewScope = store ? store.name : ALL_SCOPE;

  const setScope = useCallback(
    (next: OverviewScope) => {
      const value = next && next !== ALL_SCOPE ? next : undefined;
      navigate({ tab: route.tab, ...(route.product ? { product: route.product } : {}), ...(value ? { scope: value } : {}) }, { replace: true });
    },
    [route.tab, route.product]
  );

  return {
    scope,
    isAll: scope === ALL_SCOPE,
    store,
    storeId: store?.id ?? null,
    setScope,
  };
}
