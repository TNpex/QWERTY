import { normalizeLink } from './historyCore';

/**
 * Перенос выбранных позиций в корзину saletennis.com.
 *
 * Данные для добавления берёт парсер (public/data/cart-map.json):
 * itemId товара + карта «текст размера → внутренний ID размера» (API корзины
 * сайта принимает именно ID: «42,5» → 38495; безразмерные товары → size=0).
 * Само добавление выполняет серверная функция /api/saletennis-cart (Vercel):
 * браузер не может дёрнуть saletennis.com напрямую из-за CORS.
 */

export interface CartMapEntry {
  itemId: string;
  article?: string;
  /** «42,5» → «38495» */
  sizes: Record<string, string>;
}

export interface CartMap {
  generatedAt?: string;
  /** Ключ — ссылка товара без хвостового слэша */
  items: Record<string, CartMapEntry>;
}

/** Разбор cart-map.json с отсечением мусора */
export function parseCartMap(json: string): CartMap | null {
  try {
    const raw = JSON.parse(json) as {
      generatedAt?: string;
      items?: Record<string, CartMapEntry>;
    };
    if (!raw || typeof raw !== 'object' || !raw.items || typeof raw.items !== 'object') {
      return null;
    }
    const items: Record<string, CartMapEntry> = {};
    for (const [key, entry] of Object.entries(raw.items)) {
      if (!entry || typeof entry !== 'object' || !entry.itemId) continue;
      const sizes: Record<string, string> = {};
      if (entry.sizes && typeof entry.sizes === 'object') {
        for (const [sizeLabel, sizeId] of Object.entries(entry.sizes)) {
          if (typeof sizeId === 'string' && sizeId.trim() && sizeLabel.trim()) {
            sizes[sizeLabel.trim()] = sizeId.trim();
          }
        }
      }
      items[normalizeLink(key)] = {
        itemId: String(entry.itemId),
        ...(typeof entry.article === 'string' ? { article: entry.article } : {}),
        sizes,
      };
    }
    return { generatedAt: raw.generatedAt, items };
  } catch {
    return null;
  }
}

/** Позиция, выбранная во вкладке «Перемещения» */
export interface CartLine {
  /** Ключ группы вариантов (товар + размер + получатель) */
  key: string;
  name: string;
  link?: string;
  size: string;
  quantity: number;
  toStore: string;
}

/** Готовый элемент для POST /cabinet/cart/add/ */
export interface CartItemPayload {
  itemId: string;
  /** Внутренний ID размера сайта ('0' — безразмерный товар) */
  size: string;
  count: number;
  name: string;
  sizeLabel: string;
  toStore: string;
}

const NOSIZE_VALUES = ['—', '-', 'без размера', 'no size', ''];

function normalizeForMatch(size: string): string {
  return size.trim().toLowerCase().replace(/\./g, ',');
}

/**
 * Размер позиции → внутренний ID размера для корзины сайта.
 * '0' — товар без размера; null — размер не найден в карте (устаревший
 * cart-map или товар без размеров с нестандартной подписью).
 */
export function sizeIdFor(entry: CartMapEntry, size: string): string | null {
  const label = (size ?? '').trim();
  if (NOSIZE_VALUES.includes(label.toLowerCase())) return '0';
  const exact = entry.sizes[label];
  if (exact) return exact;
  const target = normalizeForMatch(label);
  for (const [key, id] of Object.entries(entry.sizes)) {
    if (normalizeForMatch(key) === target) return id;
  }
  return null;
}

export interface ResolvedCart {
  items: CartItemPayload[];
  /** Позиции, которые не удалось превратить в элементы корзины */
  missing: { line: CartLine; reason: string }[];
}

/** Собирает payload корзины из выбранных позиций (одинаковые itemId+size сливаются) */
export function resolveCartItems(cartMap: CartMap | null, lines: CartLine[]): ResolvedCart {
  const missing: { line: CartLine; reason: string }[] = [];
  const merged = new Map<string, CartItemPayload>();

  for (const line of lines) {
    const count = Math.max(1, Math.round(line.quantity) || 1);
    if (!cartMap) {
      missing.push({ line, reason: 'нет данных корзины (cart-map.json ещё не собран парсером)' });
      continue;
    }
    const entry = line.link ? cartMap.items[normalizeLink(line.link)] : undefined;
    if (!entry) {
      missing.push({ line, reason: 'товар не найден в данных корзины' });
      continue;
    }
    const sizeId = sizeIdFor(entry, line.size);
    if (sizeId === null) {
      missing.push({ line, reason: `размер «${line.size}» не найден в данных корзины` });
      continue;
    }
    const mergeKey = `${entry.itemId}|${sizeId}`;
    const prev = merged.get(mergeKey);
    if (prev) {
      prev.count += count;
    } else {
      merged.set(mergeKey, {
        itemId: entry.itemId,
        size: sizeId,
        count,
        name: line.name,
        sizeLabel: line.size,
        toStore: line.toStore,
      });
    }
  }
  return { items: [...merged.values()], missing };
}

/** Текстовый список позиций (копирование в буфер / отправка менеджеру) */
export function cartLinesToText(lines: CartLine[]): string {
  return lines
    .map((l) => `${l.name} | Размер: ${l.size} | Кол-во: ${l.quantity} | Магазин: ${l.toStore}`)
    .join('\n');
}
