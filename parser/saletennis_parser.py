# -*- coding: utf-8 -*-
"""
BI-парсер SaleTennis — улучшенная версия для сайта QWERTY BI Analytics.

Что улучшено по сравнению с вашей версией:
1. БЕЗОПАСНОСТЬ: логин/пароль — только из переменных окружения или файла .env
   (в репозиторий НЕ попадают; .env в .gitignore).
2. Дубли артикулов НЕ теряются: уникальность определяется по «Ссылке»
   (уникальна у каждого варианта товара), а не по артикулу. Раньше
   drop_duplicates(subset=['Артикул']) удалял ~160 товаров-вариантов
   (Bidi Badu, струны, кроссовки 7/6) — они оставались только в sizes.csv.
3. Таблица наличия: строки «магазин + количество» определяются по ключевым
   словам магазина, поэтому «банка / кор / сет / бобина» больше не теряются
   (keйс 46 товаров с «Нет информации о наличии»).
4. Бренд берётся из JSON-LD страницы (точные данные сайта), а не только из
   названия — «Не определен» практически исчезает.
5. Журнал изменений сравнивает по «Артикул+Название» — дубли артикулов
   больше не дают ложных «продаж» на сотни единиц (кейс струн -125).
6. Режим сайта: --out public/data пишет данные сразу в структуру сайта И
   сам обновляет history/manifest.json (+ снимок sizes) — отдельная команда
   `npm run snapshot` больше не нужна.
7. Повторы при сбоях загрузки страниц, дробные количества («8,5 сет»),
   лог в файл, без блокирующего input() (можно запускать в автоматизации).

Запуск:
    python parser/saletennis_parser.py                 # данные в parser/data (как раньше)
    python parser/saletennis_parser.py --out public/data   # прямо в данные сайта

Переменные окружения (или parser/.env):
    SALETENNIS_EMAIL, SALETENNIS_PASSWORD
"""

import argparse
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime
from urllib.parse import urlparse, parse_qs

import pandas as pd
import requests
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

# ================= КОНФИГУРАЦИЯ =================

LOGIN_URL = "https://saletennis.com/login?backUrl=https%253A%252F%252Fsaletennis.com%252F"

CATEGORIES = {
    "Сумки и чехлы": "https://saletennis.com/catalog/sumki-i-chekhly/",
    "Одежда": "https://saletennis.com/catalog/odezhda/",
    "Обувь": "https://saletennis.com/catalog/obuv/",
    "Теннисные струны": "https://saletennis.com/catalog/tennisnye-struny/",
    "Ракетки для тенниса": "https://saletennis.com/catalog/tennisnye-raketki/",
    "Мячи для тенниса": "https://saletennis.com/catalog/tennisnye-myachi/",
    "Аксессуары": "https://saletennis.com/catalog/aksessuary/",
    "Оборудование": "https://saletennis.com/catalog/stroitelstvo-kortov/",
    "Падел - Ракетки": "https://saletennis.com/catalog/padel/raketki/",
    "Падел - Сумки и чехлы": "https://saletennis.com/catalog/padel/sumki-i-chekhly/",
    "Падел - Аксессуары": "https://saletennis.com/catalog/padel/aksessuary/",
    "Падел - Мячи": "https://saletennis.com/catalog/padel/myachi/",
}

KNOWN_BRANDS = [
    'Bullpadel', 'Head', 'Adidas', 'Wilson', 'Black Crown', 'Babolat', 'Siux',
    'Tecnifibre', '7/6', 'Solinco', 'Nox', 'Royal Padel', 'StarVie', 'Kuikma',
    'Dropshot', 'Varlion', 'Palmer', 'Asics', 'Nike', 'Joma', 'Fila', 'Lotto',
    'Yonex', 'Volkl', 'Dunlop', 'Gamma', 'Luxilon', 'Bidi Badu', 'Mizuno',
    'Saletennis', 'Diadora', 'Diadem', 'Prince',
    'Nata',  # линейка одежды 7/6 (артикулы NT76-*) — приводится к '7/6', см. BRAND_REMAP
    # добор по фактическим «Не определен» из каталога (аксессуары/сквош/падел)
    'Tennis Life', 'Slazenger', 'Oxdog', 'Torres', 'Milo',
]

# Опечатки бренда Tecnifibre прямо в названиях на сайте:
# «Tecnifbre Fire 285», «Tecnifiber Carboflex» → Tecnifibre
TECNIFIBRE_TYPOS = ('tecnifbre', 'tecnifiber', 'tecnifibr')

# Бренды-линейки: сайт отдаёт их как отдельный бренд (в JSON-LD и в названии),
# хотя на самом деле это линия другого производителя.
#   «Nata» — линейка одежды 7/6: артикулы NT76-4104, NT76-1265, … то есть тот же
#   шаблон XX76-…, что у TS76-BKWH / TB76-BL / KB276-BL; отдельного бренда Nata
#   в сети нет. Без этого правила бренд возвращался бы при каждом парсинге.
BRAND_REMAP = {
    'nata': '7/6',
}


def _normalize_brand_name(brand: str) -> str:
    """Приводит опечатки и бренды-линейки в названиях/JSON-LD к каноническому виду."""
    low = brand.strip().lower()
    if low in TECNIFIBRE_TYPOS:
        return 'Tecnifibre'
    if low in BRAND_REMAP:
        return BRAND_REMAP[low]
    return brand.strip()

