# -*- coding: utf-8 -*-
"""
HTTP-парсер SaleTennis — БЕЗ браузера (requests + BeautifulSoup).

Зачем: сайт отдаёт все нужные данные (каталог, таблицу наличия table.admin-sizes,
артикул, цену, фото, ID корзины) в серверном HTML — headless-браузер не нужен.
В GitHub Actions браузерный парсер начал упираться в таймауты рендерера
(сайт/хостинг душит облачные IP), а обычные HTTP-запросы работают быстро
и стабильно. Бонус: полный прогон занимает ~30-40 минут вместо 2-3 часов.

Форматы выхода ПОЛНОСТЬЮ совпадают с saletennis_parser.py (products.csv,
sizes.csv, changes.csv, history/, cart-map.json) — сайт разницы не заметит.

Запуск:
    python parser/http_parser.py --out public/data
    python parser/http_parser.py --out public/data --categories "Мячи для тенниса"
    python parser/http_parser.py --out data --limit 5        # быстрая проверка

Авторизация (по приоритету):
    1. Готовая сессия: --cookie <PHPSESSID> / --cookie-file <путь> /
       переменная окружения SALETENNIS_COOKIE  (cookie можно экспортировать
       из браузера расширением Cookie-Editor; удобна для отладки).
    2. Логин/пароль: SALETENNIS_EMAIL + SALETENNIS_PASSWORD (окружение или
       parser/.env) — стандартная Symfony-форма POST /login_check с CSRF.

Если HTTP-парсер когда-нибудь перестанет работать (сайт добавит JS-защиту) —
браузерная версия остаётся запасным вариантом: saletennis_parser.py.
"""

import argparse
import json
import os
import random
import re
import shutil
import sys
import time
from urllib.parse import urljoin, urlparse, parse_qs

import pandas as pd
import requests
from bs4 import BeautifulSoup

# Общая логика с браузерным парсером: пути, лог, хранилища, бренды, журналы
import saletennis_parser as sp

BASE_URL = "https://saletennis.com"
USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
PAGE_TIMEOUT = 30          # таймаут одного HTTP-запроса
FETCH_RETRIES = 3          # повторы запроса при сетевых сбоях
LOGIN_RETRIES = 3          # попытки авторизации
MAX_CONSECUTIVE_FAILURES = 15   # подряд неудач → пересоздать сессию
PAGE_DELAY = 0.4           # вежливая пауза между страницами
PAGE_DELAY_JITTER = (0.9, 1.8)  # множитель джиттера паузы (менее «роботизированный» ритм)
CATEGORY_PAUSE = (3.0, 7.0)     # пауза между категориями (мин, макс), сек

# Защита от «пустых заглушек»: сайт может отдать HTTP 200 без товаров
# (антибот после ~35 мин интенсивного парсинга, сбой кэша, редирект на заглушку).
# Раньше такая страница считалась «пустой категорией» и весь прогон падал.
# Теперь: несколько попыток с охлаждением и перелогином, затем «финальный заход».
CATEGORY_ATTEMPTS = 3               # попыток собрать ссылки категории
CATEGORY_COOLDOWNS = (60, 240)      # паузы между попытками, сек
FINAL_PASS_COOLDOWN = 300           # пауза перед финальным заходом, сек
CATALOG_PAGE_MIN_BYTES = 40_000     # реальная категория (меню+фильтры) ≈ 100-250 КБ

# Таблица наличия table.admin-sizes отдаётся ТОЛЬКО авторизованной сессии.
# Когда PHPSESSID «протухает» посреди долгого прогона (или сайт включает
# мягкий антибот), карточка товара приходит в публичном виде: размеры и цена
# на месте, а таблицы остатков по магазинам нет. Раньше такой товар молча
# получал «Нет информации о наличии» и нули, а сессия НЕ пересоздавалась —
# ведь товар «распарсился» (h1/артикул/цена есть), счётчик сбоев не рос.
# Так 2026-09-25 вечером 22 товара (в т.ч. WR212810) ложно стали распроданными,
# хотя на сайте они в наличии. Лечение: при стойком отсутствии таблицы
# перелогиниваемся и перечитываем товар, а в конце прогона делаем «финальный
# заход» по всем отставшим товарам свежей сессией.
MAX_STOCK_RELOGINS = 6              # перелогинов из-за пропавшей таблицы наличия за прогон
STOCK_FINAL_COOLDOWN = 180          # пауза перед финальным заходом по товарам, сек
STOCK_ANOMALY_FATAL = 15            # столько товаров без таблицы после всех повторов → прогон неполный


# ================= СЕССИЯ И ЗАПРОСЫ =================

def build_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.5",
    })
    return s


def fetch(session, url, retries=FETCH_RETRIES, timeout=PAGE_TIMEOUT, headers=None):
    """GET с повторами и «вежливым» откатом при 429/503. None — если не вышло."""
    last_error = None
    for attempt in range(retries):
        try:
            r = session.get(url, timeout=timeout, allow_redirects=True, headers=headers)
            if r.status_code == 200:
                return r
            last_error = f"HTTP {r.status_code}"
            if r.status_code in (403, 429, 503):
                # антибот/рейт-лимит — охлаждаемся дольше
                wait = 20 * (attempt + 1)
                sp.log(f"      [WARN] {last_error} на {url} — пауза {wait} с")
                time.sleep(wait)
                continue
        except requests.RequestException as e:
            last_error = e.__class__.__name__
        time.sleep(3 * (attempt + 1))
    sp.log(f"      [ERROR] Не удалось загрузить {url}: {last_error}")
    return None


def is_logged_in(session) -> bool:
    """Проверка авторизации: /cabinet/ не должен редиректить на /login."""
    try:
        r = session.get(f"{BASE_URL}/cabinet/", timeout=PAGE_TIMEOUT, allow_redirects=True)
        return r.status_code == 200 and "/login" not in r.url.lower()
    except requests.RequestException:
        return False


