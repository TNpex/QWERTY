import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import type { ParsedData } from '../types';
import { saveParsedData, loadParsedData, clearSavedData } from '../utils/storage';

interface DataContextType {
  data: ParsedData | null;
  /** Завершено ли восстановление сохранённых данных из IndexedDB */
  hydrated: boolean;
  loading: boolean;
  error: string | null;
  setData: (data: ParsedData) => void;
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;
  clearData: () => void;
}

const DataContext = createContext<DataContextType | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setDataState] = useState<ParsedData | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Восстановление сохранённых данных при загрузке страницы
  useEffect(() => {
    let cancelled = false;
    loadParsedData()
      .then((saved) => {
        if (!cancelled && saved) setDataState(saved);
      })
      .catch(() => {
        /* хранилище недоступно — работаем без сохранения */
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setData = useCallback((newData: ParsedData) => {
    setDataState(newData);
    setError(null);
    saveParsedData(newData).catch(() => {
      /* приватный режим и т.п. — не критично */
    });
  }, []);

  const clearData = useCallback(() => {
    setDataState(null);
    setError(null);
    clearSavedData().catch(() => {
      /* не критично */
    });
  }, []);

  return (
    <DataContext.Provider
      value={{ data, hydrated, loading, error, setData, setError, setLoading, clearData }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData(): DataContextType {
  const context = useContext(DataContext);
  if (!context) throw new Error('useData must be used within DataProvider');
  return context;
}

// Примечание: аналитические расчёты живут в src/utils/analyticsCore.ts (чистые
// функции) и подключаются через хуки src/hooks/useAnalytics.ts. Дублирующих
// реализаций в контексте больше нет.
