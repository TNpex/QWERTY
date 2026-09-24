import type { Sport } from './sport';

/**
 * Ручные настройки товаров — «как можно проще»: всё хранится в браузере
 * (localStorage) и переживает перезагрузки. Для переноса между компьютерами
 * и фиксации «для всех» есть экспорт/импорт JSON (сайдбар): админ скачивает
 * файл, передаёт коллегам (или коммитит в public/data/, чтобы настройки
 * стали общими для сайта — см. bundledSettings).
 *
 * Состав:
 * - sportOverrides: ручная ориентация товара (Падел/Теннис/Прочее);
 * - excludedProducts: товары-услуги и исключённые вручную — НЕ участвуют
 *   в рекомендациях «Перемещения» и «Дозакупка» (выбор запоминается).
 */

const STORAGE_KEY = 'saletennis-product-settings';

export interface ProductSettings {
  /** ключ товара (productSettingsKey) → ориентация */
  sportOverrides: Record<string, Sport>;
  /** ключ товара → причина исключения ('услуга' | 'вручную') */
  excludedProducts: Record<string, string>;
}

export const EMPTY_SETTINGS: ProductSettings = {
  sportOverrides: {},
  excludedProducts: {},
};

/** Достаёт значение из произвольного объекта по списку ключей (валидация импорта) */
function pickRecord(raw: unknown, allowed?: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return result;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string' || !key.trim()) continue;
    if (allowed && !allowed.includes(value)) continue;
    result[key] = value;
  }
  return result;
}

/** Безопасный разбор JSON настроек (из файла или localStorage) */
export function parseSettings(json: string): ProductSettings | null {
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return {
      sportOverrides: pickRecord(raw.sportOverrides, ['padel', 'tennis', 'other']) as Record<
        string,
        Sport
      >,
      excludedProducts: pickRecord(raw.excludedProducts),
    };
  } catch {
    return null;
  }
}

export function loadSettings(): ProductSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_SETTINGS;
    return parseSettings(raw) ?? EMPTY_SETTINGS;
  } catch {
    return EMPTY_SETTINGS;
  }
}

export function saveSettings(settings: ProductSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* приватный режим — не критично */
  }
}

/** Объединяет входящие настройки с текущими (импорт файла) */
export function mergeSettings(
  current: ProductSettings,
  incoming: ProductSettings
): ProductSettings {
  return {
    sportOverrides: { ...current.sportOverrides, ...incoming.sportOverrides },
    excludedProducts: { ...current.excludedProducts, ...incoming.excludedProducts },
  };
}

export function settingsToJson(settings: ProductSettings): string {
  return JSON.stringify(settings, null, 2);
}

/** Скачивание настроек файлом product-settings.json */
export function downloadSettings(settings: ProductSettings): void {
  const blob = new Blob([settingsToJson(settings)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'product-settings.json';
  link.click();
  URL.revokeObjectURL(url);
}

/** Сводка для сайдбара: сколько правок ориентации и исключений задано */
export function settingsCounts(settings: ProductSettings): {
  sports: number;
  excluded: number;
} {
  return {
    sports: Object.keys(settings.sportOverrides).length,
    excluded: Object.keys(settings.excludedProducts).length,
  };
}
