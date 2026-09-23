import { describe, it, expect } from 'vitest';
import {
  isWarehouse,
  getStoreCity,
  sortStoresForDisplay,
  getTransferRoute,
  shortStoreLabel,
} from './storeGroups';

describe('isWarehouse', () => {
  it('распознаёт склад по названию', () => {
    expect(isWarehouse('Екатеринбург (Основной склад)')).toBe(true);
    expect(isWarehouse('Екб_Склад')).toBe(true);
    expect(isWarehouse('Санкт-Петербург (Спортивная)')).toBe(false);
    expect(isWarehouse('Уфа')).toBe(false);
  });
});

describe('getStoreCity', () => {
  it('определяет город по названию', () => {
    expect(getStoreCity('Санкт-Петербург (Ярослава Гашека)')).toBe('Санкт-Петербург');
    expect(getStoreCity('Санкт-Петербург (Спортивная)')).toBe('Санкт-Петербург');
    expect(getStoreCity('Екатеринбург (Парина)')).toBe('Екатеринбург');
    expect(getStoreCity('Екатеринбург (Основной склад)')).toBe('Екатеринбург');
    expect(getStoreCity('Тюмень (Народная)')).toBe('Тюмень');
    expect(getStoreCity('Уфа')).toBe('Уфа');
    expect(getStoreCity('Ижевск')).toBe('Ижевск');
  });
});

describe('sortStoresForDisplay', () => {
  it('группирует города (СПб → Екб → прочие), склад — последний', () => {
    const sorted = sortStoresForDisplay([
      { id: '1', name: 'Уфа' },
      { id: '2', name: 'Екатеринбург (Основной склад)' },
      { id: '3', name: 'Санкт-Петербург (Спортивная)' },
      { id: '4', name: 'Ижевск' },
      { id: '5', name: 'Екатеринбург (Парина)' },
      { id: '6', name: 'Санкт-Петербург (Ярослава Гашека)' },
      { id: '7', name: 'Тюмень (Народная)' },
      { id: '8', name: 'Екатеринбург (Соболева)' },
      { id: '9', name: 'Екатеринбург (Бисертская)' },
      { id: '10', name: 'Екатеринбург (Елизаветинское шоссе)' },
    ]).map((s) => s.name);

    expect(sorted[0]).toBe('Санкт-Петербург (Спортивная)');
    expect(sorted[1]).toBe('Санкт-Петербург (Ярослава Гашека)');
    // Все екатеринбургские розничные магазины идут подряд после СПб
    const ekbRetail = sorted.slice(2, 6);
    expect(ekbRetail.every((n) => n.startsWith('Екатеринбург'))).toBe(true);
    expect(sorted[6]).toBe('Тюмень (Народная)');
    expect(sorted[7]).toBe('Уфа');
    expect(sorted[8]).toBe('Ижевск');
    // Склад — строго последний
    expect(sorted[9]).toBe('Екатеринбург (Основной склад)');
  });
});

describe('getTransferRoute', () => {
  it('классифицирует маршруты', () => {
    expect(getTransferRoute('Екатеринбург (Основной склад)', 'Уфа')).toBe('warehouse');
    expect(getTransferRoute('Екатеринбург (Основной склад)', 'Екатеринбург (Парина)')).toBe('warehouse');
    expect(
      getTransferRoute('Санкт-Петербург (Спортивная)', 'Санкт-Петербург (Ярослава Гашека)')
    ).toBe('same-city');
    expect(getTransferRoute('Екатеринбург (Парина)', 'Уфа')).toBe('intercity');
    expect(getTransferRoute('Санкт-Петербург (Спортивная)', 'Уфа')).toBe('spb-expensive');
    expect(getTransferRoute('Санкт-Петербург (Спортивная)', 'Екатеринбург (Парина)')).toBe('spb-expensive');
  });
});

describe('shortStoreLabel', () => {
  it('реальные магазины сети SaleTennis', () => {
    expect(shortStoreLabel('Санкт-Петербург (Ярослава Гашека)')).toBe('СПБ-Я');
    expect(shortStoreLabel('Санкт-Петербург (Спортивная)')).toBe('СПБ-С');
    expect(shortStoreLabel('Екатеринбург (Парина)')).toBe('ЕКБ-П');
    expect(shortStoreLabel('Екатеринбург (Соболева)')).toBe('ЕКБ-С');
    expect(shortStoreLabel('Екатеринбург (Бисертская)')).toBe('ЕКБ-Б');
    expect(shortStoreLabel('Екатеринбург (Елизаветинское шоссе)')).toBe('ЕКБ-Е');
    expect(shortStoreLabel('Тюмень (Народная)')).toBe('ТЮМ-Н');
    expect(shortStoreLabel('Уфа')).toBe('УФА');
    expect(shortStoreLabel('Ижевск')).toBe('ИЖ');
    expect(shortStoreLabel('Екатеринбург (Основной склад)')).toBe('СКЛАД');
  });

  it('подписи уникальны для всех магазинов сети', () => {
    const names = [
      'Санкт-Петербург (Ярослава Гашека)',
      'Санкт-Петербург (Спортивная)',
      'Екатеринбург (Основной склад)',
      'Екатеринбург (Соболева)',
      'Екатеринбург (Парина)',
      'Екатеринбург (Бисертская)',
      'Екатеринбург (Елизаветинское шоссе)',
      'Тюмень (Народная)',
      'Уфа',
      'Ижевск',
    ];
    const labels = names.map(shortStoreLabel);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('неизвестные названия получают осмысленный фолбэк', () => {
    expect(shortStoreLabel('Казань (Центральная)')).toBe('КЗН-Ц');
    expect(shortStoreLabel('Новосибирск')).toBe('НОВ');
  });
});
