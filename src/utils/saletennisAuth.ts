/**
 * Учётные данные saletennis.com для автозаказа «одним нажатием».
 *
 * Хранятся ТОЛЬКО в браузере устройства (localStorage), если пользователь
 * отметил «Запомнить». Дашборд передаёт их только своему серверному модулю
 * /api/saletennis-cart (Vercel), который использует их одноразово для входа
 * на saletennis.com — на сервере они не сохраняются и не логируются.
 */

export interface SaletennisCredentials {
  login: string;
  password: string;
}

const STORAGE_KEY = 'saletennis-credentials';

/** Безопасный разбор сохранённых учётных данных */
export function parseCredentials(json: string): SaletennisCredentials | null {
  try {
    const raw = JSON.parse(json) as { login?: unknown; password?: unknown };
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.login !== 'string' || typeof raw.password !== 'string') return null;
    if (!raw.login.trim() || !raw.password) return null;
    return { login: raw.login.trim(), password: raw.password };
  } catch {
    return null;
  }
}

export function loadCredentials(): SaletennisCredentials | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return parseCredentials(raw);
  } catch {
    return null;
  }
}

export function saveCredentials(credentials: SaletennisCredentials): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(credentials));
  } catch {
    /* приватный режим — не критично */
  }
}

export function clearCredentials(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* не критично */
  }
}
