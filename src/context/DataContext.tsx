import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import type { ParsedData } from '../types';
import { saveParsedData, loadParsedData, clearSavedData } from '../utils/storage';
import { loadBundledDataset, type HotProductConfig } from '../utils/bundledData';
import {
  collectDelistedProducts,
  productIdentityKey,
  type DelistedProduct,
  type HistorySnapshot,
  type ParserChange,
  type SizeSnapshot,
} from '../utils/historyCore';
import {
  loadSettings,
  saveSettings,
  mergeSettings,
  parseSettings,
  type ProductSettings,
} from '../utils/settings';
import type { Sport } from '../utils/sport';
import { loadProductImages, type ProductImageMap } from '../utils/images';
import {
  loadBrandOverrides,
  saveBrandOverrides,
  applyBrandOverrides,
  pruneAppliedOverrides,
  type BrandOverrides,
} from '../utils/overrides';

/** Глобальные фильтры — действуют на всех вкладках */
export interface DataFilters {
  /** 'all' или точное название бренда */
  brand: string;
  /** 'all' или точное название категории */
  category: string;
  /** 'all' | 'female' | 'male' | 'kids' | 'unisex' */
  gender: string;
  /** 'all' или подтип одежды (Носки, Футболки и поло, Шорты, ...) */
  subtype: string;
  /** 'all' | 'padel' | 'tennis' | 'other' — спортивная ориентация товара */
  sport: string;
}

export const ALL_FILTERS: DataFilters = {
  brand: 'all',
  category: 'all',
  gender: 'all',
  subtype: 'all',
  sport: 'all',
};

interface DataContextType {
  data: ParsedData | null;
  /** Завершено ли восстановление данных (встроенных или сохранённых) */
  hydrated: boolean;
  loading: boolean;
  error: string | null;
  /** История снимков остатков (датированные парсинги) */
  history: HistorySnapshot[];
  /** Журнал изменений от парсера (changes.csv) */
  parserChanges: ParserChange[];
  /** Встроенный набор данных (public/data), если он доступен */
  bundledData: ParsedData | null;
  /** Карта «путь товара → URL картинки» (public/data/product-images.json) */
  productImages: ProductImageMap;
  /** Снимки остатков по размерам (для продаж размерного ряда) */
  sizeSnapshots: SizeSnapshot[];
  /** Ходовые товары (public/data/hot-products.json) */
  hotProducts: HotProductConfig[];
  /** Ручные правки брендов (артикул → бренд), localStorage */
  brandOverrides: BrandOverrides;
  /** Задать бренд вручную (по артикулу; правка запомнится и попадёт в экспорт) */
  setBrandOverride: (article: string, brand: string) => void;
  /** Ручные настройки товаров (ориентация Падел/Теннис, исключения-услуги) */
  settings: ProductSettings;
  /** Задать ориентацию товара вручную; null — вернуть автоопределение */
  setSportOverride: (key: string, sport: Sport | null) => void;
  /** Исключить/вернуть товар в рекомендациях (услуги и т.п.) */
  setProductExcluded: (key: string, excluded: boolean) => void;
  /** Импорт настроек из JSON-строки; false — файл невалиден */
  importSettings: (json: string) => boolean;
  /** Товары, исчезнувшие из каталога (убраны с сайта = распроданы) */
  delistedProducts: DelistedProduct[];
  /** Глобальные фильтры (бренд / категория / пол / вид спорта) — все вкладки */
  filters: DataFilters;
  setFilters: (patch: Partial<DataFilters>) => void;
  resetFilters: () => void;
  setData: (data: ParsedData) => void;
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;
  clearData: () => void;
  /** Вернуться к встроенным данным (после загрузки своего файла) */
  restoreBundled: () => void;
}

const DataContext = createContext<DataContextType | null>(null);

