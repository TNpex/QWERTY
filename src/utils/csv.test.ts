import { describe, it, expect } from 'vitest';
import { sniffDelimiter, parseDelimited, parseCSVText } from './csv';

describe('sniffDelimiter', () => {
  it('определяет запятую', () => {
    expect(sniffDelimiter('Товар,Размер,Магазин,Количество')).toBe(',');
  });

  it('определяет точку с запятой (русский Excel)', () => {
    expect(sniffDelimiter('Товар;Размер;Магазин;Количество')).toBe(';');
  });

  it('определяет табуляцию', () => {
    expect(sniffDelimiter('Товар\tРазмер\tМагазин')).toBe('\t');
  });

  it('не путается с разделителем внутри кавычек', () => {
    // В кавычках 3 запятые, но реальных разделителей «;» — 2
    expect(sniffDelimiter('"Кроссовки Nike, черные, 42";ТЦ Европа;3')).toBe(';');
  });
});

describe('parseDelimited', () => {
  it('парсит простые строки (LF)', () => {
    const rows = parseDelimited('a,b\n1,2\n3,4');
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('поддерживает CRLF (Windows) и BOM', () => {
    const rows = parseDelimited('\uFEFFa;b\r\n1;2\r\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('поддерживает кавычки с разделителем внутри и экранированные кавычки', () => {
    const rows = parseDelimited('name,qty\n"Кроссовки Nike, черные",3\n"Мяч ""Wilson""",5');
    expect(rows).toEqual([
      ['name', 'qty'],
      ['Кроссовки Nike, черные', '3'],
      ['Мяч "Wilson"', '5'],
    ]);
  });

  it('поддерживает перевод строки внутри кавычек', () => {
    const rows = parseDelimited('a,b\n"многострочное\nзначение",2');
    expect(rows).toEqual([
      ['a', 'b'],
      ['многострочное\nзначение', '2'],
    ]);
  });

  it('пропускает пустые строки', () => {
    const rows = parseDelimited('a,b\n\n1,2\n\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('parseCSVText', () => {
  it('превращает CSV в объекты «колонка → значение»', () => {
    const rows = parseCSVText('Товар;Магазин;Количество\nКроссовки Nike;ТЦ Европа;3\nМяч Wilson;Склад;5');
    expect(rows).toEqual([
      { Товар: 'Кроссовки Nike', Магазин: 'ТЦ Европа', Количество: '3' },
      { Товар: 'Мяч Wilson', Магазин: 'Склад', Количество: '5' },
    ]);
  });

  it('пропускает строки без единого значения', () => {
    const rows = parseCSVText('a,b\n1,2\n,\n3,4');
    expect(rows).toHaveLength(2);
  });

  it('обрабатывает отсутствующие хвостовые колонки', () => {
    const rows = parseCSVText('a,b,c\n1,2');
    expect(rows[0]).toEqual({ a: '1', b: '2', c: '' });
  });
});
