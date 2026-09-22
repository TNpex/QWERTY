import type { ParsedData } from '../types';

/**
 * Минимальное хранилище загруженных данных на базе IndexedDB (без зависимостей).
 * Данные переживают перезагрузку страницы. Если IndexedDB недоступна
 * (приватный режим, старый браузер) — приложение работает без сохранения.
 */

const DB_NAME = 'saletennis-bi';
const DB_VERSION = 1;
const STORE_NAME = 'state';
const DATA_KEY = 'current';
const SCHEMA_VERSION = 1;

interface SavedState {
  v: number;
  savedAt: string;
  data: ParsedData;
}

function openDB(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function isValidParsedData(value: unknown): value is ParsedData {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ParsedData>;
  return (
    Array.isArray(candidate.stores) &&
    Array.isArray(candidate.products) &&
    Array.isArray(candidate.inventory)
  );
}

export async function saveParsedData(data: ParsedData): Promise<void> {
  const db = await openDB();
  if (!db) return;
  try {
    const payload: SavedState = { v: SCHEMA_VERSION, savedAt: new Date().toISOString(), data };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(payload, DATA_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadParsedData(): Promise<ParsedData | null> {
  const db = await openDB();
  if (!db) return null;
  try {
    const payload = await new Promise<SavedState | null>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).get(DATA_KEY);
        request.onsuccess = () => resolve((request.result as SavedState) ?? null);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    if (!payload || payload.v !== SCHEMA_VERSION) return null;
    return isValidParsedData(payload.data) ? payload.data : null;
  } finally {
    db.close();
  }
}

export async function clearSavedData(): Promise<void> {
  const db = await openDB();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(DATA_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  } finally {
    db.close();
  }
}
