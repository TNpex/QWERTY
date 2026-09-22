/**
 * Естественная сортировка размеров: сначала числовые (42 < 42.5 < 43),
 * затем буквенные (XS < S < M < L < XL < XXL), прочие — по алфавиту.
 */
const LETTER_ORDER = ['xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl', '2xl', 'xxxl', '3xl'];

export function compareSizes(a: string, b: string): number {
  const an = Number(a.replace(',', '.'));
  const bn = Number(b.replace(',', '.'));
  const aIsNum = a.trim() !== '' && isFinite(an);
  const bIsNum = b.trim() !== '' && isFinite(bn);

  if (aIsNum && bIsNum) return an - bn || a.localeCompare(b);
  if (aIsNum !== bIsNum) return aIsNum ? -1 : 1;

  const al = LETTER_ORDER.indexOf(a.trim().toLowerCase());
  const bl = LETTER_ORDER.indexOf(b.trim().toLowerCase());
  if (al !== -1 && bl !== -1) return al - bl;
  if (al !== -1) return -1;
  if (bl !== -1) return 1;

  return a.localeCompare(b, 'ru');
}
