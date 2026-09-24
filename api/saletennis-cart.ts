/**
 * Серверный мост в корзину saletennis.com (Vercel Serverless Function).
 *
 * Зачем: браузер дашборда (*.vercel.app) не может дёрнуть saletennis.com
 * напрямую — CORS блокирует кросс-доменные POST. Эта функция принимает
 * позиции и сессионную cookie пользователя (PHPSESSID), добавляет товары
 * в его корзину на saletennis.com и возвращает результат.
 *
 * Безопасность:
 * - маршрут закрыт общим паролем сайта (middleware.ts) — st_auth cookie;
 * - PHPSESSID приходит только из браузера пользователя и хранится только
 *   там (localStorage устройства); функция его НЕ логирует и НЕ сохраняет;
 * - за раз принимается не больше 25 позиций (батчи шлёт фронтенд).
 *
 * Запрос: POST { cookie: string, items: [{ itemId, count, size, name? }] }
 * Ответ:  { unauthorized?: boolean, results: [{ name, ok, error? }] }
 */

interface CartItem {
  itemId: string;
  count: number;
  size: string | number;
  name?: string;
}

interface ApiRequest {
  method?: string;
  body?: unknown;
}

interface ApiResponse {
  status(code: number): ApiResponse;
  json(data: unknown): void;
}

const CART_ADD_URL = 'https://www.saletennis.com/cabinet/cart/add/';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const MAX_ITEMS = 25;
const CONCURRENCY = 3;

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'только POST' });
    return;
  }

  const body = (req.body ?? {}) as { cookie?: string; items?: CartItem[] };
  const cookie = String(body.cookie ?? '').trim();
  const items = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : [];

  if (!cookie) {
    res.status(400).json({ error: 'не передана сессия (PHPSESSID)' });
    return;
  }
  if (items.length === 0) {
    res.status(400).json({ error: 'пустой список позиций' });
    return;
  }

  let unauthorized = false;
  const results: { name: string; ok: boolean; error?: string }[] = [];
  const queue = [...items];

  async function worker(): Promise<void> {
    while (queue.length > 0 && !unauthorized) {
      const item = queue.shift();
      if (!item) break;
      const name = item.name ?? String(item.itemId);
      try {
        const form = new URLSearchParams({
          item: String(item.itemId),
          count: String(Math.max(1, Math.round(Number(item.count) || 1))),
          size: String(item.size ?? '0'),
        });
        const resp = await fetch(CART_ADD_URL, {
          method: 'POST',
          redirect: 'follow',
          headers: {
            'User-Agent': USER_AGENT,
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
            Cookie: `PHPSESSID=${cookie}`,
          },
          body: form.toString(),
        });
        const text = await resp.text();
        let ok = false;
        let error: string | undefined;
        try {
          const parsed = JSON.parse(text) as { error?: number; error_text?: string };
          ok = !parsed.error;
          if (!ok) error = String(parsed.error_text ?? 'сайт отклонил позицию');
        } catch {
          // Не JSON — скорее всего редирект на страницу логина (сессия истекла)
          if (resp.url.toLowerCase().includes('/login') || text.includes('form-login-username')) {
            error = 'unauthorized';
          } else {
            error = `неожиданный ответ сайта (HTTP ${resp.status})`;
          }
        }
        if (error === 'unauthorized') unauthorized = true;
        results.push({ name, ok, ...(error ? { error } : {}) });
      } catch (e) {
        results.push({ name, ok: false, error: String(e) });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  res.status(200).json({ unauthorized, results });
}