STORES_FULL = {
    'Санкт-Петербург (Ярослава Гашека)': ['ярослава гашека', 'ярослава'],
    'Санкт-Петербург (Спортивная)': ['спортивная'],
    'Екатеринбург (Основной склад)': ['основной склад', 'склад екатеринбург', 'екатеринбург (основной'],
    'Екатеринбург (Соболева)': ['соболева'],
    'Екатеринбург (Парина)': ['парина', 'академика парина'],
    'Екатеринбург (Бисертская)': ['бисертская'],
    'Екатеринбург (Елизаветинское шоссе)': ['елизаветинское шоссе', 'елизавет'],
    'Екатеринбург (Полевской тракт)': ['полевской тракт', 'полевской'],
    'Тюмень (Народная)': ['тюмень', 'народная'],
    'Уфа': ['уфа'],
    'Ижевск': ['ижевск'],
}
# ВАЖНО: «Санкт-Петербург» убран из ключей Спортивной (иначе любая питерская
# строка матчила бы её первой); порядок перебора — от специфичных к общим.

PAGE_DELAY = 0.5          # вежливая пауза между страницами
PRODUCT_RETRIES = 2       # повторы при сбое загрузки товара
REQUEST_TIMEOUT = 30      # таймаут HTTP-запросов (фото и т.п.)
PAGE_LOAD_TIMEOUT = 60    # таймаут загрузки страницы браузером
LOGIN_RETRIES = 3         # попытки авторизации (облачные раннеры бывают медленными)

# ================= ПУТИ (настраиваются через --out) =================

DATA_DIR = "data"
HISTORY_DIR = ""
IMAGES_DIR = ""
PRODUCTS_CSV = ""
SIZES_CSV = ""
CHANGES_CSV = ""
CART_MAP_JSON = ""
DISCOUNTS_JSON = ""
LOG_FILE = ""


def configure_paths(out_dir: str):
    global DATA_DIR, HISTORY_DIR, IMAGES_DIR, PRODUCTS_CSV, SIZES_CSV, CHANGES_CSV, CART_MAP_JSON, DISCOUNTS_JSON, LOG_FILE
    DATA_DIR = out_dir
    HISTORY_DIR = os.path.join(DATA_DIR, "history")
    IMAGES_DIR = os.path.join(DATA_DIR, "product_images")
    PRODUCTS_CSV = os.path.join(DATA_DIR, "products.csv")
    SIZES_CSV = os.path.join(DATA_DIR, "sizes.csv")
    CHANGES_CSV = os.path.join(DATA_DIR, "changes.csv")
    CART_MAP_JSON = os.path.join(DATA_DIR, "cart-map.json")
    DISCOUNTS_JSON = os.path.join(DATA_DIR, "discounts.json")
    LOG_FILE = os.path.join(DATA_DIR, "parse.log")
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(HISTORY_DIR, exist_ok=True)
    os.makedirs(IMAGES_DIR, exist_ok=True)


def log(message: str):
    line = f"[{datetime.now().strftime('%H:%M:%S')}] {message}"
    print(line, flush=True)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"[{datetime.now().isoformat(timespec='seconds')}] {message}\n")
    except OSError:
        pass


# ================= УЧЁТНЫЕ ДАННЫЕ (безопасно) =================

def load_credentials():
    """Логин/пароль из окружения или .env рядом со скриптом. В коде их НЕТ."""
    email = os.environ.get("SALETENNIS_EMAIL", "").strip()
    password = os.environ.get("SALETENNIS_PASSWORD", "").strip()

    if not email or not password:
        env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
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
        print(
            "[ERROR] Не заданы учётные данные.\n"
            "  Создайте файл parser/.env (он в .gitignore, в репозиторий не попадёт):\n"
            "    SALETENNIS_EMAIL=ваша@почта\n"
            "    SALETENNIS_PASSWORD=ваш пароль\n"
            "  или задайте переменные окружения SALETENNIS_EMAIL / SALETENNIS_PASSWORD."
        )
        sys.exit(1)
    return email, password


# ================= ДРАЙВЕР =================

def _block_analytics(driver):
    """
    Отключает счётчики/рекламу (Метрика, Sentry, click.ru, GA...). Они не нужны
    парсеру, но именно из-за них страница логина на облачном раннере иногда не
    «догружается» за 30 секунд → TimeoutException «Timed out receiving message
    from renderer». Бонус: страницы грузятся заметно быстрее.
    """
    try:
        driver.execute_cdp_cmd(
            "Network.setBlockedURLs",
            {"urls": [
                "*mc.yandex.ru*", "*yandexmetrika*", "*sentry-cdn*", "*af.click.ru*",
                "*google-analytics*", "*googletagmanager*", "*doubleclick*",
                "*facebook.net*", "*facebook.com/tr*",
            ]},
        )
    except Exception as e:
        log(f"[WARN] Не удалось заблокировать аналитику (не критично): {e}")


