import { useMemo } from 'react';
import { Filter, X } from 'lucide-react';
import { useData } from '../context/DataContext';
import { useBrands, useCategories } from '../hooks/useAnalytics';
import { GENDER_LABELS, type Gender } from '../utils/productMeta';

/**
 * Глобальная панель фильтров (бренд / категория / пол) — работает на всех
 * вкладках: KPI, графики, таблицы, перемещения, дозакупка и продажи
 * пересчитываются по выбранной комбинации.
 */
export function FilterBar() {
  const { data, filters, setFilters, resetFilters } = useData();
  const brands = useBrands();
  const categories = useCategories();

  const productsShown = useMemo(() => {
    if (!data) return 0;
    return data.products.filter(
      (p) =>
        (filters.brand === 'all' || p.brand === filters.brand) &&
        (filters.category === 'all' || p.category === filters.category) &&
        (filters.gender === 'all' || (p.gender ?? 'unisex') === filters.gender)
    ).length;
  }, [data, filters]);

  if (!data) return null;

  const active = filters.brand !== 'all' || filters.category !== 'all' || filters.gender !== 'all';

  const selectClass =
    'px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white cursor-pointer focus:ring-2 focus:ring-blue-500 max-w-[220px]';

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-4 py-2.5 flex items-center gap-3 flex-wrap">
      <span className="text-sm font-medium text-gray-700 flex items-center gap-2">
        <Filter className="w-4 h-4 text-gray-400" />
        Фильтры:
      </span>
      <select
        value={filters.category}
        onChange={(e) => setFilters({ category: e.target.value })}
        className={selectClass}
        title="Категория"
      >
        <option value="all">Все категории</option>
        {categories.map((category) => (
          <option key={category} value={category}>
            {category}
          </option>
        ))}
      </select>
      <select
        value={filters.gender}
        onChange={(e) => setFilters({ gender: e.target.value })}
        className={selectClass}
        title="Пол / возраст"
      >
        <option value="all">Все: пол не важен</option>
        {(Object.keys(GENDER_LABELS) as Gender[]).map((gender) => (
          <option key={gender} value={gender}>
            {GENDER_LABELS[gender]}
          </option>
        ))}
      </select>
      <select
        value={filters.brand}
        onChange={(e) => setFilters({ brand: e.target.value })}
        className={selectClass}
        title="Бренд"
      >
        <option value="all">Все бренды</option>
        {brands.map((brand) => (
          <option key={brand} value={brand}>
            {brand}
          </option>
        ))}
      </select>
      <span className="text-xs text-gray-500">
        артикулов: <b className="text-gray-700">{productsShown}</b>
      </span>
      {active && (
        <button
          onClick={resetFilters}
          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline"
        >
          <X className="w-3 h-3" />
          сбросить
        </button>
      )}
      <span className="text-[10px] text-gray-400 ml-auto hidden xl:inline">
        фильтры действуют на всех вкладках
      </span>
    </div>
  );
}
