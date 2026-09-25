/**
 * Тёмная тема интерфейса.
 *
 * Тема — это класс `dark` на <html> + слой переопределений цветовых утилит
 * Tailwind в src/styles/dark.css (файл генерируется: npm run build-dark).
 * Выбор запоминается в браузере; при первом заходе — по системной настройке
 * (prefers-color-scheme). Класс ставится инлайн-скриптом в index.html ДО
 * первой отрисовки, поэтому белой вспышки при загрузке нет.
 */

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'st-theme';

/** Чистая функция выбора темы: сохранённая → системная → светлая */
export function resolveTheme(stored: string | null, prefersDark: boolean): Theme {
  if (stored === 'dark' || stored === 'light') return stored;
  return prefersDark ? 'dark' : 'light';
}

function readStored(): string | null {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function prefersDark(): boolean {
  try {
    return typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function loadTheme(): Theme {
  return resolveTheme(readStored(), prefersDark());
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* приватный режим — тема останется до перезагрузки */
  }
}

/** Применить тему к документу (класс dark + цветовая схема для контролов) */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
}

export function toggleTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}
