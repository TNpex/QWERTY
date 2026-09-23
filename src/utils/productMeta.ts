/**
 * Метаданные товара: пол/возраст, подтип одежды и нормативы дозакупки.
 *
 * Пол определяется по названию (у владельца данных нет отдельного поля):
 * «женск…/девоч…» → женский, «мужск…/мальч…» → мужской,
 * «детск…/юниор…» → детский, иначе → унисекс.
 */

export type Gender = 'female' | 'male' | 'kids' | 'unisex';

export const GENDER_LABELS: Record<Gender, string> = {
  female: 'Женская',
  male: 'Мужская',
  kids: 'Детская',
  unisex: 'Унисекс',
};

export function detectGender(name: string, category = ''): Gender {
  const text = `${name} ${category}`.toLowerCase();
  // Дети — приоритетнее («для девочек» ≠ «женская»)
  if (
    text.includes('детск') ||
    text.includes('девоч') ||
    text.includes('мальч') ||
    text.includes('юниор') ||
    /\bkids?\b/.test(text) ||
    /\bjunior/.test(text) ||
    /\bgirls?\b/.test(text) ||
    /\bboys?\b/.test(text)
  ) {
    return 'kids';
  }
  if (
    text.includes('женск') ||
    text.includes('женщин') ||
    /\bwomen\b|\bwoman\b|\bladies\b|\bw's\b/.test(text)
  ) {
    return 'female';
  }
  if (
    text.includes('мужск') ||
    text.includes('мужчин') ||
    /\bmen\b|\bmens\b|\bman\b|\bm's\b/.test(text)
  ) {
    return 'male';
  }
  return 'unisex';
}

/**
 * Подтип одежды для фильтра «носков, футболок, шорт, платьев и других
 * однотипных товаров» на вкладке перемещений.
 */
const SUBTYPE_RULES: { subtype: string; markers: string[] }[] = [
  { subtype: 'Носки', markers: ['носк'] },
  { subtype: 'Футболки и поло', markers: ['футболк', 'поло ', ' поло', 'тенниска', 't-shirt'] },
  { subtype: 'Майки и топы', markers: ['майка', 'маек', ' топ', 'топ ', 'бюст', 'бра '] },
  { subtype: 'Шорты', markers: ['шорт'] },
  { subtype: 'Юбки и платья', markers: ['юбк', 'юбок', 'плать', 'юбка-шорты'] },
  { subtype: 'Брюки, капри, леггинсы', markers: ['брюк', 'капри', 'леггин', 'лосин', 'штаны', 'кюлот'] },
  { subtype: 'Куртки и ветровки', markers: ['куртка', 'ветровк', 'жилет', 'пальто', 'jacket'] },
  { subtype: 'Худи и свитшоты', markers: ['худи', 'свитшот', 'толстовк', 'олимпийка', 'кофта', 'свитер', 'джемпер'] },
  { subtype: 'Рубашки и блузы', markers: ['рубашк', 'блуз'] },
  { subtype: 'Комплекты', markers: ['комплект', 'набор '] },
  { subtype: 'Головные уборы', markers: ['кепк', 'бейсболк', 'шапк', 'повязк', 'бандан', 'козырек', 'козырёк'] },
];

export function detectClothingSubtype(name: string): string {
  const lower = ` ${name.toLowerCase()} `;
  for (const rule of SUBTYPE_RULES) {
    if (rule.markers.some((marker) => lower.includes(marker))) {
      return rule.subtype;
    }
  }
  return 'Прочее';
}

// ============ Нормативы дозакупки (минимум на размер ПО ВСЕЙ СЕТИ) ============

/**
 * Таблицы минимумов владельца сети. Ключ — размер в том же виде,
 * в котором его хранит парсер (половинные размеры обуви — через запятую: «42,5»).
 */
const CLOTHING_FEMALE: Record<string, number> = {
  XXS: 3, XS: 4, S: 11, M: 11, L: 3, XL: 0,
};
const CLOTHING_MALE: Record<string, number> = {
  XS: 1, S: 4, M: 12, L: 13, XL: 8,
};
const CLOTHING_KIDS: Record<string, number> = {
  XS: 4, S: 6, M: 7, L: 6, XL: 4,
};
const SHOES_FEMALE: Record<string, number> = {
  '35': 4, '36': 5, '37': 5, '38': 8, '39': 10, '40': 8,
};
const SHOES_MALE: Record<string, number> = {
  '41': 8, '42': 11, '42,5': 11, '43': 11, '43,5': 11,
  '44': 10, '44,5': 8, '45': 6, '46': 3, '47': 1,
};

/** Минимум для размера, не указанного в таблицах, и для товаров без пола */
export const DEFAULT_MINIMUM = 4;

export const CLOTHING_CATEGORY = 'Одежда';
export const SHOES_CATEGORY = 'Обувь';

function normalizeSizeKey(size: string): string {
  return size.trim().toUpperCase().replace('.', ',');
}

/**
 * Норматив остатка на размер ПО ВСЕЙ СЕТИ для дозакупки.
 * Правила владельца: таблицы по полу для одежды и обуви; если пол не
 * определить или размер уникальный (в т.ч. «сет», «банка», ростовки) — 4.
 */
export function getRestockMinimum(gender: Gender, category: string, size: string): number {
  const key = normalizeSizeKey(size);

  if (category === CLOTHING_CATEGORY) {
    const table =
      gender === 'female' ? CLOTHING_FEMALE : gender === 'male' ? CLOTHING_MALE : gender === 'kids' ? CLOTHING_KIDS : null;
    if (table) {
      const value = table[key] ?? table[key.replace(/^2XL$/, 'XXL')];
      if (value !== undefined) return value;
    }
    return DEFAULT_MINIMUM;
  }

  if (category === SHOES_CATEGORY) {
    const table = gender === 'female' ? SHOES_FEMALE : gender === 'male' ? SHOES_MALE : null;
    if (table) {
      const value = table[key];
      if (value !== undefined) return value;
    }
    return DEFAULT_MINIMUM;
  }

  // Струны, мячи, ракетки, сумки, аксессуары, падел — минимум 4 на позицию
  return DEFAULT_MINIMUM;
}

/** Приоритетные размеры по полу (влияют на приоритет перемещений) */
export const PRIORITY_SIZES_FEMALE = ['S', 'M'];
export const PRIORITY_SIZES_MALE = ['M', 'L'];

export function isPrioritySize(gender: Gender, size: string): boolean {
  const key = normalizeSizeKey(size);
  if (gender === 'female') return PRIORITY_SIZES_FEMALE.includes(key);
  if (gender === 'male') return PRIORITY_SIZES_MALE.includes(key);
  return false;
}

// ============ Метаданные для парсеров ============

const CLOTHING_LIKE_CATEGORIES = ['одежда', 'аксессуары'];

/** Пол и подтип одежды для товара (подтип — только для одежда-подобных категорий) */
export function productMeta(
  name: string,
  category: string
): { gender: Gender; subtype?: string } {
  const gender = detectGender(name, category);
  const isClothingLike = CLOTHING_LIKE_CATEGORIES.some((c) => category.toLowerCase().includes(c));
  return { gender, ...(isClothingLike ? { subtype: detectClothingSubtype(name) } : {}) };
}
