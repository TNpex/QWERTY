import { describe, it, expect } from 'vitest';
import { resolveServicePanelOpen, SERVICE_PANEL_KEY } from './uiPrefs';

describe('служебная панель сайдбара (uiPrefs)', () => {
  it('раскрыта только при явном «1»', () => {
    expect(resolveServicePanelOpen('1')).toBe(true);
  });

  it('свёрнута по умолчанию: null, «0», пусто, мусор', () => {
    expect(resolveServicePanelOpen(null)).toBe(false);
    expect(resolveServicePanelOpen('0')).toBe(false);
    expect(resolveServicePanelOpen('')).toBe(false);
    expect(resolveServicePanelOpen('мусор')).toBe(false);
  });

  it('ключ хранилища стабилен', () => {
    expect(SERVICE_PANEL_KEY).toBe('st-service-panel');
  });
});
