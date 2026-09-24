import { describe, it, expect } from 'vitest';
import { detectSport, sportOf, productSettingsKey } from './sport';

describe('detectSport', () => {
  it('падел — по категории и по названию', () => {
    expect(detectSport('Падел - Ракетки', 'Ракетка для падела Bullpadel Vertex')).toBe('padel');
    expect(detectSport('Обувь', 'Кроссовки для падела Nox RS1')).toBe('padel');
    expect(detectSport('Мячи для тенниса', 'Мячи для падела Head Padel Pro')).toBe('padel');
  });

  it('теннис — по категории и по названию', () => {
    expect(detectSport('Теннисные струны', 'Струна Head Lynx Touch')).toBe('tennis');
    expect(detectSport('Ракетки для тенниса', 'Ракетка Wilson Pro Staff 97')).toBe('tennis');
    expect(detectSport('Аксессуары', 'Виброгаситель теннисный Tennis Life')).toBe('tennis');
  });

  it('сквош — прочее (не теннис и не падел)', () => {
    expect(detectSport('Теннисные струны', 'Струна для сквоша X-ONE Orange')).toBe('other');
    expect(detectSport('Ракетки для тенниса', 'Ракетка для сквоша Tecnifibre Carboflex')).toBe('other');
  });

  it('одежда и обувь по умолчанию теннисные, сувениры — прочее', () => {
    expect(detectSport('Одежда', 'Футболка мужская Nike Court Advantage Pro')).toBe('tennis');
    expect(detectSport('Обувь', 'Кроссовки мужские Nike Vapor Pro 3 HC')).toBe('tennis');
    expect(detectSport('Аксессуары', 'Аромасаше «Всегда в игре» - Yellow')).toBe('other');
    expect(detectSport('Оборудование', 'Станок для натяжки ракеток')).toBe('other');
  });

  it('ручная правка важнее автоопределения', () => {
    const product = { article: 'X1', link: '', name: 'Футболка Nike', category: 'Одежда' };
    expect(sportOf(product)).toBe('tennis');
    expect(sportOf(product, { x1: 'padel' })).toBe('padel');
  });
});

describe('productSettingsKey', () => {
  it('приоритет: артикул → ссылка → название (регистр и слэши не важны)', () => {
    expect(productSettingsKey({ article: ' TS76-BKWH ', link: 'https://x/y/', name: 'N' })).toBe(
      'ts76-bkwh'
    );
    expect(productSettingsKey({ link: 'https://site.ru/catalog/product/1/', name: 'N' })).toBe(
      'https://site.ru/catalog/product/1'
    );
    expect(productSettingsKey({ name: ' Товар Без Артикула ' })).toBe('товар без артикула');
  });
});
