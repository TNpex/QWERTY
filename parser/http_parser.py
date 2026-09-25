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
import re
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


def get_product_urls(session, category_url: str):
    """Список ссылок на товары категории (серверная пагинация ?page=N)."""
    r = fetch(session, category_url)
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
    return sorted(urls)


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
    Признак «облегчённой» страницы (сбой кэша/CDN): селектор размеров
    присутствует, а таблицы наличия table.admin-sizes нет. У полностью
    распроданного товара сайта не показывает ни таблицы, ни размеров.
    Такие страницы перезапрашиваем со сбросом кэша — иначе товар ложно
    получает «Нет информации о наличии» и нули (кейс 17 платьев 2026-09-24).
    """
    if soup.select_one("table.admin-sizes"):
        return False
    return bool(soup.select(".card__sizes input[type=radio][name=size]"))


def parse_product(session, url: str, category: str):
    """Возвращает словарь товара (тот же формат, что браузерный parse_product)."""
    last_error = None
    for attempt in range(sp.PRODUCT_RETRIES + 1):
        try:
            if attempt > 0:
                sp.log(f"      [RETRY {attempt}] {url}")
                time.sleep(1.5 * attempt)
            request_url = url
            headers = None
            if attempt > 0:
                # обходим возможный кэш CDN: случайный параметр + no-cache
                request_url = url + ('&' if '?' in url else '?') + f"_nc={int(time.time() * 1000)}"
                headers = {"Cache-Control": "no-cache", "Pragma": "no-cache"}
            r = fetch(session, request_url, headers=headers)
            if r is None:
                last_error = "страница не загрузилась"
                continue
            soup = BeautifulSoup(r.text, "lxml")
            h1 = soup.find("h1")
            if h1 is None:
                last_error = "нет h1 (возможно, страница заблокирована)"
                continue
            if _stock_table_anomaly(soup) and attempt < sp.PRODUCT_RETRIES:
                last_error = "есть размеры, но нет таблицы наличия (сбой кэша) — повторяю"
                sp.log(f"      [WARN] {url}: {last_error}")
                continue

            name = h1.get_text(strip=True) or "Не найдено"
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
        except Exception as e:
            last_error = e
    sp.log(f"   [ERROR] Не удалось распарсить {url}: {last_error}")
    return None


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
    fatal_error = None
    skipped_categories = []
    consecutive_failures = 0
    session_rebuilt = False

    for cat_name, cat_url in categories.items():
        sp.log(f"\n[INFO] Категория: {cat_name}")
        try:
            urls = get_product_urls(session, cat_url)
        except Exception as e:
            sp.log(f"[ERROR] Категория «{cat_name}» не открылась: {e}")
            skipped_categories.append(cat_name)
            continue
        if not urls:
            sp.log(f"[WARN] В категории «{cat_name}» нет товаров")
            skipped_categories.append(cat_name)
            continue
        if args.limit:
            urls = urls[:args.limit]

        for i, url in enumerate(urls):
            if (i + 1) % 25 == 0 or i == 0:
                sp.log(f"   [{i + 1}/{len(urls)}] {url}")
            product = parse_product(session, url, cat_name)
            if product:
                consecutive_failures = 0
                sizes_data = product.pop('sizes_data', [])
                cart_info = product.pop('cart_info', None)
                if cart_info:
                    all_cart_map[url.rstrip('/')] = {
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
                all_sizes_data.extend(sizes_data)
                all_products.append(product)
            else:
                consecutive_failures += 1
                if consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                    if session_rebuilt:
                        fatal_error = (f"{consecutive_failures} товаров подряд не загрузились "
                                       f"— вероятно, сайт блокирует этот IP")
                        break
                    sp.log("[WARN] Много сбоев подряд — пересоздаю сессию...")
                    new_session = create_authorized_session(args)
                    if new_session is None:
                        fatal_error = "Сессия потеряна, перелогиниться не удалось"
                        break
                    session = new_session
                    session_rebuilt = True
                    consecutive_failures = 0
            time.sleep(PAGE_DELAY)
        if fatal_error:
            break

    sp.log(f"[INFO] Собрано товаров: {len(all_products)}")
    if fatal_error or skipped_categories:
        sp.log("[ERROR] Парсинг неполный: "
               + (f"пропущены категории {skipped_categories}; " if skipped_categories else "")
               + (fatal_error or ""))
        sp.log("[ERROR] Основные файлы НЕ обновлены — данные сайта остаются прежними.")
        sys.exit(1)
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