def login_with_cookie(session, cookie_value: str) -> bool:
    session.cookies.set("PHPSESSID", cookie_value.strip(), domain=".saletennis.com")
    if is_logged_in(session):
        sp.log("[OK] Авторизация по cookie успешна")
        return True
    sp.log("[WARN] Cookie недействительна (сессия истекла?)")
    return False


def login_with_credentials(session, email: str, password: str) -> bool:
    """Стандартный Symfony-логин: GET формы → CSRF → POST /login_check."""
    for attempt in range(1, LOGIN_RETRIES + 1):
        try:
            r = fetch(session, sp.LOGIN_URL)
            if r is None:
                raise RuntimeError("страница логина не загрузилась")
            soup = BeautifulSoup(r.text, "lxml")
            form = soup.find("form", action=re.compile(r"login_check"))
            if form is None:
                # уже залогинены?
                if is_logged_in(session):
                    sp.log("[OK] Сессия уже авторизована")
                    return True
                raise RuntimeError("форма логина не найдена")

            payload = {}
            for hidden in form.find_all("input", {"type": "hidden"}):
                name = hidden.get("name")
                if name:
                    payload[name] = hidden.get("value", "")
            payload["_username"] = email
            payload["_password"] = password

            action = urljoin(BASE_URL, form.get("action") or "/login_check")
            resp = session.post(action, data=payload,
                                headers={"Referer": sp.LOGIN_URL},
                                timeout=PAGE_TIMEOUT, allow_redirects=True)
            if resp.status_code == 200 and is_logged_in(session):
                sp.log("[OK] Авторизация успешна")
                return True
            sp.log(f"[WARN] Попытка {attempt}/{LOGIN_RETRIES}: сайт не принял логин "
                   f"(HTTP {resp.status_code}, url={resp.url})")
        except Exception as e:
            sp.log(f"[WARN] Попытка авторизации {attempt}/{LOGIN_RETRIES} не удалась: {e}")
        if attempt < LOGIN_RETRIES:
            time.sleep(5 * attempt)
    sp.log("[ERROR] Авторизация не удалась после всех попыток")
    return False


