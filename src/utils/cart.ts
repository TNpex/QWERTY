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

/** Адрес корзины saletennis.com (на него открываем вкладку со списком в hash) */
export const SALETENNIS_CART_URL = 'https://www.saletennis.com/cabinet/cart/';

/**
 * Компактный payload заказа для передачи через URL-hash (#stcart=...).
 * Читают его только страницы saletennis.com (букмарклет): [{itemId, size, count}]
 * → base64. В hash не попадает ничего чувствительного — только IDs товаров.
 */
export function buildOrderHash(items: CartItemPayload[]): string {
  const compact = { v: 1, items: items.map((i) => [i.itemId, i.size, i.count]) };
  return btoa(JSON.stringify(compact));
}

/** Ссылка на корзину saletennis.com со списком товаров в hash */
export function orderUrl(items: CartItemPayload[]): string {
  return `${SALETENNIS_CART_URL}#stcart=${buildOrderHash(items)}`;
}

/**
 * Код букмарклета (кнопки на панели закладок). Работает ПОД логином самого
 * пользователя на saletennis.com: читает список из #stcart (или из
 * localStorage, если hash потерялся при редиректе через страницу входа),
 * последовательно добавляет позиции в корзину и обновляет страницу.
 * Никаких cookie дашборду не передаётся.
 */
export const ORDER_BOOKMARKLET =
  "javascript:(function(){var h=location.hash.match(/stcart=([A-Za-z0-9+/=]+)/);var raw=null;" +
  "if(h){try{raw=JSON.parse(atob(h[1]));}catch(e){}}" +
  "if(!raw){try{raw=JSON.parse(localStorage.getItem('stcart')||'null');}catch(e){}}" +
  "if(!raw||!raw.items||!raw.items.length){alert('Список товаров не найден на этой странице.\\n\\nВернитесь в дашборд SaleTennis Analytics → «Перемещения» → «Перейти к заказу» → «Открыть корзину», и нажмите эту закладку на ОТКРЫВШЕЙСЯ странице.');return;}" +
  "try{localStorage.setItem('stcart',JSON.stringify(raw));}catch(e){}" +
  "if(!document.querySelector('a[href*=\"logout\"]')){alert('Вы не вошли на saletennis.com.\\nСписок товаров сохранён: войдите в аккаунт (кнопка «Войти» в шапке) и нажмите эту закладку ещё раз.');return;}" +
  "var items=raw.items,i=0,ok=0,fail=0;var box=document.createElement('div');" +
  "box.style.cssText='position:fixed;top:16px;right:16px;z-index:2147483647;background:#111827;color:#fff;padding:14px 18px;border-radius:12px;font:14px sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.4);max-width:320px';" +
  "document.body.appendChild(box);" +
  "function step(){if(i>=items.length){box.textContent='Готово: добавлено '+ok+' из '+items.length+(fail?' (ошибок: '+fail+')':'')+'. Обновляю корзину...';setTimeout(function(){location.reload();},1500);return;}" +
  "var it=items[i];box.textContent='Добавляю в корзину '+(i+1)+' из '+items.length+'...';" +
  "fetch('/cabinet/cart/add/',{method:'POST',credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Requested-With':'XMLHttpRequest'},body:'item='+encodeURIComponent(it[0])+'&count='+encodeURIComponent(it[2])+'&size='+encodeURIComponent(it[1])})" +
  ".then(function(r){return r.json();}).then(function(j){if(j&&!j.error){ok++;}else{fail++;}})" +
  ".catch(function(){fail++;}).then(function(){i++;setTimeout(step,150);});}step();})();";

/** Текстовый список позиций (копирование в буфер / отправка менеджеру) */
export function cartLinesToText(lines: CartLine[]): string {
  return lines
    .map((l) => `${l.name} | Размер: ${l.size} | Кол-во: ${l.quantity} | Магазин: ${l.toStore}`)
    .join('\n');
}
