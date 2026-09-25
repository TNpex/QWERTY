import { describe, it, expect } from 'vitest';
import {
  detectGender,
  detectClothingSubtype,
  getRestockMinimum,
  isPrioritySize,
  productMeta,
  cleanBrand,
  remapBrand,
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
    expect(detectClothingSubtype('Куртка мужская Nike')).toBe('Верхняя одежда');
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

describe('detectClothingSubtype: разбор «Прочее» по смыслу', () => {
  it('аксессуары для ракеток: grips, виброгасители, утяжелители, защита', () => {
    expect(detectClothingSubtype('Овергрип Head Sonic Pro')).toBe('Грипы и овергрипы');
    expect(detectClothingSubtype('Грип Wilson Leather')).toBe('Грипы и овергрипы');
    expect(detectClothingSubtype('Виброгаситель Head Djokovic')).toBe('Виброгасители');
    expect(detectClothingSubtype('Заглушка ручки ракетки 7/6')).toBe('Аксессуары для ракеток');
    expect(detectClothingSubtype('Лента утяжелитель 7/6')).toBe('Аксессуары для ракеток');
    expect(detectClothingSubtype('Трафарет Logo W Stencil для тенниса')).toBe('Аксессуары для ракеток');
    expect(detectClothingSubtype('Протектор Wilson на ракетку')).toBe('Защитные ленты и протекторы');
    expect(detectClothingSubtype('Защитная лента Babolat')).toBe('Защитные ленты и протекторы');
  });

  it('одежда: лонгслив — верхняя одежда, костюм — комплект', () => {
    expect(detectClothingSubtype('Лонгслив женский Nike')).toBe('Верхняя одежда');
    expect(detectClothingSubtype('Куртка мужская Wilson')).toBe('Верхняя одежда');
    expect(detectClothingSubtype('Ветровка женская 7/6')).toBe('Верхняя одежда');
    expect(detectClothingSubtype('Спортивный костюм Diadora - Black')).toBe('Комплекты');
  });

  it('аксессуары: напульсники, суппорты, бутылки, сувениры, книги', () => {
    expect(detectClothingSubtype('Пара напульсников Nike')).toBe('Напульсники');
    expect(detectClothingSubtype('Напульсник 7/6')).toBe('Напульсники');
    expect(detectClothingSubtype('Суппорт бедра TORRES Grey (нейлон)')).toBe('Суппорты и бандажи');
    expect(detectClothingSubtype('Бутылка для воды 7/6 UV Water Bottle - Black')).toBe('Бутылки для воды');
    expect(detectClothingSubtype('Магнит Milo')).toBe('Сувениры и подарки');
    expect(detectClothingSubtype('Брелок мячик')).toBe('Сувениры и подарки');
    expect(detectClothingSubtype('Подарочная коробка для падел ракетки')).toBe('Сувениры и подарки');
    expect(detectClothingSubtype('Сувенирная ракетка Wilson Ultra Roland Garros')).toBe('Сувениры и подарки');
    expect(detectClothingSubtype('Теннис. Иллюстрированная библия великой игры')).toBe('Книги');
    expect(detectClothingSubtype('Блистательная Серена. Джеральд Марзорати')).toBe('Книги');
    expect(detectClothingSubtype('Точка опоры - Честная книга о теннисе как игре и профессии')).toBe('Книги');
  });

  it('порядок правил: «лента с утяжелением» — утяжелитель, а не защитная лента', () => {
    expect(detectClothingSubtype('Лента с утяжелением Bullpadel для падел-ракетки 3pk')).toBe(
      'Аксессуары для ракеток'
    );
    expect(detectClothingSubtype('Утяжелитель Bullpadel в ручку для падел-ракетки')).toBe(
      'Аксессуары для ракеток'
    );
  });

  it('старые группы не сломались', () => {
    expect(detectClothingSubtype('Носки 7/6 Socks Pro')).toBe('Носки');
    expect(detectClothingSubtype('Юбка женская 7/6 Kris Skirt')).toBe('Юбки и платья');
    expect(detectClothingSubtype('Кепка Nike Heritage')).toBe('Головные уборы');
    expect(detectClothingSubtype('Худи мужское Wilson')).toBe('Худи и свитшоты');
    expect(detectClothingSubtype('Что-то совсем непонятное')).toBe('Прочее');
  });
});

describe('cleanBrand', () => {
  it('код поставщика заменяется брендом из названия', () => {
    expect(cleanBrand('Сумка 7/6 Tournament Bag - Red', 'TS1', '37078')).toBe('7/6');
    expect(cleanBrand('Кроссовки мужские 7/6 Marble 2.0', 'TS76-BKWH', '37078')).toBe('7/6');
    expect(cleanBrand('Овергрип Solinco Wonder', 'SL1', '12345')).toBe('Solinco');
  });

  it('«Не определен» → бренд из названия или по артикулу Nike', () => {
    expect(cleanBrand('Толстовка мужская Diadora Hoodie Core', 'D1', 'Не определен')).toBe('Diadora');
    // «Nata» — линейка одежды 7/6 (артикулы NT76-*), отдельного бренда в сети нет
    expect(cleanBrand('Майка женская Nata Sleeveless', 'N1', 'Не определен')).toBe('7/6');
    expect(cleanBrand('Шорты мужские Court Heritage 6in Shorts', 'FZ6951-110', 'Не определен')).toBe('Nike');
    expect(cleanBrand('Футболка унисекс LOVE', 'X1', 'Не определен')).toBe('Не определен');
  });

  it('бренд-линейка «Nata» приводится к 7/6 (артикулы NT76-*)', () => {
    // сайт отдаёт «Nata» как отдельный бренд, но это линейка одежды 7/6
    expect(cleanBrand('Майка женская Nata Sleeveless T-shirt - Antarctica', 'NT76-4104', 'Nata')).toBe('7/6');
    expect(cleanBrand('Майка женская Nata Sleeveless', 'NT76-1265', ' nata ')).toBe('7/6');
    expect(remapBrand('Nata')).toBe('7/6');
    expect(remapBrand('Head')).toBe('Head');
    // остальные бренды правило не задевает
    expect(cleanBrand('Ракетка Babolat Pure Aero', 'B1', 'Babolat')).toBe('Babolat');
    expect(cleanBrand('Овергрип Solinco Wonder', 'SL1', 'Solinco')).toBe('Solinco');
  });

  it('опечатки Tecnifibre в названиях сайта нормализуются', () => {
    expect(cleanBrand('Теннисная ракетка Tecnifbre Fire 285 2026', '14FIR2856', 'Не определен')).toBe('Tecnifibre');
    expect(cleanBrand('Ракетка для сквоша Tecnifiber Corbonflex X-TOP 135', '12CAR135XT', 'Не определен')).toBe('Tecnifibre');
    expect(cleanBrand('Струна Tecnifibre Black Code', 'TB1', 'Не определен')).toBe('Tecnifibre');
  });

  it('струны для сквоша X-ONE и 305 SQUASH — Tecnifibre', () => {
    expect(cleanBrand('Струна для сквоша X-ONE Orange 1,24 12 метров', '06GXON124O', 'Не определен')).toBe('Tecnifibre');
    expect(cleanBrand('Струна для сквоша 305 SQUASH 1,20 9 метров', '06G305120G', 'Не определен')).toBe('Tecnifibre');
  });

  it('бренды аксессуаров, сквоша и падела определяются из названия', () => {
    expect(cleanBrand('Теннисная ракетка Diadem Nova FS 100', 'RK-FS-NVA', 'Не определен')).toBe('Diadem');
    expect(cleanBrand('Ракетка для падела Oxdog Ultimate Pro', '8261511', 'Не определен')).toBe('Oxdog');
    expect(cleanBrand('Теннисные мячи Slazenger Wimbledon 2026 4B', '340982', 'Не определен')).toBe('Slazenger');
    expect(cleanBrand('Виброгаситель Tennis Life - Cake', 'TL-Donut', 'Не определен')).toBe('Tennis Life');
    expect(cleanBrand('Суппорт голеностопа TORRES Nylon - Grey', 'PRL11014XL', 'Не определен')).toBe('Torres');
    expect(cleanBrand('Магнит Milo "NICE SHOT"', '101-002', 'Не определен')).toBe('Milo');
    expect(cleanBrand('Теннисная ракетка Prince x Hydrogen Skulls 290', '7T58G095', 'Не определен')).toBe('Prince');
  });

  it('валидный бренд не трогает', () => {
    expect(cleanBrand('Ракетка Head Speed', 'H1', 'Head')).toBe('Head');
    expect(cleanBrand('Что угодно', 'B1', 'Babolat')).toBe('Babolat');
  });
});
