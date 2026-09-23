import { useMemo } from 'react';
import { Filter, X } from 'lucide-react';
import { useData } from '../context/DataContext';
import { useBrands } from '../hooks/useAnalytics';

/**
 * Панель глобального фильтра по бренду для вкладок «Обзор» и «Аналитика»:
 * KPI, графики и сводки пересчитываются по выбранному бренду.
 */
export function BrandFilterBar() {
  const { data, brandFilter, setBrandFilter } = useData();
  const brands = useBrands();

  const productsShown = useMemo(() => {
    if (!data) return 0;
    return brandFilter === 'all'
      ? data.products.length
      : data.products.filter((p) => p.brand === brandFilter).length;
  }, [data, brandFilter]);

  if (!data || brands.length === 0) return null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-4 py-3 flex items-center gap-3 flex-wrap">
      <span className="text-sm font-medium text-gray-700 flex items-center gap-2">
        <Filter className="w-4 h-4 text-gray-400" />
        Бренд:
      </span>
      <select
        value={brandFilter}
        onChange={(e) => setBrandFilter(e.target.value)}
        className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white cursor-pointer focus:ring-2 focus:ring-blue-500"
      >
        <option value="all">Все бренды</option>
        {brands.map((brand) => (
          <option key={brand} value={brand}>
            {brand}
          </option>
        ))}
      </select>
      <span className="text-xs text-gray-500">
        товаров в выборке: <b className="text-gray-700">{productsShown}</b>
      </span>
      {brandFilter !== 'all' && (
        <button
          onClick={() => setBrandFilter('all')}
          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline"
        >
          <X className="w-3 h-3" />
          сбросить
        </button>
      )}
      <span className="text-[10px] text-gray-400 ml-auto hidden md:inline">
        влияет на KPI и графики этой вкладки
      </span>
    </div>
  );
}
