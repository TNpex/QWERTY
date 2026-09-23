import { describe, it, expect } from 'vitest';
import {
  detectGender,
  detectClothingSubtype,
  getRestockMinimum,
  isPrioritySize,
  productMeta,
} from './productMeta';

describe('detectGender', () => {
  it('женские товары', () => {
    expect(detectGender('Юбка женская 7/6 Kris Skirt', 'Одежда')).toBe('female');
    expect(detectGender('Кроссовки женские Nike Vapor', 'Обувь')).toBe('female');
    expect(detectGender('Футболка Women Tennis', 'Одежда')).toBe('female');
  });

  it('мужские товары', () => {
    expect(detectGender('Футболка мужская Mizuno Frontier', 'Одежда')).toBe('male');
    expect(detectGender('Кроссовки мужские Asics', 'Обувь')).toBe('male');
  });

  it('детские — приоритетнее женских слов', () => {
    expect(detectGender('Капри для девочек Bidi Badu', 'Одежда')).toBe('kids');
    expect(detectGender('Футболка для мальчиков Nike', 'Одежда')).toBe('kids');
    expect(detectGender('Кроссовки детские Asics', 'Обувь')).toBe('kids');
    expect(detectGender('Ракетка Babolat Junior', 'Ракетки для тенниса')).toBe('kids');
  });

  it('унисекс и защита от ложных срабатываний', () => {
    expect(detectGender('Теннисная струна Solinco Hyper-G', 'Теннисные струны')).toBe('unisex');
    expect(detectGender('Мячи Wilson Championship', 'Мячи для тенниса')).toBe('unisex');
    // «Tournament» содержит "men" — но это НЕ мужской товар (границы слов)
    expect(detectGender('Сумка 7/6 Tournament Bag', 'Сумки и чехлы')).toBe('unisex');
  });
});

describe('detectClothingSubtype', () => {
  it('объединяет однотипные товары', () => {
    expect(detectClothingSubtype('Носки Nike Everyday')).toBe('Носки');
    expect(detectClothingSubtype('Футболка мужская Mizuno')).toBe('Футболки и поло');
    expect(detectClothingSubtype('Поло женское Lacoste')).toBe('Футболки и поло');
    expect(detectClothingSubtype('Шорты мужские 7/6')).toBe('Шорты');
    expect(detectClothingSubtype('Платье женское Bidi Badu')).toBe('Юбки и платья');
    expect(detectClothingSubtype('Юбка женская Nike')).toBe('Юбки и платья');
    expect(detectClothingSubtype('Капри для девочек Bidi Badu')).toBe('Брюки, капри, леггинсы');
    expect(detectClothingSubtype('Худи женское Asics')).toBe('Худи и свитшоты');
    expect(detectClothingSubtype('Куртка мужская Nike')).toBe('Куртки и ветровки');
    expect(detectClothingSubtype('Кепка Wilson')).toBe('Головные уборы');
    expect(detectClothingSubtype('Повязка на голову Nike')).toBe('Головные уборы');
    expect(detectClothingSubtype('Чехол для ракетки')).toBe('Прочее');
  });
});

describe('getRestockMinimum', () => {
  it('женская одежда', () => {
    expect(getRestockMinimum('female', 'Одежда', 'XXS')).toBe(3);
    expect(getRestockMinimum('female', 'Одежда', 'XS')).toBe(4);
    expect(getRestockMinimum('female', 'Одежда', 'S')).toBe(11);
    expect(getRestockMinimum('female', 'Одежда', 'M')).toBe(11);
    expect(getRestockMinimum('female', 'Одежда', 'L')).toBe(3);
    expect(getRestockMinimum('female', 'Одежда', 'XL')).toBe(0);
  });

  it('мужская одежда', () => {
    expect(getRestockMinimum('male', 'Одежда', 'XS')).toBe(1);
    expect(getRestockMinimum('male', 'Одежда', 'S')).toBe(4);
    expect(getRestockMinimum('male', 'Одежда', 'M')).toBe(12);
    expect(getRestockMinimum('male', 'Одежда', 'L')).toBe(13);
    expect(getRestockMinimum('male', 'Одежда', 'XL')).toBe(8);
  });

  it('детская одежда', () => {
    expect(getRestockMinimum('kids', 'Одежда', 'XS')).toBe(4);
    expect(getRestockMinimum('kids', 'Одежда', 'S')).toBe(6);
    expect(getRestockMinimum('kids', 'Одежда', 'M')).toBe(7);
    expect(getRestockMinimum('kids', 'Одежда', 'L')).toBe(6);
    expect(getRestockMinimum('kids', 'Одежда', 'XL')).toBe(4);
  });

  it('женская и мужская обувь, половинные размеры', () => {
    expect(getRestockMinimum('female', 'Обувь', '35')).toBe(4);
    expect(getRestockMinimum('female', 'Обувь', '38')).toBe(8);
    expect(getRestockMinimum('female', 'Обувь', '39')).toBe(10);
    expect(getRestockMinimum('female', 'Обувь', '40')).toBe(8);
    expect(getRestockMinimum('male', 'Обувь', '41')).toBe(8);
    expect(getRestockMinimum('male', 'Обувь', '42')).toBe(11);
    expect(getRestockMinimum('male', 'Обувь', '42,5')).toBe(11);
    expect(getRestockMinimum('male', 'Обувь', '42.5')).toBe(11); // точка → запятая
    expect(getRestockMinimum('male', 'Обувь', '47')).toBe(1);
  });

  it('неизвестный пол или уникальный размер — минимум 4', () => {
    expect(getRestockMinimum('unisex', 'Одежда', 'S')).toBe(4);
    expect(getRestockMinimum('female', 'Одежда', '164')).toBe(4); // ростовка
    expect(getRestockMinimum('unisex', 'Теннисные струны', 'сет')).toBe(4);
    expect(getRestockMinimum('unisex', 'Мячи для тенниса', 'банка')).toBe(4);
    expect(getRestockMinimum('unisex', 'Ракетки для тенниса', '3')).toBe(4);
    expect(getRestockMinimum('unisex', 'Падел - Ракетки', '—')).toBe(4);
  });
});

describe('isPrioritySize', () => {
  it('приоритетные размеры по полу', () => {
    expect(isPrioritySize('female', 'S')).toBe(true);
    expect(isPrioritySize('female', 'M')).toBe(true);
    expect(isPrioritySize('female', 'L')).toBe(false);
    expect(isPrioritySize('male', 'M')).toBe(true);
    expect(isPrioritySize('male', 'L')).toBe(true);
    expect(isPrioritySize('male', 'S')).toBe(false);
    expect(isPrioritySize('unisex', 'M')).toBe(false);
    expect(isPrioritySize('kids', 'S')).toBe(false);
  });
});

describe('productMeta', () => {
  it('подтип назначается только одежда-подобным категориям', () => {
    expect(productMeta('Футболка мужская Nike', 'Одежда')).toEqual({
      gender: 'male',
      subtype: 'Футболки и поло',
    });
    expect(productMeta('Носки Wilson', 'Аксессуары')).toEqual({
      gender: 'unisex',
      subtype: 'Носки',
    });
    expect(productMeta('Струна Solinco', 'Теннисные струны')).toEqual({
      gender: 'unisex',
    });
  });
});
