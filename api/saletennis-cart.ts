/**
 * Серверный мост в корзину saletennis.com (Vercel Serverless Function).
 *
 * Зачем: браузер дашборда (*.vercel.app) не может дёрнуть saletennis.com
 * напрямую — CORS блокирует кросс-доменные запросы. Функция добавляет товары
 * в корзину аккаунта пользователя двумя способами:
 *
 *  1. login + password (основной, «одним нажатием»): функция сама входит
 *     на saletennis.com стандартной Symfony-формой (GET /login → CSRF →
 *     POST /login_check), получает сессию аккаунта и добавляет позиции.
 *     Корзина на saletennis.com привязана к аккаунту, поэтому пользователь
 *     видит её наполненной в своём браузере. Учётные данные НЕ сохраняются
 *     и НЕ логируются — используются один раз на время запроса.
 *  2. cookie (PHPSESSID) — резервный режим: сессия из браузера пользователя.
 *
 * При входе по логину функция возвращает sessionToken (свежий PHPSESSID) —
 * фронтенд может дозагрузить следующие пачки позиций без повторного входа.
 *
 * Безопасность: маршрут закрыт общим паролем сайта (middleware.ts, st_auth).
 *
 * Запрос:  POST { login?, password?, cookie?, items: [{itemId,count,size,name?}] }
 * Ответ:   { ok, added, failed, unauthorized?, loginFailed?, sessionToken?, results }
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

const SITE = 'https://saletennis.com';
const LOGIN_URL = `${SITE}/login?backUrl=https%253A%252F%252Fsaletennis.com%252F`;
const CART_ADD_URL = `${SITE}/cabinet/cart/add/`;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const MAX_ITEMS = 200;
const CONCURRENCY = 5;

/** Vercel Hobby позволяет до 60 с — хватит на вход и большую корзину */
export const maxDuration = 60;

type Jar = Record<string, string>;

function mergeSetCookies(jar: Jar, resp: Response): void {
  const cookies =
    typeof resp.headers.getSetCookie === 'function'
      ? resp.headers.getSetCookie()
      : [resp.headers.get('set-cookie') ?? ''];
  for (const raw of cookies) {
    if (!raw) continue;
    const pair = raw.split(';')[0];
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
}

function cookieHeader(jar: Jar): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

const BROWSER_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.5',
};

/** Вход на saletennis.com по логину/паролю. Возвращает jar сессии или null. */
async function loginToSite(login: string, password: string): Promise<Jar | null> {
  const jar: Jar = {};
  // 1) Страница входа: получаем анонимную сессию и CSRF-токен формы
  const page = await fetch(LOGIN_URL, {
    headers: { ...BROWSER_HEADERS, Accept: 'text/html' },
    redirect: 'follow',
  });
  mergeSetCookies(jar, page);
  const html = await page.text();
  const csrf = html.match(/name="_csrf_token"\s+value="([^"]+)"/);
  if (!csrf) return null; // сайт изменил форму логина
  // 2) POST /login_check — как это делает браузер
  const form = new URLSearchParams({
    _csrf_token: csrf[1],
    _remember_me: 'on',
    _target_path: `${SITE}/`,
    _username: login,
    _password: password,
  });
  const resp = await fetch(`${SITE}/login_check`, {
    method: 'POST',
    headers: {
      ...BROWSER_HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: LOGIN_URL,
      Cookie: cookieHeader(jar),
    },
    body: form.toString(),
    redirect: 'manual',
  });
  mergeSetCookies(jar, resp);
  if (!jar['PHPSESSID']) return null;
  // 3) Проверка входа. Корзина saletennis.com доступна и гостям, поэтому
  //    проверяем не доступ, а маркер авторизации: у вошедшего пользователя
  //    в шапке есть ссылка «Выйти» (href="/logout"), у гостя — «Войти».
  const check = await fetch(`${SITE}/cabinet/cart/`, {
    headers: { ...BROWSER_HEADERS, Cookie: cookieHeader(jar), Accept: 'text/html' },
    redirect: 'follow',
  });
  mergeSetCookies(jar, check);
  const cartHtml = await check.text();
  if (!cartHtml.includes('href="/logout"')) return null;
  return jar;
}

