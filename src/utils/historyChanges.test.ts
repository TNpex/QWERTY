import { describe, it, expect } from 'vitest';
import { parseChangesCsv, excelSerialToDate } from './historyCore';

describe('excelSerialToDate', () => {
  it('конвертирует Excel-серийную дату в ISO', () => {
    // 46288.702835648146 → 2026-09-23 ~16:52
    const iso = excelSerialToDate(46288.702835648146);
    expect(iso.startsWith('2026-09-23')).toBe(true);
    expect(iso).toContain('16:5');
  });

  it('мусор → пустая строка', () => {
    expect(excelSerialToDate(NaN)).toBe('');
  });
});

describe('parseChangesCsv', () => {
  const rows = [
    {
      'Дата': '46288.702835648146',
      'Артикул': 'G1580023-TW',
      'Название': 'Майка детская Bidi Badu Twiggy Chill - Blue',
      'Категория': 'Одежда',
      'Тип изменения': 'Изменение количества',
      'Старое значение': '7',
      'Новое значение': '5',
      'Разница': '-2',
    },
    {
      'Дата': '46288.702835648146',
      'Артикул': 'X1',
      'Название': 'Мячи Wilson',
      'Категория': 'Мячи для тенниса',
      'Тип изменения': 'Товар закончился',
      'Старое значение': '3',
      'Новое значение': '0',
      'Разница': '-3',
    },
  ];

  it('парсит журнал изменений парсера', () => {
    const changes = parseChangesCsv(rows);
    expect(changes).toHaveLength(2);
    expect(changes[0].article).toBe('G1580023-TW');
    expect(changes[0].changeType).toBe('Изменение количества');
    expect(changes[0].diff).toBe(-2);
    expect(changes[0].date.startsWith('2026-09-23')).toBe(true);
    expect(changes[1].changeType).toBe('Товар закончился');
  });

  it('пустые/неверные строки → пустой список без ошибок', () => {
    expect(parseChangesCsv([])).toEqual([]);
    expect(parseChangesCsv([{ 'Что-то': '1' }])).toEqual([]);
  });
});
