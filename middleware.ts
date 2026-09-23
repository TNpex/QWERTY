/**
 * Защита сайта паролем (Vercel Routing Middleware).
 *
 * Работает на бесплатном тарифе Vercel (Hobby) и закрывает ВСЕ пути сайта,
 * включая страницы, CSV-данные (/data/*), фото и JSON — до ввода пароля
 * посетитель не получит ничего, кроме страницы входа.
 *
 * Как это работает:
 *  1. Пароль задаётся переменной окружения SITE_PASSWORD
 *     (Settings → Environment Variables в проекте Vercel). В коде и в git
 *     пароль НЕ хранится.
 *  2. Неавторизованный посетитель попадает на страницу входа (/login).
 *  3. После ввода верного пароля браузер получает httpOnly-cookie на 30 дней —
 *     пароль спрашивается один раз в месяц на каждом устройстве.
 *  4. Выход — адрес /logout (сбрасывает cookie).
 *
 * Если SITE_PASSWORD не задана — сайт закрыт и показывается подсказка
 * для администратора (fail-closed: данные не утекут из-за забытой настройки).
 */
import { next } from '@vercel/functions';

/** Имя авторизационной cookie */
const COOKIE_NAME = 'st_auth';
/** Срок жизни cookie: 30 дней */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
const LOGIN_PATH = '/login';
const LOGOUT_PATH = '/logout';

export const config = {
  // Middleware запускается на всех путях, кроме служебных путей самого Vercel
  matcher: ['/((?!_vercel).*)'],
};

/** SHA-256 (hex) — доступен и в Edge Runtime, и в Node.js 20+ */
async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function parseCookies(header: string | null): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/** Самодостаточная страница входа (без внешних ресурсов — всё инлайн) */
function loginPage(error?: string): Response {
  const errorHtml = error
    ? `<p style="color:#dc2626;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:10px 12px;margin:0 0 16px;font-size:14px;">${error}</p>`
    : '';
  return htmlResponse(
    `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>SaleTennis Analytics — вход</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 55%, #14532d 100%);
    padding: 16px;
  }
  .card {
    width: 100%; max-width: 380px; background: #ffffff; border-radius: 18px;
    padding: 36px 32px; box-shadow: 0 25px 60px rgba(0,0,0,.45); text-align: center;
  }
  .logo { font-size: 44px; line-height: 1; margin-bottom: 14px; }
  h1 { font-size: 21px; color: #0f172a; margin-bottom: 6px; }
  .sub { font-size: 14px; color: #64748b; margin-bottom: 24px; }
  input[type="password"] {
    width: 100%; padding: 13px 14px; font-size: 16px; border: 2px solid #e2e8f0;
    border-radius: 10px; outline: none; margin-bottom: 14px; transition: border-color .15s;
  }
  input[type="password"]:focus { border-color: #16a34a; }
  button {
    width: 100%; padding: 13px; font-size: 16px; font-weight: 600; color: #fff;
    background: #16a34a; border: none; border-radius: 10px; cursor: pointer;
    transition: background .15s;
  }
  button:hover { background: #15803d; }
  .foot { margin-top: 22px; font-size: 12px; color: #94a3b8; }
</style>
</head>
<body>
  <form class="card" method="post" action="${LOGIN_PATH}">
    <div class="logo">🎾</div>
    <h1>SaleTennis Analytics</h1>
    <p class="sub">Введите пароль для доступа к сайту</p>
    ${errorHtml}
    <input type="password" name="password" placeholder="Пароль" autofocus required />
    <button type="submit">Войти</button>
    <p class="foot">Доступ только для сотрудников сети</p>
  </form>
</body>
</html>`,
    error ? 401 : 200,
  );
}

/** Подсказка администратору, если SITE_PASSWORD не настроена */
function setupPage(): Response {
  return htmlResponse(
    `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" /><title>Требуется настройка</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:16px;">
<div style="max-width:520px;background:#1e293b;border:1px solid #334155;border-radius:14px;padding:28px;">
<h1 style="font-size:20px;margin:0 0 12px;">🔧 Сайт ещё не настроен</h1>
<p style="font-size:14px;line-height:1.6;margin:0 0 10px;">
Переменная окружения <b>SITE_PASSWORD</b> не задана — в целях безопасности сайт закрыт.
</p>
<p style="font-size:14px;line-height:1.6;margin:0;">
Добавьте её в Vercel: <b>Project → Settings → Environment Variables</b>,
ключ <b>SITE_PASSWORD</b>, значение — придуманный пароль, затем сделайте
<b>Redeploy</b> (Deployments → последний деплой → ⋯ → Redeploy).
</p>
</div>
</body>
</html>`,
    500,
  );
}

export default async function middleware(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const sitePassword = process.env.SITE_PASSWORD ?? '';

  // Fail-closed: пароль не настроен — не пускаем никого, показываем инструкцию
  if (!sitePassword) {
    return setupPage();
  }

  const expectedToken = await sha256Hex(sitePassword);
  const cookies = parseCookies(request.headers.get('cookie'));
  const isAuthenticated = cookies[COOKIE_NAME] === expectedToken;

  // Выход: сбрасываем cookie и возвращаем на страницу входа
  if (url.pathname === LOGOUT_PATH) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: LOGIN_PATH,
        'Set-Cookie': `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
      },
    });
  }

  // Страница входа и проверка пароля
  if (url.pathname === LOGIN_PATH) {
    if (request.method === 'POST') {
      let password = '';
      try {
        const form = await request.formData();
        password = String(form.get('password') ?? '');
      } catch {
        password = '';
      }
      if (password && (await sha256Hex(password)) === expectedToken) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: '/',
            'Set-Cookie': `${COOKIE_NAME}=${expectedToken}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
          },
        });
      }
      return loginPage('Неверный пароль. Попробуйте ещё раз.');
    }
    // Уже авторизован — незачем показывать форму снова
    if (isAuthenticated) {
      return new Response(null, { status: 302, headers: { Location: '/' } });
    }
    return loginPage();
  }

  // Авторизован — пропускаем запрос дальше к сайту
  if (isAuthenticated) {
    return next();
  }

  // Не авторизован: обычный переход по странице — на /login,
  // запросы данных/картинок/API — жёсткий 401
  const accept = request.headers.get('accept') ?? '';
  const isNavigation =
    request.headers.get('sec-fetch-mode') === 'navigate' || accept.includes('text/html');
  if (isNavigation) {
    return new Response(null, { status: 302, headers: { Location: LOGIN_PATH } });
  }
  return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