def init_driver():
    log("[INFO] Инициализация headless-браузера...")
    from selenium.webdriver.edge.options import Options as EdgeOptions
    from selenium.webdriver.edge.service import Service as EdgeService

    edge_options = EdgeOptions()
    edge_options.add_argument("--headless=new")
    edge_options.add_argument("--window-size=1920,1080")
    edge_options.add_argument("--disable-gpu")
    edge_options.add_argument("--no-sandbox")
    edge_options.add_argument("--disable-dev-shm-usage")  # в контейнере /dev/shm мал — рендерер не будет «зависать»
    edge_options.add_argument("--log-level=3")
    edge_options.add_argument("--disable-blink-features=AutomationControlled")
    # Ждём только DOM (DOMContentLoaded), а не полную загрузку с картинками и
    # аналитикой: на headless-браузере в GitHub Actions полная загрузка
    # страницы логина иногда не успевала за 30 с и роняла весь прогон.
    edge_options.page_load_strategy = "eager"

    # Selenium 4.6+ сам находит драйвер (Selenium Manager); fallback — webdriver_manager
    try:
        driver = webdriver.Edge(options=edge_options)
    except Exception:
        from webdriver_manager.microsoft import EdgeChromiumDriverManager
        service = EdgeService(EdgeChromiumDriverManager().install())
        driver = webdriver.Edge(service=service, options=edge_options)

    driver.set_page_load_timeout(PAGE_LOAD_TIMEOUT)
    _block_analytics(driver)
    return driver


def _login_once(driver, email, password):
    """Одна попытка авторизации. Бросает исключение, если форма/переход не удались."""
    try:
        driver.get(LOGIN_URL)
    except Exception as e:
        # Таймаут загрузки страницы — ещё не приговор: с стратегией «eager» DOM
        # обычно уже построен, форма логина на месте. Пробуем работать с тем,
        # что загрузилось (раньше здесь сразу падал весь прогон).
        log(f"[WARN] Страница логина не догрузилась ({e.__class__.__name__}) — пробую текущий DOM")
    time.sleep(2)
    email_input = WebDriverWait(driver, 15).until(
        EC.presence_of_element_located((By.ID, "form-login-username"))
    )
    password_input = driver.find_element(By.ID, "form-login-password")
    login_button = driver.find_element(
        By.XPATH, "//input[@type='submit' and contains(@class, 'button')]"
    )
    email_input.clear()
    email_input.send_keys(email)
    password_input.clear()
    password_input.send_keys(password)
    driver.execute_script("arguments[0].click();", login_button)
    WebDriverWait(driver, 20).until(lambda d: '/login' not in d.current_url.lower())
    return True


def login(driver, email, password):
    """Авторизация с несколькими попытками (облачные раннеры бывают медленными)."""
    log(f"[INFO] Авторизация на {LOGIN_URL}")
    for attempt in range(1, LOGIN_RETRIES + 1):
        try:
            if _login_once(driver, email, password):
                log("[OK] Авторизация успешна")
                return True
        except Exception as e:
            log(f"[WARN] Попытка авторизации {attempt}/{LOGIN_RETRIES} не удалась: {e}")
        if attempt < LOGIN_RETRIES:
            time.sleep(5 * attempt)
    log("[ERROR] Авторизация не удалась после всех попыток")
    return False


# ================= КАТАЛОГ =================

def get_product_urls(driver, category_url):
    driver.get(category_url)
    time.sleep(2)
    urls = set()
    max_page = 1

    try:
        page_links = driver.find_elements(
            By.CSS_SELECTOR,
            "a.pagination__link.js-pagination-link[data-page], .pagination a, .pager a, nav a",
        )
        for link in page_links:
            page_num_str = link.get_attribute("data-page") or link.text.strip()
            if page_num_str and page_num_str.isdigit():
                page_num = int(page_num_str)
                if page_num > max_page:
                    max_page = page_num
    except Exception:
        pass

    log(f"   [INFO] Страниц в категории: {max_page}")
    base_url = category_url.split('?')[0].rstrip('/')
    parsed = urlparse(driver.current_url)
    params = parse_qs(parsed.query)

    for page in range(1, max_page + 1):
        if page > 1:
            params['page'] = [str(page)]
            query = '&'.join([f"{k}={v[0]}" for k, v in params.items()])
            driver.get(f"{base_url}?{query}")
            time.sleep(2)

        driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        time.sleep(1)
        links = driver.find_elements(By.XPATH, "//a[contains(@href, '/catalog/product/')]")
        for link in links:
            href = link.get_attribute('href')
            if href and 'http' in href:
                clean_url = href.split('#')[0].split('?')[0].strip().rstrip('/')
                urls.add(clean_url)
        log(f"   [INFO] Страница {page}: уникальных ссылок всего {len(urls)}")

    return sorted(urls)


# ================= КАРТОЧКА ТОВАРА =================

def brand_from_name(name: str) -> str:
    """Определяет бренд по названию товара (fallback, когда JSON-LD пуст)."""
    name_upper = name.upper()
    name_lower = name.lower()
    if 'seven six' in name_lower:
        return '7/6'
    if any(typo in name_lower for typo in TECNIFIBRE_TYPOS):
        return 'Tecnifibre'
    # Линейки струн для сквоша X-ONE и 305 SQUASH — это Tecnifibre
    if re.search(r'\bx-one\b', name_lower) or re.search(r'\b305\s+squash\b', name_lower):
        return 'Tecnifibre'
    for brand in KNOWN_BRANDS:
        if brand.upper() in name_upper:
            # «Nata Sleeveless T-shirt» → Nata → 7/6 (BRAND_REMAP)
            return _normalize_brand_name(brand)
    return "Не определен"


def extract_brand(driver, name):
    """Бренд: сначала из JSON-LD страницы (точные данные сайта), затем из названия."""
    # 1) JSON-LD / микроразметка
    try:
        scripts = driver.find_elements(By.XPATH, "//script[@type='application/ld+json']")
        for script in scripts:
            raw = script.get_attribute('textContent') or ''
            raw = raw.strip()
            if not raw or 'brand' not in raw.lower():
                continue
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue
            candidates = data if isinstance(data, list) else [data]
            for item in candidates:
                if not isinstance(item, dict):
                    continue
                brand = item.get('brand')
                if isinstance(brand, dict):
                    brand = brand.get('name')
                if isinstance(brand, str) and brand.strip() and not brand.strip().isdigit():
                    return _normalize_brand_name(brand)
    except Exception:
        pass

    # 2) Из названия
    return brand_from_name(name)


