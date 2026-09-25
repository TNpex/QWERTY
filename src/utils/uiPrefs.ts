/**
 * Небольшие UI-предпочтения устройства (хранятся в localStorage).
 *
 * Сейчас здесь одно: свёрнута ли служебная панель сайдбара («Загрузить другой
 * файл», настройки товаров, сведения о данных). По умолчанию свёрнута — на
 * телефоне она занимала пол-сайда и закрывала дашборд.
 */

export const SERVICE_PANEL_KEY = 'st-service-panel';

/** Свёрнутая панель — '0', раскрытая — '1', ничего/мусор — свёрнута */
export function resolveServicePanelOpen(stored: string | null): boolean {
  return stored === '1';
}

export function loadServicePanelOpen(): boolean {
  try {
    return resolveServicePanelOpen(localStorage.getItem(SERVICE_PANEL_KEY));
  } catch {
    return false;
  }
}

export function saveServicePanelOpen(open: boolean): void {
  try {
    localStorage.setItem(SERVICE_PANEL_KEY, open ? '1' : '0');
  } catch {
    /* приватный режим — настройка проживёт до перезагрузки */
  }
}
