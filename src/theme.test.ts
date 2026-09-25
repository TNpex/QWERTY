import { describe, it, expect } from 'vitest';
import { resolveTheme, THEME_STORAGE_KEY, toggleTheme } from './theme';

describe('тема интерфейса', () => {
  it('сохранённый выбор важнее системной настройки', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('без сохранённого выбора — по системной настройке, иначе светлая', () => {
    expect(resolveTheme(null, true)).toBe('dark');
    expect(resolveTheme(null, false)).toBe('light');
    expect(resolveTheme('мусор', false)).toBe('light');
    expect(resolveTheme('', true)).toBe('dark');
  });

  it('переключение туда-обратно', () => {
    expect(toggleTheme('light')).toBe('dark');
    expect(toggleTheme('dark')).toBe('light');
  });

  it('ключ хранилища совпадает с инлайн-скриптом в index.html', () => {
    expect(THEME_STORAGE_KEY).toBe('st-theme');
  });
});