def extract_price(driver):
    price = "Не указана"
    try:
        meta_elements = driver.find_elements(By.XPATH, "//meta[@itemprop='price']")
        for meta in meta_elements:
            price_value = meta.get_attribute('content')
            if price_value:
                clean = price_value.replace(' ', '').replace(',', '.').strip()
                try:
                    num = float(clean)
                    if num > 0:
                        return f"{int(num)} ₽"
                except ValueError:
                    pass
    except Exception:
        pass
    try:
        price_element = driver.find_element(By.CSS_SELECTOR, "p.card__price")
        price_text = price_element.text.strip()
        matches = re.findall(r'([\d\s.,]+)\s*(?:₽|руб|RUB)', price_text, re.IGNORECASE)
        if matches:
            clean_num = matches[0].replace(' ', '').replace('.', '').replace(',', '').strip()
            if clean_num.isdigit():
                return f"{int(clean_num)} ₽"
    except Exception:
        pass
    return price


def extract_article(driver):
    article = "Не указан"
    try:
        article_element = driver.find_element(By.CSS_SELECTOR, "p.card__code")
        raw_text = article_element.text.strip()
        article = raw_text.replace("Артикул", "").replace("Арт.", "").strip()
        if not article:
            article = "Не указан"
    except Exception:
        pass
    return article


def extract_image_url(driver):
    image_url = None
    for selector in (
        ".slideshow__picture.slick-active img[itemprop='image']",
        ".slideshow__picture img",
        "img[itemprop='image']",
    ):
        try:
            img = driver.find_element(By.CSS_SELECTOR, selector)
            if img:
                image_url = img.get_attribute('src')
                if image_url:
                    break
        except Exception:
            continue
    return image_url


def download_image(image_url):
    if not image_url:
        return ""
    try:
        clean_image_url = image_url.strip().split('?')[0]
        url_hash = hashlib.md5(clean_image_url.encode('utf-8')).hexdigest()[:12]

        ext = '.jpg'
        lower = clean_image_url.lower()
        if '.png' in lower:
            ext = '.png'
        elif '.webp' in lower:
            ext = '.webp'

        filename = f"{url_hash}{ext}"
        filepath = os.path.join(IMAGES_DIR, filename)

        # Попаданием в кэш считаем ЛЮБОЙ вариант файла с тем же хэшем URL:
        # оригинал (<hash>.png) удаляется после сжатия в WebP
        # (scripts/compress-images.mjs), и если искать только его, парсер каждую
        # ночь заново качает весь каталог фото (~1 ГБ PNG), который потом
        # уезжает в git. Порядок: сначала «родное» расширение, затем webp.
        seen_exts = set()
        for candidate_ext in (ext, '.webp', '.png', '.jpg', '.jpeg'):
            if candidate_ext in seen_exts:
                continue
            seen_exts.add(candidate_ext)
            candidate = os.path.join(IMAGES_DIR, f"{url_hash}{candidate_ext}")
            if os.path.exists(candidate) and os.path.getsize(candidate) > 500:
                return candidate

        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        response = requests.get(image_url, timeout=15, headers=headers)
        if response.status_code == 200 and len(response.content) > 500:
            with open(filepath, 'wb') as f:
                f.write(response.content)
            return filepath
        log(f"      [WARN] Фото не скачалось (HTTP {response.status_code}): {filename}")
    except Exception as e:
        log(f"      [WARN] Не удалось скачать фото: {e}")
    return ""


# ================= НАЛИЧИЕ (исправленное) =================

QTY_RE = re.compile(r'(\d+(?:[.,]\d+)?)')


def _match_store(text_lower: str):
    """Возвращает полное имя магазина, если в тексте есть его ключевое слово."""
    for store_full_name, keywords in STORES_FULL.items():
        if any(kw in text_lower for kw in keywords):
            return store_full_name
    return None


def _to_number(qty_str: str):
    value = float(qty_str.replace(',', '.'))
    return int(value) if value.is_integer() else value


