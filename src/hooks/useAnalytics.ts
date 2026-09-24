import { useCallback, useMemo } from 'react';
import { useData } from '../context/DataContext';
import {
  getMetrics,
  getTransferRecommendations,
  getRestockRecommendations,
  type Metrics,
} from '../utils/analyticsCore';
import {
  analyzeSales,
  analyzeSizeSales,
  lastKnownSizes,
  type LastKnownSizes,
  type SalesReport,
  type SizeSalesReport,
} from '../utils/historyCore';
import { sportOf, productSettingsKey } from '../utils/sport';
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

/** Список подтипов одежды (Носки, Футболки и поло, ...) — для фильтров */
export function useSubtypes(): string[] {
  const { data } = useData();
  return useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    for (const product of data.products) {
      if (product.subtype) set.add(product.subtype);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [data]);
}

/**
 * Данные с применёнными глобальными фильтрами (бренд / категория / пол / подтип).
 * Используют все вкладки: KPI, графики, таблицы, рекомендации.
 */
export function useFilteredData(): ParsedData | null {
  const { data, filters, settings } = useData();
  return useMemo(() => {
    if (!data) return null;
    const { brand, category, gender, subtype, sport } = filters;
    if (
      brand === 'all' &&
      category === 'all' &&
      gender === 'all' &&
      subtype === 'all' &&
      sport === 'all'
    ) {
      return data;
    }
    const products = data.products.filter(
      (p) =>
        (brand === 'all' || p.brand === brand) &&
        (category === 'all' || p.category === category) &&
        (gender === 'all' || (p.gender ?? 'unisex') === gender) &&
        (subtype === 'all' || (p.subtype ?? '') === subtype) &&
        (sport === 'all' || sportOf(p, settings.sportOverrides) === sport)
    );
    const productIds = new Set(products.map((p) => p.id));
    const inventory = data.inventory.filter((i) => productIds.has(i.productId));
    return { ...data, products, inventory };
  }, [data, filters, settings]);
}

/**
 * Данные без исключённых товаров (услуги и снятые с рекомендаций вручную).
 * Исключения влияют ТОЛЬКО на перемещения и дозакупку — KPI, продажи и
 * инвентарь показывают полную картину.
 */
function useDataWithoutExcluded(): ParsedData | null {
  const data = useFilteredData();
  const { settings } = useData();
  return useMemo(() => {
    if (!data) return null;
    const excluded = settings.excludedProducts;
    if (Object.keys(excluded).length === 0) return data;
    const products = data.products.filter((p) => !excluded[productSettingsKey(p)]);
    if (products.length === data.products.length) return data;
    const productIds = new Set(products.map((p) => p.id));
    const inventory = data.inventory.filter((i) => productIds.has(i.productId));
    return { ...data, products, inventory };
  }, [data, settings]);
}

export function useMetrics(): Metrics | null {
  const data = useFilteredData();
  return useMemo(() => (data ? getMetrics(data) : null), [data]);
}

export function useTransferRecommendations(): TransferRecommendation[] {
  const data = useDataWithoutExcluded();
  const isHot = useIsHot();
  return useMemo(() => {
    if (!data) return [];
    const recs = getTransferRecommendations(data);
    const byId = new Map(data.products.map((p) => [p.id, p]));
    // Ходовые товары (🔥 из hot-products.json или отмеченные вручную) — первыми.
    // Сортировка устойчивая: группы вариантов одного дефицита не разрываются.
    return [...recs].sort((a, b) => {
      const pa = byId.get(a.productId);
      const pb = byId.get(b.productId);
      return Number(pb ? isHot(pb) : false) - Number(pa ? isHot(pa) : false);
    });
  }, [data, isHot]);
}

export function useRestockRecommendations(): RestockRecommendation[] {
  const data = useDataWithoutExcluded();
  const { hotProducts, settings } = useData();
  return useMemo(() => {
    if (!data) return [];
    // Дозакупка — только товары, отмеченные «Поставляется» в карточке товара
    // (большинство позиций закупается разово). Ходовые из hot-products.json
    // считаются поставляемыми автоматически — у них явный норматив запаса.
    const hotArticles = new Set(hotProducts.map((h) => h.article.trim().toLowerCase()));
    const supplied = data.products.filter((p) => {
      if (settings.suppliedProducts[productSettingsKey(p)]) return true;
      return Boolean(p.article && hotArticles.has(p.article.trim().toLowerCase()));
    });
    if (supplied.length === 0) return [];
    const ids = new Set(supplied.map((p) => p.id));
    const scoped: ParsedData = {
      ...data,
      products: supplied,
      inventory: data.inventory.filter((i) => ids.has(i.productId)),
    };
    return getRestockRecommendations(scoped, hotProducts);
  }, [data, hotProducts, settings]);
}

/** Отчёт о продажах/движении по истории снимков; null, если снимков меньше двух */
export function useSalesReport(): SalesReport | null {
  const { history } = useData();
  return useMemo(() => analyzeSales(history), [history]);
}

/** Продажи по размерам (популярность размерного ряда); null при одном снимке */
export function useSizeSalesReport(): SizeSalesReport | null {
  const { sizeSnapshots } = useData();
  return useMemo(() => analyzeSizeSales(sizeSnapshots), [sizeSnapshots]);
}

/**
 * Ходовой товар: входит в hot-products.json (по артикулу) ИЛИ отмечен вручную
 * в карточке товара. Используется для 🔥-бейджей и приоритета в перемещениях.
 */
export function useIsHot(): (product: {
  article?: string;
  link?: string;
  name: string;
}) => boolean {
  const { hotProducts, settings } = useData();
  const hotArticles = useMemo(
    () => new Set(hotProducts.map((h) => h.article.trim().toLowerCase())),
    [hotProducts]
  );
  return useCallback(
    (product) => {
      if (settings.hotProducts[productSettingsKey(product)]) return true;
      const article = (product.article ?? '').trim().toLowerCase();
      return article.length > 0 && hotArticles.has(article);
    },
    [hotArticles, settings]
  );
}

/**
 * Поиск последних размеров товара по снимкам sizes (для распроданных позиций:
 * «какой размер был на сайте последним» = какой размер купили).
 */
export function useLastKnownSizes(): (product: {
  article?: string;
  link?: string;
  name?: string;
}) => LastKnownSizes | null {
  const { sizeSnapshots } = useData();
  return useMemo(
    () => (product: { article?: string; link?: string; name?: string }) =>
      lastKnownSizes(sizeSnapshots, product),
    [sizeSnapshots]
  );
}

/** Set артикулов ходовых товаров (для бейджей в таблицах) */
export function useHotArticles(): Set<string> {
  const { hotProducts } = useData();
  return useMemo(
    () => new Set(hotProducts.map((h) => h.article.trim().toLowerCase())),
    [hotProducts]
  );
}