def create_authorized_session(args):
    """Сессия с авторизацией: сначала cookie (если дали), затем логин/пароль."""
    cookie = (args.cookie or os.environ.get("SALETENNIS_COOKIE", "")).strip()
    if not cookie and args.cookie_file:
        try:
            with open(args.cookie_file, encoding="utf-8") as f:
                cookie = f.read().strip()
        except OSError as e:
            sp.log(f"[ERROR] Не удалось прочитать cookie-файл: {e}")

    if cookie:
        session = build_session()
        if login_with_cookie(session, cookie):
            return session
        sp.log("[WARN] Продолжаю с логином/паролем (если заданы)...")

    email = os.environ.get("SALETENNIS_EMAIL", "").strip()
    password = os.environ.get("SALETENNIS_PASSWORD", "").strip()
    if not email or not password:
        # дочитываем из parser/.env (та же логика, что в браузерном парсере)
        env_path = os.path.join(os.path.dirname(os.path.abspath(sp.__file__)), ".env")
        if os.path.exists(env_path):
            with open(env_path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, value = line.partition("=")
                    key, value = key.strip(), value.strip().strip('"').strip("'")
                    if key == "SALETENNIS_EMAIL" and not email:
                        email = value
                    elif key == "SALETENNIS_PASSWORD" and not password:
                        password = value
    if not email or not password:
        sp.log("[ERROR] Нет ни действующей cookie, ни SALETENNIS_EMAIL/SALETENNIS_PASSWORD")
        return None

    session = build_session()
    if login_with_credentials(session, email, password):
        return session
    return None


# ================= КАТАЛОГ =================

def _normalize_product_url(href: str) -> str:
    absolute = urljoin(BASE_URL + "/", href)
    return absolute.split('#')[0].split('?')[0].strip().rstrip('/')


def get_product_urls(session, category_url: str, cache_bust: bool = False):
    """Список ссылок на товары категории (серверная пагинация ?page=N).

    Возвращает (urls, response первой страницы) — ответ нужен, чтобы
    отличить «пустую категорию» от заглушки антибота/сбоя кэша.
    cache_bust=True добавляет случайный параметр и no-cache-заголовки
    (повторные попытки не должны доставать ту же заглушку из кэша CDN).
    """
    request_url = category_url
    headers = None
    if cache_bust:
        request_url = category_url + ('&' if '?' in category_url else '?') + f"_nc={int(time.time() * 1000)}"
        headers = {"Cache-Control": "no-cache", "Pragma": "no-cache"}
    r = fetch(session, request_url, headers=headers)
    if r is None:
        raise RuntimeError(f"категория не загрузилась: {category_url}")
    soup = BeautifulSoup(r.text, "lxml")

    max_page = 1
    for link in soup.select("a.pagination__link[data-page], .pagination a[data-page], .pagination a, .pager a"):
        page_str = link.get("data-page") or link.get_text(strip=True)
        if page_str and page_str.isdigit():
            max_page = max(max_page, int(page_str))
    sp.log(f"   [INFO] Страниц в категории: {max_page}")

    urls = set()

    def collect(page_soup):
        for a in page_soup.select('a[href*="/catalog/product/"]'):
            href = a.get("href")
            if href:
                urls.add(_normalize_product_url(href))

    collect(soup)
    base_url = category_url.split('?')[0].rstrip('/')
    parsed = urlparse(category_url)
    params = parse_qs(parsed.query)

    for page in range(2, max_page + 1):
        query_params = {k: v[0] for k, v in params.items()}
        query_params["page"] = str(page)
        query = '&'.join(f"{k}={v}" for k, v in query_params.items())
        pr = fetch(session, f"{base_url}?{query}")
        if pr is None:
            sp.log(f"   [WARN] Страница {page} не загрузилась — продолжаю без неё")
            continue
        collect(BeautifulSoup(pr.text, "lxml"))
        time.sleep(PAGE_DELAY)

    sp.log(f"   [INFO] Уникальных ссылок: {len(urls)}")
    return sorted(urls), r


# ============ ЗАЩИТА ОТ «ПУСТЫХ ЗАГЛУШЕК» НА СТРАНИЦАХ КАТЕГОРИЙ ============
#
# Симптом (2026-09-25, прогон в Actions): первые ~1650 запросов за 35 минут
# прошли нормально, затем сайт на ВСЕ оставшиеся страницы категорий начал
# мгновенно отдавать HTTP 200 без единой ссылки на товар. Данные не
# пострадали (прогон честно завершился с exit 1), но 6 категорий остались
# непарсенными. Похоже на мягкую антибот-блокировку или сбой кэша на стороне
# сайта: ответ маленький, без h1 и без пагинации.
#
# Лечение: пустая страница категории больше НЕ считается «пустой категорией».
# Делаем несколько попыток с растущим охлаждением, перелогином (новая сессия)
# и обходом кэша; сохраняем HTML заглушки в public/data/debug/ (уезжает
# артефактом в Actions) — в следующий раз будет видно, что именно отдал сайт.

def _debug_dir() -> str:
    return os.path.join(sp.DATA_DIR, "debug")


def _page_looks_like_catalog(resp, cat_url: str) -> bool:
    """Страница похожа на настоящую категорию (а не заглушку/блокировку)?"""
    if resp is None or resp.status_code != 200:
        return False
    if resp.url.split('?')[0].rstrip('/') != cat_url.split('?')[0].rstrip('/'):
        return False   # уехали редиректом (логин/главная/404-страница)
    if len(resp.text) < CATALOG_PAGE_MIN_BYTES:
        return False   # настоящая категория с меню и фильтрами ≈ 100-250 КБ
    soup = BeautifulSoup(resp.text, "lxml")
    return soup.find("h1") is not None


def _dump_category_page(resp, cat_url: str, attempt: int) -> str:
    """Сохранить HTML подозрительной страницы категории для диагностики."""
    try:
        debug_dir = _debug_dir()
        os.makedirs(debug_dir, exist_ok=True)
        slug = urlparse(cat_url).path.strip('/').replace('/', '-') or 'category'
        uniq = f"{int(time.time() * 1000) % 100_000_000}-{random.randint(100, 999)}"
        path = os.path.join(debug_dir, f"{slug}-attempt{attempt}-{uniq}.html")
        with open(path, "w", encoding="utf-8") as f:
            f.write(f"<!-- url: {cat_url}\n"
                    f"     final_url: {getattr(resp, 'url', '?')}\n"
                    f"     status: {getattr(resp, 'status_code', '?')}\n"
                    f"     saved_at: {time.strftime('%Y-%m-%d %H:%M:%S')} -->\n")
            f.write(resp.text)
        return path
    except OSError:
        return ""


def _log_page_diagnostics(resp, cat_name: str, cat_url: str, attempt: int):
    """Подробно описать пустую страницу: статус, размер, title, h1, текст."""
    tag = f"      [DIAG] «{cat_name}», попытка {attempt}: "
    if resp is None:
        sp.log(tag + "ответа нет (сеть/не-200 после всех повторов)")
        return
    title = h1_text = snippet = None
    try:
        soup = BeautifulSoup(resp.text, "lxml")
        if soup.title:
            title = soup.title.get_text(strip=True)[:100]
        h1 = soup.find("h1")
        if h1:
            h1_text = h1.get_text(strip=True)[:100]
        if soup.body:
            snippet = soup.body.get_text(" ", strip=True)[:300]
    except Exception:
        pass
    sp.log(f"{tag}HTTP {resp.status_code}, {len(resp.text)} байт, final_url={resp.url}")
    sp.log(f"      [DIAG] title={title!r} h1={h1_text!r}")
    if snippet:
        sp.log(f"      [DIAG] текст: {snippet}")
    path = _dump_category_page(resp, cat_url, attempt)
    if path:
        sp.log(f"      [DIAG] HTML сохранён: {path}")


def fetch_category_urls(session, cat_name: str, cat_url: str, args):
    """Ссылки товаров категории с защитой от «пустых заглушек».

    Возвращает (urls, session, page_valid):
      page_valid=True  — страница категории реально отдавалась сайтом
                         (товары есть ИЛИ категория действительно пуста);
      page_valid=False — все попытки получили заглушку/сбой → нужен
                         «финальный заход» после длинной паузы.
    """
    for attempt in range(1, CATEGORY_ATTEMPTS + 1):
        try:
            urls, resp = get_product_urls(session, cat_url, cache_bust=attempt > 1)
        except Exception as e:
            sp.log(f"   [ERROR] Категория «{cat_name}» не открылась: {e}")
            urls, resp = [], None
        if urls:
            if attempt > 1:
                sp.log(f"   [OK] «{cat_name}»: {len(urls)} товаров (с попытки {attempt})")
            return urls, session, True
        if _page_looks_like_catalog(resp, cat_url):
            sp.log(f"   [WARN] «{cat_name}»: страница валидна, но товаров нет "
                   f"— категория действительно пустая")
            return [], session, True
        _log_page_diagnostics(resp, cat_name, cat_url, attempt)
        if attempt == CATEGORY_ATTEMPTS:
            break
        cooldown = CATEGORY_COOLDOWNS[attempt - 1]
        sp.log(f"   [WARN] «{cat_name}»: страница без товаров (заглушка антибота/сбой кэша?). "
               f"Пауза {cooldown} с → перелогин → попытка {attempt + 1}/{CATEGORY_ATTEMPTS}")
        time.sleep(cooldown)
        new_session = create_authorized_session(args)
        if new_session is not None:
            session = new_session
    return [], session, False


def parse_category_products(session, cat_name, urls, args, acc, state):
    """Цикл товаров одной категории. acc/state — общие накопители прогона.

    acc:   {'products': [], 'sizes': [], 'cart_map': {}}
    state: {'consecutive_failures': 0, 'session_rebuilt': False, 'fatal_error': None}
    Возвращает сессию (могла быть пересоздана после серии сбоев).
    """
    for i, url in enumerate(urls):
        if (i + 1) % 25 == 0 or i == 0:
            sp.log(f"   [{i + 1}/{len(urls)}] {url}")
        product, session = parse_product(session, url, cat_name, args, state)
        if product:
            state['consecutive_failures'] = 0
            sizes_data = product.pop('sizes_data', [])
            cart_info = product.pop('cart_info', None)
            if cart_info:
                acc['cart_map'][url.rstrip('/')] = {
                    'itemId': cart_info['itemId'],
                    'article': product['Артикул'],
                    'sizes': cart_info['sizes'],
                }
            for size_info in sizes_data:
                size_info['Артикул'] = product['Артикул']
                size_info['Категория'] = product['Категория']
                size_info['Название'] = product['Название']
                size_info['Бренд'] = product['Бренд']
                size_info['Цена'] = product['Цена']
                size_info['Ссылка'] = product['Ссылка']
            acc['sizes'].extend(sizes_data)
            acc['products'].append(product)
        else:
            state['consecutive_failures'] += 1
            if state['consecutive_failures'] >= MAX_CONSECUTIVE_FAILURES:
                if state['session_rebuilt']:
                    state['fatal_error'] = (f"{state['consecutive_failures']} товаров подряд не загрузились "
                                            f"— вероятно, сайт блокирует этот IP")
                    break
                sp.log("[WARN] Много сбоев подряд — пересоздаю сессию...")
                new_session = create_authorized_session(args)
                if new_session is None:
                    state['fatal_error'] = "Сессия потеряна, перелогиниться не удалось"
                    break
                session = new_session
                state['session_rebuilt'] = True
                state['consecutive_failures'] = 0
        time.sleep(PAGE_DELAY * random.uniform(*PAGE_DELAY_JITTER))
    return session


# ================= КАРТОЧКА ТОВАРА =================

UNIT_RE = re.compile(r'\d+(?:[.,]\d+)?\s*([а-яА-ЯёЁa-zA-Z]+)')


def parse_stock_from_soup(soup):
    """
    Аналог parse_stock_from_table из браузерного парсера:
      A) строка = РАЗМЕР, во второй ячейке div'ы «Магазин - N шт/пар»;
      B) строка = МАГАЗИН, во второй ячейке «N банка/сет/кор/шт».
    """
    store_totals = {store: 0 for store in sp.STORES_FULL.keys()}
    sizes_data = []
    sizes_text_parts = []

    table = soup.select_one("table.admin-sizes")
    if table is None:
        return store_totals, sizes_data, "Нет информации о наличии"

    for row in table.find_all("tr"):
        cells = row.find_all("td")
        if len(cells) < 2:
            continue
        first_text = cells[0].get_text(" ", strip=True)
        if not first_text:
            continue
        second_cell = cells[1]
        second_text = second_cell.get_text(" ", strip=True)

        # --- Структура B: первая ячейка — магазин ---
        first_cell_store = sp._match_store(first_text.lower())
        if first_cell_store:
            qty_match = sp.QTY_RE.search(second_text)
            if qty_match:
                qty = sp._to_number(qty_match.group(1))
                unit_match = UNIT_RE.search(second_text)
                unit = unit_match.group(1).lower() if unit_match else 'шт'
                store_totals[first_cell_store] += qty
                sizes_data.append({
                    'Размер': 'Без размера',
                    'Магазин': first_cell_store,
                    'Количество': qty,
                })
                sizes_text_parts.append(f"{first_text}: {qty} {unit}")
            continue

        # --- Структура A: первая ячейка — размер ---
        size = first_text
        row_matched = False
        divs = second_cell.find_all("div")
        segments = [d.get_text(" ", strip=True) for d in divs if d.get_text(strip=True)] or (
            [second_text] if second_text else []
        )
        for segment in segments:
            qty_match = sp.QTY_RE.search(segment)
            if not qty_match:
                continue
            store = sp._match_store(segment.lower())
            if not store:
                continue
            qty = sp._to_number(qty_match.group(1))
            store_totals[store] += qty
            sizes_data.append({'Размер': size, 'Магазин': store, 'Количество': qty})
            sizes_text_parts.append(f"{size}: {segment}")
            row_matched = True
        if not row_matched and second_text:
            sizes_text_parts.append(f"{size}: {second_text}")

    details_text = ' | '.join(sizes_text_parts) if sizes_text_parts else 'Нет информации о наличии'
    return store_totals, sizes_data, details_text


def extract_price_http(soup) -> str:
    meta = soup.select_one("meta[itemprop='price']")
    if meta and meta.get("content"):
        clean = meta["content"].replace(' ', '').replace(',', '.').strip()
        try:
            num = float(clean)
            if num > 0:
                return f"{int(num)} ₽"
        except ValueError:
            pass
    # запасной вариант: видимая цена карточки
    for sel in (".card__price .price", ".card__price", "[itemprop='price']"):
        el = soup.select_one(sel)
        if el:
            digits = re.sub(r'[^\d,.]', '', el.get_text(strip=True))
            if digits:
                try:
                    return f"{int(float(digits.replace(' ', '').replace(',', '.')))} ₽"
                except ValueError:
                    pass
    return "Не указана"


def extract_article_http(soup) -> str:
    el = soup.select_one("p.card__code")
    if el:
        article = el.get_text(strip=True).replace("Артикул", "").replace("Арт.", "").strip()
        if article:
            return article
    return "Не указан"


def extract_image_url_http(soup):
    for selector in (
        ".slideshow__picture.slick-active img[itemprop='image']",
        ".slideshow__picture img",
        "img[itemprop='image']",
    ):
        img = soup.select_one(selector)
        if img:
            src = img.get("src") or img.get("data-src")
            if src:
                return urljoin(BASE_URL + "/", src)
    return None


def extract_brand_http(soup, name: str) -> str:
    """JSON-LD (если появится на сайте) → иначе определение по названию."""
    for script in soup.find_all("script", type="application/ld+json"):
        raw = (script.string or script.get_text() or "").strip()
        if not raw or 'brand' not in raw.lower():
            continue
        try:
            import json
            data = json.loads(raw)
        except ValueError:
            continue
        for item in (data if isinstance(data, list) else [data]):
            if not isinstance(item, dict):
                continue
            brand = item.get('brand')
            if isinstance(brand, dict):
                brand = brand.get('name')
            if isinstance(brand, str) and brand.strip() and not brand.strip().isdigit():
                return sp._normalize_brand_name(brand)
    return sp.brand_from_name(name)


# ================= СКИДКИ (раздел «Распродажа») =================

SALE_URL = BASE_URL + "/catalog/sale/"
SALE_MAX_PAGES = 80          # защита от бесконечной пагинации


def _price_number(text) -> float:
    """«11 990₽» / «11990 ₽» → 11990.0"""
    if text is None:
        return 0.0
    digits = re.sub(r"[^\d.,]", "", str(text)).replace(",", ".")
    try:
        return float(digits) if digits else 0.0
    except ValueError:
        return 0.0


def parse_discounts_soup(soup):
    """
    Карточки раздела «Распродажа». В data-ecommerce лежит JSON
    (id, name, price, brand, category), рядом — старая/текущая цена и бейдж процента:

        <div class="c-item c-item--expanded" data-ecommerce="{...}">
          <span class="c-item__label c-item__label--sale ...">25%</span>
          <a class="c-item__title" href="/catalog/product/…-19166/">…</a>
          <span class="c-item__price-old">11990₽</span>
          <span class="c-item__price-current">8993₽</span>
    """
    found = {}
    for card in soup.select("div.c-item[data-ecommerce]"):
        raw = (card.get("data-ecommerce") or "").strip()
        meta = {}
        if raw:
            try:
                meta = json.loads(raw)
            except (ValueError, TypeError):
                meta = {}
        item_id = str(meta.get("id") or "").strip()

        link_el = card.select_one("a.c-item__title") or card.select_one('a[href*="/catalog/product/"]')
        link = ""
        if link_el and link_el.get("href"):
            href = link_el["href"].strip()
            link = href if href.startswith("http") else BASE_URL + href
        if not item_id:
            # запасной вариант: числовой хвост ссылки товара
            m = re.search(r"-(\d{2,})/?$", link)
            if not m:
                continue
            item_id = m.group(1)

        cur_el = card.select_one(".c-item__price-current")
        old_el = card.select_one(".c-item__price-old")
        price = _price_number(cur_el.get_text()) if cur_el else 0.0
        old_price = _price_number(old_el.get_text()) if old_el else 0.0
        if not price:
            price = float(meta.get("price") or 0.0)

        percent = 0
        pct_el = card.select_one(".c-item__label--sale")
        if pct_el:
            m = re.search(r"(\d+)", pct_el.get_text())
            if m:
                percent = int(m.group(1))
        if not percent and old_price and price and price < old_price:
            percent = int(round((1 - price / old_price) * 100))
        if not percent or percent >= 100:
            continue

        name = str(meta.get("name") or (link_el.get_text(strip=True) if link_el else "") or "")
        found[item_id] = {
            "percent": percent,
            "price": int(price) if price else None,
            "oldPrice": int(old_price) if old_price else None,
            "name": name,
            "link": link,
        }
    # None-значения не пишем
    for entry in found.values():
        for key in ("price", "oldPrice"):
            if entry.get(key) is None:
                entry.pop(key, None)
    return found


def collect_discounts(session):
    """Обходит страницы /catalog/sale/ и собирает itemId → скидка."""
    all_items = {}
    for page in range(1, SALE_MAX_PAGES + 1):
        url = SALE_URL + (f"?page={page}" if page > 1 else "")
        r = fetch(session, url)
        if r is None:
            sp.log(f"[WARN] Распродажа: страница {page} не загрузилась — останавливаюсь")
            break
        soup = BeautifulSoup(r.text, "html.parser")
        items = parse_discounts_soup(soup)
        if not items:
            break
        all_items.update(items)
        sp.log(f"[INFO] Распродажа: страница {page} — {len(items)} товаров (всего {len(all_items)})")
        time.sleep(PAGE_DELAY)
    return all_items


def parse_cart_info_http(soup):
    """itemId кнопки «В корзину» + карта «текст размера → внутренний ID размера»."""
    btn = soup.select_one("[data-item-id]")
    if not btn:
        return None
    item_id = (btn.get("data-item-id") or "").strip()
    if not item_id:
        return None
    sizes = {}
    for radio in soup.select(".card__sizes input[type=radio][name=size]"):
        value = (radio.get("value") or "").strip()
        radio_id = radio.get("id")
        if not value or not radio_id:
            continue
        label = soup.find("label", attrs={"for": radio_id})
        if label:
            label_text = label.get_text(strip=True)
            if label_text:
                sizes[label_text] = value
    return {"itemId": item_id, "sizes": sizes}


def _stock_table_anomaly(soup) -> bool:
    """
    Признак «облегчённой» страницы: селектор размеров присутствует, а таблицы
    наличия table.admin-sizes нет. Таблица отдаётся только авторизованной
    сессии, поэтому её отсутствие при живых размерах — это «протухшая» сессия
    или мягкий антибот/сбой кэша, но НЕ распродажа. У полностью распроданного
    товара сайт не показывает ни таблицы, ни размеров (→ False).
    """
    if soup.select_one("table.admin-sizes"):
        return False
    return bool(soup.select(".card__sizes input[type=radio][name=size]"))


def _fetch_product_soup(session, url: str, cache_bust: bool = False):
    """Один запрос карточки товара → (soup, None) либо (None, причина)."""
    request_url = url
    headers = None
    if cache_bust:
        # обходим возможный кэш CDN: случайный параметр + no-cache
        request_url = url + ('&' if '?' in url else '?') + f"_nc={int(time.time() * 1000)}"
        headers = {"Cache-Control": "no-cache", "Pragma": "no-cache"}
    r = fetch(session, request_url, headers=headers)
    if r is None:
        return None, "страница не загрузилась"
    soup = BeautifulSoup(r.text, "lxml")
    if soup.find("h1") is None:
        return None, "нет h1 (возможно, страница заблокирована)"
    return soup, None


def _product_from_soup(soup, url: str, category: str) -> dict:
    """Собрать словарь товара из уже загруженного soup (тот же формат, что браузерный)."""
    h1 = soup.find("h1")
    name = (h1.get_text(strip=True) if h1 else "") or "Не найдено"
    article = extract_article_http(soup)
    price = extract_price_http(soup)
    brand = extract_brand_http(soup, name)
    store_totals, sizes_data, details_text = parse_stock_from_soup(soup)
    image_url = extract_image_url_http(soup)
    image_path = sp.download_image(image_url)
    cart_info = parse_cart_info_http(soup)
    return {
        'Категория': category,
        'Артикул': article,
        'Название': name,
        'Бренд': brand,
        'Цена': price,
        'Ссылка': url,
        'Размеры и наличие': details_text,
        'Всего': sum(store_totals.values()),
        'Фото': image_path,
        **store_totals,
        'sizes_data': sizes_data,
        'cart_info': cart_info,
    }


def _stock_relogin_allowed(state) -> bool:
    """Не исчерпан ли бюджет перелогинов из-за пропавшей таблицы наличия."""
    if state is None:
        return True   # одиночные вызовы/тесты без общего состояния — не ограничиваем
    return state.get('stock_relogins', 0) < MAX_STOCK_RELOGINS


def _note_stock_relogin(state):
    if state is not None:
        state['stock_relogins'] = state.get('stock_relogins', 0) + 1


def _remember_stock_anomaly(state, url: str, category: str, article: str):
    """Товар пришёл без таблицы наличия — запоминаем для финального захода."""
    if state is None:
        return
    anomalies = state.setdefault('stock_anomalies', [])
    if not any(a['url'] == url for a in anomalies):
        anomalies.append({'url': url, 'category': category, 'article': article})


def parse_product(session, url: str, category: str, args=None, state=None):
    """
    Возвращает (product|None, session).

    Сессия может быть пересоздана: таблица наличия table.admin-sizes отдаётся
    только авторизованной сессией, поэтому её отсутствие при живых размерах —
    признак «протухшей» сессии/антибота, а не распродажи. В этом случае
    перелогиниваемся (если есть args и не исчерпан бюджет) и перечитываем товар
    уже авторизованной сессией, а новую сессию возвращаем наружу — следующие
    товары пойдут через неё.
    """
    product = None
    anomalous = False
    last_error = None
    for attempt in range(sp.PRODUCT_RETRIES + 1):
        try:
            if attempt > 0:
                sp.log(f"      [RETRY {attempt}] {url}")
                time.sleep(1.5 * attempt)
            soup, err = _fetch_product_soup(session, url, cache_bust=attempt > 0)
            if soup is None:
                last_error = err
                continue
            anomalous = _stock_table_anomaly(soup)
            if anomalous and attempt < sp.PRODUCT_RETRIES:
                last_error = "есть размеры, но нет таблицы наличия (сбой кэша/сессии) — повторяю"
                sp.log(f"      [WARN] {url}: {last_error}")
                continue
            product = _product_from_soup(soup, url, category)
            break
        except Exception as e:
            last_error = e

    if product is None:
        sp.log(f"   [ERROR] Не удалось распарсить {url}: {last_error}")
        return None, session

    # Стойкая аномалия: размеры есть, таблицы наличия нет даже после повторов.
    # Перелогиниваемся и читаем товар ещё раз — уже авторизованной сессией.
    if anomalous and args is not None and _stock_relogin_allowed(state):
        logged_in = is_logged_in(session)
        sp.log(f"      [WARN] {url}: нет таблицы наличия при живых размерах "
               f"(сессия {'авторизована — вероятно антибот/кэш' if logged_in else 'РАЗЛОГИНЕНА'}) "
               f"— перелогиниваюсь")
        new_session = create_authorized_session(args)
        if new_session is not None:
            session = new_session
            _note_stock_relogin(state)
            try:
                soup2, err2 = _fetch_product_soup(session, url, cache_bust=True)
                if soup2 is not None:
                    product = _product_from_soup(soup2, url, category)
                    anomalous = _stock_table_anomaly(soup2)
                else:
                    sp.log(f"      [WARN] {url}: повтор после перелогина не удался: {err2}")
            except Exception as e:
                sp.log(f"      [WARN] {url}: повтор после перелогина упал: {e}")
        else:
            sp.log(f"      [WARN] {url}: перелогиниться не удалось — товар без таблицы наличия")

    if anomalous:
        # Так и не получили таблицу. Товар НЕ распродан (размеры есть) — данные
        # не отдали сессия/антибот. Из каталога не теряем, но помечаем для
        # финального захода в конце прогона.
        _remember_stock_anomaly(state, url, category, product.get('Артикул', ''))
        sp.log(f"      [WARN] {url}: таблица наличия так и не получена — помечен для финального захода")

    return product, session


def _replace_product_in_acc(acc, url: str, product: dict):
    """Подменяет товар (и его размеры/карту корзины) в накопителях прогона."""
    key = url.rstrip('/')
    sizes_data = product.pop('sizes_data', [])
    cart_info = product.pop('cart_info', None)
    for i, p in enumerate(acc['products']):
        if p.get('Ссылка', '').rstrip('/') == key:
            acc['products'][i] = product
            break
    else:
        acc['products'].append(product)
    # размеры: у товара без таблицы их не было; убираем возможные старые и пишем новые
    acc['sizes'] = [s for s in acc['sizes'] if s.get('Ссылка', '').rstrip('/') != key]
    for size_info in sizes_data:
        size_info['Артикул'] = product['Артикул']
        size_info['Категория'] = product['Категория']
        size_info['Название'] = product['Название']
        size_info['Бренд'] = product['Бренд']
        size_info['Цена'] = product['Цена']
        size_info['Ссылка'] = product['Ссылка']
    acc['sizes'].extend(sizes_data)
    if cart_info:
        acc['cart_map'][key] = {
            'itemId': cart_info['itemId'],
            'article': product['Артикул'],
            'sizes': cart_info['sizes'],
        }


def retry_stock_anomalies(session, anomalies, acc):
    """
    Финальный заход: перечитывает товары, пришедшие без таблицы наличия, свежей
    сессией и подменяет их в накопителях. Возвращает список тех, что так и не
    получили таблицу. args не передаём — сессия уже авторизована, перелогин
    внутри parse_product не нужен.
    """
    still_bad = []
    for a in anomalies:
        url = a['url']
        product, session = parse_product(session, url, a.get('category', ''), args=None, state=None)
        if product is not None and product.get('Размеры и наличие') != 'Нет информации о наличии':
            _replace_product_in_acc(acc, url, product)
            sp.log(f"      [OK] {url}: таблица наличия получена после финального захода")
        else:
            still_bad.append(a)
        time.sleep(PAGE_DELAY * random.uniform(*PAGE_DELAY_JITTER))
    return still_bad



# ================= ГЛАВНЫЙ ЦИКЛ =================

def main():
    ap = argparse.ArgumentParser(description="HTTP-парсер остатков SaleTennis (без браузера)")
    ap.add_argument("--out", default=os.environ.get("DATA_DIR", "data"),
                    help="папка для данных: 'data' или 'public/data' (прямо в сайт)")
    ap.add_argument("--categories", default="",
                    help="только указанные категории через запятую (для проверки)")
    ap.add_argument("--limit", type=int, default=0,
                    help="не больше N товаров в категории (для быстрой проверки)")
    ap.add_argument("--cookie", default="",
                    help="значение PHPSESSID готовой сессии (вместо логина)")
    ap.add_argument("--cookie-file", default="",
                    help="файл со значением PHPSESSID")
    args = ap.parse_args()

    sp.configure_paths(args.out)

    categories = sp.CATEGORIES
    if args.categories:
        wanted = {c.strip() for c in args.categories.split(',')}
        categories = {k: v for k, v in sp.CATEGORIES.items() if k in wanted}
        if not categories:
            print(f"[ERROR] Нет таких категорий. Доступны: {', '.join(sp.CATEGORIES)}")
            sys.exit(1)

    sp.log("[INFO] Запуск HTTP-парсера SaleTennis (без браузера)...")
    sp.log(f"[INFO] Данные будут записаны в: {os.path.abspath(sp.DATA_DIR)}")
    sp.log("=" * 60)

    session = create_authorized_session(args)
    if session is None:
        sp.log("[ERROR] Нет авторизованной сессии. Завершение.")
        sys.exit(1)

    all_products = []
    all_sizes_data = []
    all_cart_map = {}
    acc = {'products': all_products, 'sizes': all_sizes_data, 'cart_map': all_cart_map}
    state = {'consecutive_failures': 0, 'session_rebuilt': False, 'fatal_error': None,
             'stock_relogins': 0, 'stock_anomalies': []}
    skipped_categories = []   # категории, где товаров нет (в т.ч. действительно пустые)
    retry_queue = []          # категории-«заглушки» — для финального захода

    def run_category(cat_name, cat_url, is_retry=False):
        """Одна категория: ссылки (с ретраями) + товары. False = fatal."""
        nonlocal session
        sp.log(f"\n[INFO] Категория{' (повторно)' if is_retry else ''}: {cat_name}")
        urls, session, page_valid = fetch_category_urls(session, cat_name, cat_url, args)
        if not urls:
            if page_valid:
                sp.log(f"[WARN] В категории «{cat_name}» нет товаров")
                skipped_categories.append(cat_name)
            else:
                retry_queue.append((cat_name, cat_url))
            return True   # не fatal — продолжаем остальные категории
        if args.limit:
            urls = urls[:args.limit]
        session = parse_category_products(session, cat_name, urls, args, acc, state)
        return not state['fatal_error']

    for cat_name, cat_url in categories.items():
        if not run_category(cat_name, cat_url):
            break
        time.sleep(random.uniform(*CATEGORY_PAUSE))

    # ---- Финальный заход: категории, отдавшие пустые страницы-заглушки ----
    # К этому моменту сайт обычно «отходит» (блокировка короткая), а свежая
    # сессия снимает возможный лимит по PHPSESSID.
    if retry_queue and not state['fatal_error']:
        names = [c for c, _ in retry_queue]
        sp.log(f"\n[WARN] {len(names)} категорий отдали пустые страницы-заглушки: {names}")
        sp.log(f"[WARN] Финальный заход: пауза {FINAL_PASS_COOLDOWN} с → новая сессия → повтор.")
        time.sleep(FINAL_PASS_COOLDOWN)
        new_session = create_authorized_session(args)
        if new_session is not None:
            session = new_session
        state['session_rebuilt'] = False   # новая сессия — отсчёт пересозданий заново
        retry_now, retry_queue = retry_queue, []
        for cat_name, cat_url in retry_now:
            if not run_category(cat_name, cat_url, is_retry=True):
                break
            time.sleep(random.uniform(*CATEGORY_PAUSE))

    # ---- Финальный заход: товары, пришедшие без таблицы наличия ----
    # Таблица admin-sizes auth-gated: если сессия «протухла» или сайт отдавал
    # публичные страницы (мягкий антибот), товар приходил без остатков и нулями.
    # К концу прогона сайт обычно «отходит», а свежая сессия возвращает таблицу —
    # перечитываем отставшие товары и подменяем их в данных.
    anomalies = state.get('stock_anomalies', [])
    if anomalies and not state['fatal_error']:
        sp.log(f"\n[WARN] {len(anomalies)} товаров пришли без таблицы наличия "
               f"(протухшая сессия/антибот): "
               + ", ".join(a['article'] or a['url'] for a in anomalies[:10])
               + (" …" if len(anomalies) > 10 else ""))
        sp.log(f"[WARN] Финальный заход: пауза {STOCK_FINAL_COOLDOWN} с → новая сессия → перечитываем.")
        time.sleep(STOCK_FINAL_COOLDOWN)
        new_session = create_authorized_session(args)
        if new_session is not None:
            session = new_session
        still_bad = retry_stock_anomalies(session, anomalies, acc)
        state['stock_anomalies'] = still_bad
        if still_bad:
            sp.log(f"[WARN] После финального захода осталось {len(still_bad)} товаров без таблицы наличия: "
                   + ", ".join(a['article'] or a['url'] for a in still_bad[:15])
                   + (" …" if len(still_bad) > 15 else ""))
            if len(still_bad) >= STOCK_ANOMALY_FATAL:
                state['fatal_error'] = (f"{len(still_bad)} товаров без таблицы наличия даже после "
                                        f"перелогина и финального захода — сайт не отдаёт остатки "
                                        f"(сессия/антибот)")
        else:
            sp.log("[OK] Финальный заход вернул таблицу наличия всем отставшим товарам")

    fatal_error = state['fatal_error']

    sp.log(f"[INFO] Собрано товаров: {len(all_products)}")
    if fatal_error or skipped_categories or retry_queue:
        if retry_queue:
            skipped_categories = skipped_categories + [c for c, _ in retry_queue]
        sp.log("[ERROR] Парсинг неполный: "
               + (f"пропущены категории {skipped_categories}; " if skipped_categories else "")
               + (fatal_error or ""))
        sp.log("[ERROR] Основные файлы НЕ обновлены — данные сайта остаются прежними.")
        debug_dir = _debug_dir()
        if os.path.isdir(debug_dir):
            sp.log(f"[ERROR] Диагностика заглушек: {debug_dir}/ "
                   f"(в Actions скачайте артефакт parse-log-* — HTML страниц приложен)")
        sys.exit(1)
    # прогон полный — диагностические дампы не нужны (и не должны попасть в git)
    shutil.rmtree(_debug_dir(), ignore_errors=True)
    if not all_products:
        sp.log("[ERROR] Не удалось собрать данные — файлы не тронуты.")
        sys.exit(1)

    df = pd.DataFrame(all_products)
    before = len(df)
    df = df.drop_duplicates(subset=['Ссылка'], keep='first')
    df = df.drop_duplicates(subset=['Артикул', 'Название'], keep='first')
    sp.log(f"[OK] Товаров: {len(df)} (убрано дублей ссылок: {before - len(df)})")

    df.to_csv(sp.PRODUCTS_CSV, index=False, encoding='utf-8-sig')
    sp.log(f"[OK] Каталог сохранён: {sp.PRODUCTS_CSV}")

    sizes_df = None
    try:
        sizes_df = sp.save_sizes_data(all_sizes_data)
    except Exception as e:
        sp.log(f"[ERROR] Не удалось сохранить sizes.csv: {e}")
    try:
        sp.save_cart_map(all_cart_map)
    except Exception as e:
        sp.log(f"[ERROR] Не удалось сохранить cart-map.json: {e}")
    # Скидки — раздел публичный, авторизация не нужна; сбой не должен ронять парсинг
    try:
        sp.log("\n[INFO] Собираю скидки из раздела «Распродажа»…")
        discounts = collect_discounts(build_session())
        sp.save_discounts(discounts)
    except Exception as e:
        sp.log(f"[WARN] Не удалось собрать скидки: {e}")
    try:
        sp.save_history_snapshot(df, sizes_df)
    except Exception as e:
        sp.log(f"[ERROR] Не удалось сохранить снимок истории: {e}")

    # ---- Журнал изменений: сравниваем с предыдущим снимком ----
    try:
        all_snapshots = sorted(
            [f for f in os.listdir(sp.HISTORY_DIR)
             if f.endswith('.csv') and not f.startswith('sizes-')],
            reverse=True
        )
        if len(all_snapshots) >= 2:
            previous_file = os.path.join(sp.HISTORY_DIR, all_snapshots[1])
            sp.log(f"\n[INFO] Сравниваю с предыдущим снимком: {previous_file}")
            old_df = pd.read_csv(previous_file, encoding='utf-8-sig')
            changes = sp.analyze_changes(old_df, df)
            sp.save_changes(changes)
            if changes:
                new_products = [c for c in changes if c['Тип изменения'] == 'Новый товар']
                sold_out = [c for c in changes if c['Тип изменения'] == 'Товар закончился']
                qty = [c for c in changes if c['Тип изменения'] == 'Изменение количества']
                sp.log(f"[СВОДКА] новых: {len(new_products)} | закончилось: {len(sold_out)} "
                       f"| изменений количества: {len(qty)}")
        else:
            sp.log("[INFO] Первый снимок — журнал изменений появится со следующего запуска")
    except Exception as e:
        sp.log(f"[WARN] Не удалось сравнить снимки: {e}")

    photos = len([p for p in all_products if p.get('Фото')])
    sp.log(f"\n[INFO] Фотографий (всего/в кэше): {photos}")
    sp.log("=" * 60)
    sp.log("[OK] HTTP-парсинг завершён!")


if __name__ == "__main__":
    main()