def parse_stock_from_table(driver):
    """
    Читает table.admin-sizes. Поддерживает обе структуры:
      A) строка = РАЗМЕР, во второй ячейке список «Магазин - N шт» (div'ы);
      B) строка = МАГАЗИН, во второй ячейке «N банка/сет/кор/шт».
    Определение — по ключевым словам магазина в ПЕРВОЙ ячейке (раньше такие
    строки парсились как «размер» и количество терялось → «Нет информации
    о наличии» у мячей и струн).
    """
    store_totals = {store: 0 for store in STORES_FULL.keys()}
    sizes_data = []
    sizes_text_parts = []

    try:
        size_table = driver.find_element(By.CSS_SELECTOR, "table.admin-sizes")
        rows = size_table.find_elements(By.TAG_NAME, "tr")

        for row in rows:
            try:
                cells = row.find_elements(By.TAG_NAME, "td")
                if len(cells) < 2:
                    continue
                first_cell_text = cells[0].text.strip()
                if not first_cell_text:
                    continue
                second_cell = cells[1]
                second_text = second_cell.text.strip()

                # --- Структура B: первая ячейка — магазин («Уфа», «Соболева», ...) ---
                first_cell_store = _match_store(first_cell_text.lower())
                if first_cell_store:
                    qty_match = QTY_RE.search(second_text)
                    if qty_match:
                        qty = _to_number(qty_match.group(1))
                        unit_match = re.search(r'\d+(?:[.,]\d+)?\s*([а-яА-ЯёЁa-zA-Z]+)', second_text)
                        unit = unit_match.group(1).lower() if unit_match else 'шт'
                        store_totals[first_cell_store] += qty
                        sizes_data.append({
                            'Размер': 'Без размера',
                            'Магазин': first_cell_store,
                            'Количество': qty,
                        })
                        sizes_text_parts.append(f"{first_cell_text}: {qty} {unit}")
                    continue

                # --- Структура A: первая ячейка — размер, во второй магазины с количеством ---
                size = first_cell_text
                row_matched = False
                divs = second_cell.find_elements(By.TAG_NAME, "div")
                segments = [d.text.strip() for d in divs if d.text.strip()] or (
                    [second_text] if second_text else []
                )
                for segment in segments:
                    qty_match = QTY_RE.search(segment)
                    if not qty_match:
                        continue
                    store = _match_store(segment.lower())
                    if not store:
                        continue
                    qty = _to_number(qty_match.group(1))
                    store_totals[store] += qty
                    sizes_data.append({'Размер': size, 'Магазин': store, 'Количество': qty})
                    sizes_text_parts.append(f"{size}: {segment}")
                    row_matched = True
                if not row_matched and second_text:
                    # neither: запоминаем сырой текст — пригодится для отладки
                    sizes_text_parts.append(f"{size}: {second_text}")
            except Exception:
                continue
    except Exception:
        # Таблицы admin-sizes нет — товар распродан либо сайт изменил вёрстку
        pass

    details_text = ' | '.join(sizes_text_parts) if sizes_text_parts else 'Нет информации о наличии'
    return store_totals, sizes_data, details_text


def parse_cart_info(driver):
    """
    Данные для корзины saletennis.com (фича «Перенести в корзину» на сайте):
      itemId — внутренний ID товара (атрибут data-item-id кнопки «В корзину»,
               совпадает с числом в конце slug ссылки);
      sizes  — карта «текст размера → внутренний ID размера» (значения radio
               .card__sizes input[name=size]; API корзины принимает именно ID).
    Для безразмерных товаров sizes пуст — в корзину идёт size=0.
    """
    try:
        btn = driver.find_element(By.CSS_SELECTOR, "[data-item-id]")
        item_id = (btn.get_attribute("data-item-id") or "").strip()
        if not item_id:
            return None
        sizes = {}
        radios = driver.find_elements(
            By.CSS_SELECTOR, ".card__sizes input[type=radio][name=size]"
        )
        for radio in radios:
            value = (radio.get_attribute("value") or "").strip()
            radio_id = (radio.get_attribute("id") or "").strip()
            if not value or not radio_id:
                continue
            label = driver.execute_script(
                "var l = document.querySelector('label[for=\"' + arguments[0] + '\"]');"
                "return l ? l.textContent.trim() : '';",
                radio_id,
            )
            if label:
                sizes[label] = value
        return {"itemId": item_id, "sizes": sizes}
    except Exception:
        return None


def parse_product(driver, url, category):
    last_error = None
    for attempt in range(PRODUCT_RETRIES + 1):
        try:
            if attempt > 0:
                log(f"      [RETRY {attempt}] {url}")
                time.sleep(1.5 * attempt)
            # повторные попытки — со сбросом возможного кэша CDN (случайный параметр)
            target_url = url
            if attempt > 0:
                target_url = url + ('&' if '?' in url else '?') + f"_nc={int(time.time() * 1000)}"
            driver.get(target_url)
            try:
                WebDriverWait(driver, 5).until(
                    EC.presence_of_element_located((By.TAG_NAME, "h1"))
                )
            except Exception:
                time.sleep(2)

            driver.execute_script("window.scrollTo(0, document.body.scrollHeight / 2);")
            time.sleep(0.2)
            driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            time.sleep(0.2)

            name = "Не найдено"
            try:
                name = driver.find_element(By.TAG_NAME, "h1").text.strip()
            except Exception:
                pass

            brand = extract_brand(driver, name)
            article = extract_article(driver)
            price = extract_price(driver)
            store_totals, sizes_data, details_text = parse_stock_from_table(driver)
            if details_text == 'Нет информации о наличии' and attempt < PRODUCT_RETRIES:
                # Есть выбор размеров, но нет таблицы — «облегчённая» страница
                # (сбой кэша): перезапрашиваем, иначе товар получит ложные нули
                try:
                    radios = driver.find_elements(
                        By.CSS_SELECTOR, ".card__sizes input[type=radio][name=size]")
                except Exception:
                    radios = []
                if radios:
                    last_error = "есть размеры, но нет таблицы наличия (сбой кэша)"
                    log(f"      [WARN] {url}: {last_error} — повторяю")
                    continue
            image_url = extract_image_url(driver)
            image_path = download_image(image_url)
            cart_info = parse_cart_info(driver)

            total_qty = sum(store_totals.values())

            return {
                'Категория': category,
                'Артикул': article,
                'Название': name,
                'Бренд': brand,
                'Цена': price,
                'Ссылка': url,
                'Размеры и наличие': details_text,
                'Всего': total_qty,
                'Фото': image_path,
                **store_totals,
                'sizes_data': sizes_data,
                'cart_info': cart_info,
            }
        except Exception as e:
            last_error = e
    log(f"   [ERROR] Не удалось распарсить {url}: {last_error}")
    return None