/** Эффективная дата данных: для встроенных — дата снимка, для загруженных — момент загрузки */
function effectiveDate(data: ParsedData): number {
  const raw = data.asOf ?? data.uploadedAt;
  const time = raw ? Date.parse(raw) : NaN;
  return isFinite(time) ? time : 0;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setDataState] = useState<ParsedData | null>(null);
  const [bundledData, setBundledData] = useState<ParsedData | null>(null);
  const [history, setHistory] = useState<HistorySnapshot[]>([]);
  const [parserChanges, setParserChanges] = useState<ParserChange[]>([]);
  const [productImages, setProductImages] = useState<ProductImageMap>({});
  const [sizeSnapshots, setSizeSnapshots] = useState<SizeSnapshot[]>([]);
  const [hotProducts, setHotProducts] = useState<HotProductConfig[]>([]);
  const [brandOverrides, setBrandOverrides] = useState<BrandOverrides>({});
  const [settings, setSettingsState] = useState<ProductSettings>(() => loadSettings());
  const [filters, setFiltersState] = useState<DataFilters>(ALL_FILTERS);
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Стартовая загрузка: встроенные данные + история + журнал изменений + картинки,
  // затем — сохранённый в IndexedDB файл пользователя (если он свежее).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      loadProductImages().then((map) => {
        if (!cancelled) setProductImages(map);
      });

      let bundled: ParsedData | null = null;
      let snapshots: HistorySnapshot[] = [];
      let changes: ParserChange[] = [];
      let sizes: SizeSnapshot[] = [];
      let hot: HotProductConfig[] = [];
      try {
        const dataset = await loadBundledDataset();
        bundled = dataset.data;
        snapshots = dataset.history;
        changes = dataset.changes;
        sizes = dataset.sizeSnapshots;
        hot = dataset.hotProducts;
      } catch {
        // Встроенных данных нет (например, сборка без public/data) — не критично
      }

      const saved = await loadParsedData().catch(() => null);

      if (cancelled) return;

      // Ручные правки брендов применяются и к встроенным данным, и к загруженным.
      // Правки, уже отражённые в данных (apply-edits в CSV или автоочистка бренда
      // парсером/сайтом), убираются — счётчик «Правки брендов» в сайдбаре не висит.
      let overrides = loadBrandOverrides();
      const pruned = pruneAppliedOverrides(bundled, overrides);
      if (pruned.removed > 0) {
        overrides = pruned.kept;
        saveBrandOverrides(overrides);
      }

      // Выбираем более свежие данные: загруженный файл против встроенного снимка
      let chosen = bundled;
      if (saved && (!bundled || effectiveDate(saved) > effectiveDate(bundled))) {
        chosen = saved;
      }

      setBundledData(bundled ? applyBrandOverrides(bundled, overrides) : null);
      setHistory(snapshots);
      setParserChanges(changes);
      setSizeSnapshots(sizes);
      setHotProducts(hot);
      setBrandOverrides(overrides);
      if (chosen) setDataState(applyBrandOverrides(chosen, overrides));
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setFilters = useCallback((patch: Partial<DataFilters>) => {
    setFiltersState((current) => ({ ...current, ...patch }));
  }, []);

  // Ручная правка бренда: применяется ко всем товарам с этим артикулом
  // (в т.ч. встроенным), запоминается в localStorage и переживает перезагрузку.
  const setBrandOverride = useCallback(
    (article: string, brand: string) => {
      const key = article.trim();
      if (!key) return;
      setBrandOverrides((current) => {
        const next = { ...current };
        if (brand.trim()) next[key] = brand.trim();
        else delete next[key];
        saveBrandOverrides(next);
        const patch: BrandOverrides = {};
        patch[key] = brand.trim();
        setDataState((d) => (d ? applyBrandOverrides(d, brand.trim() ? patch : {}) : d));
        setBundledData((d) => (d ? applyBrandOverrides(d, brand.trim() ? patch : {}) : d));
        if (!brand.trim()) {
          // Сброс правки — восстановление исходного бренда требует перезагрузки;
          // оставляем как есть до следующего reload
        }
        return next;
      });
    },
    []
  );

  // Ручные настройки товаров: ориентация и исключения (localStorage)
  const setSportOverride = useCallback(
    (key: string, sport: Sport | null) => {
      setSettingsState((current) => {
        const sportOverrides = { ...current.sportOverrides };
        if (sport) sportOverrides[key] = sport;
        else delete sportOverrides[key];
        const next = { ...current, sportOverrides };
        saveSettings(next);
        return next;
      });
    },
    []
  );

  const setProductExcluded = useCallback(
    (key: string, excluded: boolean) => {
      setSettingsState((current) => {
        const excludedProducts = { ...current.excludedProducts };
        if (excluded) excludedProducts[key] = 'вручную';
        else delete excludedProducts[key];
        const next = { ...current, excludedProducts };
        saveSettings(next);
        return next;
      });
    },
    []
  );

  const importSettings = useCallback((json: string) => {
    const parsed = parseSettings(json);
    if (!parsed) return false;
    setSettingsState((current) => {
      const next = mergeSettings(current, parsed);
      saveSettings(next);
      return next;
    });
    return true;
  }, []);

  // Товары, исчезнувшие из каталога, но известные истории (для «Распроданных»)
  const delistedProducts = useMemo(() => {
    if (!data || history.length === 0) return [];
    const currentKeys = new Set(
      data.products.map((p) => productIdentityKey(p.link ?? '', p.article ?? '', p.name))
    );
    return collectDelistedProducts(history, currentKeys);
  }, [data, history]);

  const resetFilters = useCallback(() => setFiltersState(ALL_FILTERS), []);

  const setData = useCallback((newData: ParsedData) => {
    const withSource: ParsedData = { ...newData, source: newData.source ?? 'upload' };
    setDataState(withSource);
    setError(null);
    saveParsedData(withSource).catch(() => {
      /* приватный режим и т.п. — не критично */
    });
  }, []);

  const clearData = useCallback(() => {
    clearSavedData().catch(() => {
      /* не критично */
    });
    // Если есть встроенные данные — возвращаемся к ним, иначе на экран загрузки
    setDataState(bundledData);
    setError(null);
  }, [bundledData]);

  const restoreBundled = useCallback(() => {
    if (bundledData) {
      setDataState(bundledData);
      setError(null);
    }
  }, [bundledData]);

  const value = useMemo(
    () => ({
      data,
      hydrated,
      loading,
      error,
      history,
      parserChanges,
      bundledData,
      productImages,
      sizeSnapshots,
      hotProducts,
      brandOverrides,
      setBrandOverride,
      settings,
      setSportOverride,
      setProductExcluded,
      importSettings,
      delistedProducts,
      filters,
      setFilters,
      resetFilters,
      setData,
      setError,
      setLoading,
      clearData,
      restoreBundled,
    }),
    [
      data, hydrated, loading, error, history, parserChanges, bundledData,
      productImages, sizeSnapshots, hotProducts, brandOverrides, setBrandOverride,
      settings, setSportOverride, setProductExcluded, importSettings, delistedProducts,
      filters, setFilters, resetFilters, setData, clearData, restoreBundled,
    ]
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextType {
  const context = useContext(DataContext);
  if (!context) throw new Error('useData must be used within DataProvider');
  return context;
}
