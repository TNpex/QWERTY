/**
 * Утилиты размеров: нормализация и естественная сортировка.
 */

const LETTER_ORDER = ['xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl', '2xl', 'xxxl', '3xl'];

/**
 * Нормализует значение размера из файла:
 * - «Без размера» / пусто → '—';
 * - «375» → «37,5» — в sizes.csv половинные размеры теряют запятую при экспорте
 *   (трёхзначное число, оканчивающееся на 5, с правдоподобной целой частью 20–49);
 * - прочее — trim.
 */
export function normalizeSize(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text) return '—';
  const lower = text.toLowerCase();
  if (lower === 'без размера' || lower === 'без_размера' || lower === 'no size' || lower === 'one size') {
    return '—';
  }
  const halfSize = text.match(/^([2-4]\d)5$/);
  if (halfSize) {
    return `${halfSize[1]},5`;
  }
  return text;
}

/**
 * Естественная сортировка размеров: сначала числовые (42 < 42,5 < 43, диапазоны —
 * по нижней границе), затем буквенные (XS < S < M < L < XL < XXL), прочие — по алфавиту.
 */
export function compareSizes(a: string, b: string): number {
  const an = parseFloat(a.replace(',', '.'));
  const bn = parseFloat(b.replace(',', '.'));
  const aIsNum = /^[0-9]/.test(a.trim()) && isFinite(an);
  const bIsNum = /^[0-9]/.test(b.trim()) && isFinite(bn);

  if (aIsNum && bIsNum) return an - bn || a.localeCompare(b);
  if (aIsNum !== bIsNum) return aIsNum ? -1 : 1;

  const al = LETTER_ORDER.indexOf(a.trim().toLowerCase());
  const bl = LETTER_ORDER.indexOf(b.trim().toLowerCase());
  if (al !== -1 && bl !== -1) return al - bl;
  if (al !== -1) return -1;
  if (bl !== -1) return 1;

  return a.localeCompare(b, 'ru');
}