# ================= ИСТОРИЯ И ИЗМЕНЕНИЯ =================

def save_history_snapshot(products_df, sizes_df):
    """Снимок каталога + снимок размеров + manifest.json (структура сайта)."""
    now = datetime.now()
    stamp = now.strftime('%Y-%m-%d_%H-%M-%S')
    iso_date = now.strftime('%Y-%m-%dT%H:%M:%S')

    history_file = os.path.join(HISTORY_DIR, f"{stamp}.csv")
    products_df.to_csv(history_file, index=False, encoding='utf-8-sig')
    log(f"[OK] Снимок истории: {history_file}")

    if sizes_df is not None and len(sizes_df) > 0:
        sizes_history_file = os.path.join(HISTORY_DIR, f"sizes-{stamp}.csv")
        sizes_df.to_csv(sizes_history_file, index=False, encoding='utf-8-sig')
        log(f"[OK] Снимок размеров: {sizes_history_file}")
    else:
        sizes_history_file = None

    # manifest.json — в формате, который читает сайт
    manifest_path = os.path.join(HISTORY_DIR, "manifest.json")
    manifest = {"snapshots": [], "sizeSnapshots": []}
    if os.path.exists(manifest_path):
        try:
            with open(manifest_path, encoding='utf-8') as f:
                loaded = json.load(f)
            if isinstance(loaded.get("snapshots"), list):
                manifest["snapshots"] = loaded["snapshots"]
            if isinstance(loaded.get("sizeSnapshots"), list):
                manifest["sizeSnapshots"] = loaded["sizeSnapshots"]
        except Exception:
            log("[WARN] manifest.json повреждён — пересоздаю")

    manifest["snapshots"] = [
        s for s in manifest["snapshots"]
        if s.get("file") != os.path.basename(history_file) and s.get("date") != iso_date
    ]
    manifest["snapshots"].append({"file": os.path.basename(history_file), "date": iso_date})
    manifest["snapshots"].sort(key=lambda s: s.get("date", ""))

    if sizes_history_file:
        fname = os.path.basename(sizes_history_file)
        manifest["sizeSnapshots"] = [
            s for s in manifest["sizeSnapshots"]
            if s.get("file") != fname and s.get("date") != iso_date
        ]
        manifest["sizeSnapshots"].append({"file": fname, "date": iso_date})
        manifest["sizeSnapshots"].sort(key=lambda s: s.get("date", ""))

    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")
    log(f"[OK] manifest.json обновлён (снимков: {len(manifest['snapshots'])})")
    return history_file


def _key_builder(old_df, new_df):
    """
    Ключ сравнения снимков. Артикул уникален у большинства товаров — по нему
    сравниваем (устойчиво к переименованиям на сайте). Артикулы, встречающиеся
    больше одного раза (варианты товара: женская/детская версия и т.п.),
    сравниваем по «Артикул+Название», иначе варианты схлопнутся и журнал
    покажет ложные «продажи» на сотни единиц.
    """
    from collections import Counter
    old_counts = Counter(str(r.get('Артикул', '')).strip() for r in old_df.to_dict('records'))
    new_counts = Counter(str(r.get('Артикул', '')).strip() for r in new_df.to_dict('records'))
    # «неоднозначный» артикул = встречается больше ОДНОГО раза внутри ОДНОГО снимка
    ambiguous = {a for a, n in old_counts.items() if n > 1 and a and a != 'Не указан'}
    ambiguous |= {a for a, n in new_counts.items() if n > 1 and a and a != 'Не указан'}

    def key(row):
        article = str(row.get('Артикул', '')).strip()
        if article and article != 'Не указан' and article not in ambiguous:
            return f'A:{article}'
        name = str(row.get('Название', '')).strip()
        link = str(row.get('Ссылка', '')).strip().rstrip('/')
        return f'AN:{article}|{name}' if name else f'L:{link}'

    return key


def analyze_changes(old_df, new_df):
    changes = []
    today = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    key_of = _key_builder(old_df, new_df)
    old_by_key = {key_of(row): row for _, row in old_df.iterrows()}
    new_by_key = {key_of(row): row for _, row in new_df.iterrows()}

    def meta(row):
        return {
            'Дата': today,
            'Артикул': row.get('Артикул', ''),
            'Название': row.get('Название', ''),
            'Категория': row.get('Категория', ''),
        }

    for key, new_row in new_by_key.items():
        new_total = int(float(new_row.get('Всего', 0) or 0))
        if key in old_by_key:
            old_row = old_by_key[key]
            old_total = int(float(old_row.get('Всего', 0) or 0))
            if old_total != new_total:
                changes.append({**meta(new_row), 'Тип изменения': 'Изменение количества',
                                'Старое значение': old_total, 'Новое значение': new_total,
                                'Разница': new_total - old_total})
            if old_total > 0 and new_total == 0:
                changes.append({**meta(new_row), 'Тип изменения': 'Товар закончился',
                                'Старое значение': old_total, 'Новое значение': 0,
                                'Разница': -old_total})
            if old_total == 0 and new_total > 0:
                changes.append({**meta(new_row), 'Тип изменения': 'Товар появился',
                                'Старое значение': 0, 'Новое значение': new_total,
                                'Разница': new_total})
        else:
            changes.append({**meta(new_row), 'Тип изменения': 'Новый товар',
                            'Старое значение': 0, 'Новое значение': new_total,
                            'Разница': new_total})

    for key, old_row in old_by_key.items():
        if key not in new_by_key:
            old_total = int(float(old_row.get('Всего', 0) or 0))
            changes.append({**meta(old_row), 'Тип изменения': 'Товар удалён с сайта',
                            'Старое значение': old_total, 'Новое значение': 0,
                            'Разница': -old_total})

    return changes


