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
import { loadBundledDataset } from '../utils/bundledData';
import type { HistorySnapshot, ParserChange } from '../utils/historyCore';
import { loadProductImages, type ProductImageMap } from '../utils/images';

/** Глобальные фильтры — действуют на всех вкладках */
export interface DataFilters {
  /** 'all' или точное название бренда */
  brand: string;
  /** 'all' или точное название категории */
  category: string;
  /** 'all' | 'female' | 'male' | 'kids' | 'unisex' */
  gender: string;
}

export const ALL_FILTERS: DataFilters = { brand: 'all', category: 'all', gender: 'all' };

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
  /** Глобальные фильтры (бренд / категория / пол) — все вкладки */
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
      try {
        const dataset = await loadBundledDataset();
        bundled = dataset.data;
        snapshots = dataset.history;
        changes = dataset.changes;
      } catch {
        // Встроенных данных нет (например, сборка без public/data) — не критично
      }

      const saved = await loadParsedData().catch(() => null);

      if (cancelled) return;

      // Выбираем более свежие данные: загруженный файл против встроенного снимка
      let chosen = bundled;
      if (saved && (!bundled || effectiveDate(saved) > effectiveDate(bundled))) {
        chosen = saved;
      }

      setBundledData(bundled);
      setHistory(snapshots);
      setParserChanges(changes);
      if (chosen) setDataState(chosen);
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setFilters = useCallback((patch: Partial<DataFilters>) => {
    setFiltersState((current) => ({ ...current, ...patch }));
  }, []);

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
      productImages, filters, setFilters, resetFilters, setData, clearData, restoreBundled,
    ]
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextType {
  const context = useContext(DataContext);
  if (!context) throw new Error('useData must be used within DataProvider');
  return context;
}