/** Сколько позиций сейчас в корзине (подтверждение, что добавление сработало) */
async function countCartLines(jar: Jar): Promise<number | null> {
  try {
    const r = await fetch(`${SITE}/cabinet/cart/get/`, {
      headers: { ...BROWSER_HEADERS, Cookie: cookieHeader(jar), 'X-Requested-With': 'XMLHttpRequest' },
      redirect: 'follow',
    });
    const html = await r.text();
    if (html.toLowerCase().includes('form-login-username')) return null;
    return (html.match(/js-cart-item/g) ?? []).length;
  } catch {
    return null;
  }
}

/** Добавляет позицию в корзину; возвращает текст ошибки или null */
async function addCartItem(
  jar: Jar,
  item: CartItem
): Promise<{ ok: boolean; error?: string; unauthorized?: boolean }> {
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
        ...BROWSER_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        Cookie: cookieHeader(jar),
      },
      body: form.toString(),
    });
    const text = await resp.text();
    try {
      const parsed = JSON.parse(text) as { error?: number; error_text?: string };
      if (!parsed.error) return { ok: true };
      return { ok: false, error: String(parsed.error_text ?? 'сайт отклонил позицию') };
    } catch {
      if (resp.url.toLowerCase().includes('/login') || text.includes('form-login-username')) {
        return { ok: false, error: 'unauthorized', unauthorized: true };
      }
      return { ok: false, error: `неожиданный ответ сайта (HTTP ${resp.status})` };
    }
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'только POST' });
    return;
  }

  const body = (req.body ?? {}) as {
    login?: string;
    password?: string;
    cookie?: string;
    items?: CartItem[];
  };
  const items = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : [];
  if (items.length === 0) {
    res.status(400).json({ ok: false, error: 'пустой список позиций' });
    return;
  }

  // --- Сессия: вход по логину/паролю либо готовая cookie ---
  let jar: Jar = {};
  let sessionToken: string | undefined;
  const login = String(body.login ?? '').trim();
  const password = String(body.password ?? '');
  const cookie = String(body.cookie ?? '').trim();

  if (login && password) {
    const loggedIn = await loginToSite(login, password);
    if (!loggedIn) {
      res.status(200).json({
        ok: false,
        loginFailed: true,
        error: 'Не удалось войти на saletennis.com (проверьте логин/пароль)',
      });
      return;
    }
    jar = loggedIn;
    sessionToken = jar['PHPSESSID'];
  } else if (cookie) {
    jar = { PHPSESSID: cookie };
  } else {
    res.status(400).json({ ok: false, error: 'нужны login+password или cookie' });
    return;
  }

  // --- Добавление позиций (несколько потоков) ---
  let unauthorized = false;
  let added = 0;
  const results: { name: string; ok: boolean; error?: string }[] = [];
  const queue = [...items];

  async function worker(): Promise<void> {
    while (queue.length > 0 && !unauthorized) {
      const item = queue.shift();
      if (!item) break;
      const name = item.name ?? String(item.itemId);
      const r = await addCartItem(jar, item);
      if (r.unauthorized) unauthorized = true;
      if (r.ok) added++;
      results.push({ name, ok: r.ok, ...(r.error ? { error: r.error } : {}) });
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));

  const cartLines = await countCartLines(jar);

  res.status(200).json({
    ok: !unauthorized && added === items.length,
    added,
    failed: items.length - added,
    ...(cartLines !== null ? { cartLines } : {}),
    ...(unauthorized ? { unauthorized: true } : {}),
    ...(sessionToken ? { sessionToken } : {}),
    results,
  });
}