def save_changes(changes):
    if not changes:
        log("[INFO] Изменений не обнаружено")
        return
    changes_df = pd.DataFrame(changes)
    if os.path.exists(CHANGES_CSV):
        try:
            old_changes = pd.read_csv(CHANGES_CSV, encoding='utf-8-sig')
            changes_df = pd.concat([old_changes, changes_df], ignore_index=True)
            # Ограничиваем журнал последними 5000 строк, чтобы не рос вечно
            if len(changes_df) > 5000:
                changes_df = changes_df.tail(5000)
        except Exception:
            pass
    changes_df.to_csv(CHANGES_CSV, index=False, encoding='utf-8-sig')
    log(f"[OK] Сохранено {len(changes)} изменений в {CHANGES_CSV}")


def save_sizes_data(all_sizes_data):
    if not all_sizes_data:
        return None
    sizes_df = pd.DataFrame(all_sizes_data)
    # защита от двойного парсинга одного товара (пересечение категорий)
    sizes_df = sizes_df.drop_duplicates(subset=['Ссылка', 'Размер', 'Магазин'], keep='first')
    sizes_df.to_csv(SIZES_CSV, index=False, encoding='utf-8-sig')
    log(f"[OK] Сохранено {len(sizes_df)} записей о размерах в {SIZES_CSV}")
    return sizes_df


def save_discounts(discounts):
    """
    Скидки из раздела «Распродажа» (/catalog/sale/): itemId → {percent, price,
    oldPrice, name, link}. Сайт показывает их в карточке товара и в «Инвентаре»
    (бейдж −N%, зачёркнутая старая цена), а также позволяет сортировать по скидке.
    """
    if not discounts:
        log("[WARN] Скидки не собраны — discounts.json не обновлён")
        return
    payload = {
        'generatedAt': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'source': 'https://saletennis.com/catalog/sale/',
        'items': discounts,
    }
    with open(DISCOUNTS_JSON, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
    log(f"[OK] Сохранены скидки для {len(discounts)} товаров в {DISCOUNTS_JSON}")


def save_cart_map(cart_map):
    """
    Карта для корзины saletennis.com: ссылка → {itemId, sizes: {размер → id}}.
    Сайт использует её во вкладке «Перемещения» (кнопка «Перенести в корзину»).
    """
    if not cart_map:
        log("[WARN] Данные корзины не собраны — cart-map.json не обновлён")
        return
    payload = {
        'generatedAt': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'items': cart_map,
    }
    with open(CART_MAP_JSON, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    log(f"[OK] Сохранена карта корзины для {len(cart_map)} товаров в {CART_MAP_JSON}")


# ================= ГЛАВНЫЙ ЦИКЛ =================

def restart_driver(driver, email, password):
    """Перезапуск браузера и сессии при потере соединения/логина. None — если не вышло."""
    log("[WARN] Перезапускаю браузер и сессию...")
    try:
        driver.quit()
    except Exception:
        pass
    try:
        new_driver = init_driver()
        if not login(new_driver, email, password):
            return None
        return new_driver
    except Exception as e:
        log(f"[ERROR] Перезапуск не удался: {e}")
        return None


def main():
    ap = argparse.ArgumentParser(description="Парсер остатков SaleTennis для BI-сайта")
    ap.add_argument(
        "--out", default=os.environ.get("DATA_DIR", "data"),
        help="папка для данных: 'data' (по умолчанию) или 'public/data' (прямо в сайт)"
    )
    ap.add_argument(
        "--categories", default="",
        help="запустить только указанные категории через запятую (для быстрой проверки)"
    )
    args = ap.parse_args()

    configure_paths(args.out)
    email, password = load_credentials()

    categories = CATEGORIES
    if args.categories:
        wanted = {c.strip() for c in args.categories.split(',')}
        categories = {k: v for k, v in CATEGORIES.items() if k in wanted}
        if not categories:
            print(f"[ERROR] Нет таких категорий. Доступны: {', '.join(CATEGORIES)}")
            sys.exit(1)

    log("[INFO] Запуск BI-парсера SaleTennis (улучшенная версия)...")
    log(f"[INFO] Данные будут записаны в: {os.path.abspath(DATA_DIR)}")
    log("=" * 60)

    driver = init_driver()
    all_products = []
    all_sizes_data = []
    all_cart_map = {}
    fatal_error = None
    skipped_categories = []
    # Сколько товаров подряд могут не парситься, прежде чем перезапустим сессию
    MAX_CONSECUTIVE_FAILURES = 15

    try:
        if not login(driver, email, password):
            log("[WARN] Перезапускаю браузер и пробую войти ещё раз...")
            restarted = restart_driver(driver, email, password)
            if restarted is None:
                log("[ERROR] Не удалось войти. Завершение.")
                sys.exit(1)
            driver = restarted

        consecutive_failures = 0
        for cat_name, cat_url in categories.items():
            log(f"\n[INFO] Категория: {cat_name}")
            try:
                urls = get_product_urls(driver, cat_url)
            except Exception as e:
                log(f"[WARN] Список товаров не открылся ({e}) — пробую перелогиниться")
                restarted = restart_driver(driver, email, password)
                if restarted is None:
                    fatal_error = f"Потеряна сессия на категории «{cat_name}»"
                    break
                driver = restarted
                try:
                    urls = get_product_urls(driver, cat_url)
                except Exception as e2:
                    log(f"[ERROR] Категория «{cat_name}» пропущена: {e2}")
                    skipped_categories.append(cat_name)
                    continue
            if not urls:
                log(f"[WARN] В категории «{cat_name}» не найдено ни одного товара")
                skipped_categories.append(cat_name)
                continue
            log(f"   [INFO] Товаров для обработки: {len(urls)}")

            for i, url in enumerate(urls):
                if (i + 1) % 25 == 0 or i == 0:
                    log(f"   [{i + 1}/{len(urls)}] {url}")
                try:
                    product = parse_product(driver, url, cat_name)
                except Exception as e:
                    # parse_product обычно гасит ошибки сам; сюда попадают
                    # «смертельные» сбои драйвера (браузер упал / сессия истекла)
                    log(f"   [ERROR] Сбой на {url}: {e}")
                    product = None

                if product:
                    consecutive_failures = 0
                    sizes_data = product.pop('sizes_data', [])
                    cart_info = product.pop('cart_info', None)
                    if cart_info:
                        # ключ — ссылка без хвостового слэша (уникальна у варианта товара)
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
                        log(f"[WARN] {consecutive_failures} товаров подряд не распарсились — "
                            f"похоже, браузер или сессия умерли")
                        restarted = restart_driver(driver, email, password)
                        if restarted is None:
                            fatal_error = "Сессия потеряна, повторный вход не удался"
                            break
                        driver = restarted
                        consecutive_failures = 0
                time.sleep(PAGE_DELAY)
            if fatal_error:
                break
    except Exception as e:
        import traceback
        fatal_error = f"Непредвиденная ошибка: {e}"
        log(f"[ERROR] {fatal_error}")
        log(traceback.format_exc())
    finally:
        log("\n[INFO] Закрываю браузер...")
        try:
            driver.quit()
        except Exception:
            pass

    log(f"[INFO] Собрано товаров: {len(all_products)}")
    if fatal_error or skipped_categories:
        log("[ERROR] Парсинг неполный: "
            + (f"пропущены категории {skipped_categories}; " if skipped_categories else "")
            + (fatal_error or ""))
        log("[ERROR] Основные файлы НЕ обновлены — данные сайта остаются прежними, "
            "чтобы неполный снимок не испортил аналитику и журнал изменений.")
        sys.exit(1)
    if not all_products:
        log("[ERROR] Не удалось собрать данные — файлы не тронуты.")
        sys.exit(1)

    df = pd.DataFrame(all_products)

    # ВАЖНО: уникальность — по Ссылке (артикул дублируется у вариантов товара!)
    before = len(df)
    df = df.drop_duplicates(subset=['Ссылка'], keep='first')
    # на всякий случай — полные дубликаты по артикулу+названию
    df = df.drop_duplicates(subset=['Артикул', 'Название'], keep='first')
    log(f"[OK] Товаров: {len(df)} (убрано дублей ссылок: {before - len(df)})")

    df.to_csv(PRODUCTS_CSV, index=False, encoding='utf-8-sig')
    log(f"[OK] Каталог сохранён: {PRODUCTS_CSV}")

    sizes_df = None
    try:
        sizes_df = save_sizes_data(all_sizes_data)
    except Exception as e:
        log(f"[ERROR] Не удалось сохранить sizes.csv: {e}")
    try:
        save_cart_map(all_cart_map)
    except Exception as e:
        log(f"[ERROR] Не удалось сохранить cart-map.json: {e}")
    try:
        save_history_snapshot(df, sizes_df)
    except Exception as e:
        log(f"[ERROR] Не удалось сохранить снимок истории: {e}")

    # ---- Журнал изменений: сравниваем с предыдущим снимком ----
    all_snapshots = sorted(
        [f for f in os.listdir(HISTORY_DIR)
         if f.endswith('.csv') and not f.startswith('sizes-')],
        reverse=True
    )
    if len(all_snapshots) >= 2:
        previous_file = os.path.join(HISTORY_DIR, all_snapshots[1])
        log(f"\n[INFO] Сравниваю с предыдущим снимком: {previous_file}")
        try:
            old_df = pd.read_csv(previous_file, encoding='utf-8-sig')
            changes = analyze_changes(old_df, df)
            save_changes(changes)
            if changes:
                new_products = [c for c in changes if c['Тип изменения'] == 'Новый товар']
                sold_out = [c for c in changes if c['Тип изменения'] == 'Товар закончился']
                qty = [c for c in changes if c['Тип изменения'] == 'Изменение количества']
                log(f"[СВОДКА] новых: {len(new_products)} | закончилось: {len(sold_out)} | изменений количества: {len(qty)}")
        except Exception as e:
            log(f"[WARN] Не удалось сравнить снимки: {e}")
    else:
        log("[INFO] Первый снимок — журнал изменений появится со следующего запуска")

    photos = len([p for p in all_products if p.get('Фото')])
    log(f"\n[INFO] Фотографий (всего/в кэше): {photos}")
    log("=" * 60)
    log("[OK] BI-парсинг завершён!")

    if sys.stdin and sys.stdin.isatty():
        input("\nНажмите Enter для выхода...")


if __name__ == "__main__":
    main()
