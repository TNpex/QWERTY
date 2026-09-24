# Парсер остатков SaleTennis

Собирает каталог, остатки по 10 магазинам, фотографии и журнал изменений
с сайта saletennis.com (нужна авторизация — остатки видны только залогиненным).

## Быстрый старт (локально, Windows)

```powershell
# 1. Установить зависимости (один раз)
pip install -r parser/requirements.txt

# 2. Создать файл parser/.env со своими данными (он в .gitignore — в репозиторий НЕ попадёт):
#      SALETENNIS_EMAIL=ваша@почта.ru
#      SALETENNIS_PASSWORD=ваш_пароль
Copy-Item parser/.env.example parser/.env
notepad parser/.env

# 3а. Запуск «для себя» — данные в parser/data/ (как в вашей старой версии)
python parser/saletennis_parser.py

# 3б. Запуск «для сайта» — данные сразу в public/data/, история и manifest.json
#     обновляются автоматически, отдельный `npm run snapshot` НЕ нужен
python parser/saletennis_parser.py --out public/data
```

Полный парсинг (~2000 товаров) занимает примерно 1,5–2 часа.
Для быстрой проверки одной категории:

```powershell
python parser/saletennis_parser.py --out public/data --categories "Мячи для тенниса"
```

## Что улучшено по сравнению с исходной версией

| Проблема | Решение |
|---|---|
| Логин/пароль в коде | Только из `.env` / переменных окружения |
| `drop_duplicates(Артикул)` терял ~160 товаров-вариантов (Bidi Badu, струны, 7/6) | Дедупликация по **Ссылке** — варианты сохраняются |
| «банка / кор / сет / бобина» → «Нет информации о наличии» (46 товаров) | Строки «магазин + количество» определяются по ключевым словам магазина |
| «Не определен» у 88 брендов | Бренд читается из JSON-LD страницы (точные данные сайта), название — fallback |
| Ложные «продажи» на сотни единиц у струн | Журнал сравнивает по умному ключу: уникальный артикул → по артикулу, дублирующийся → по артикулу+названию |
| `input()` блокировал автоматизацию | Спрашивает Enter только в интерактивном режиме |
| Данные нужно было перекладывать руками | `--out public/data` + автообновление `history/manifest.json` |
| Падение страницы = потеря товара | 2 повтора с паузой, лог в `data/parse.log` |
| Опечатки брендов на самом сайте («Tecnifbre», «Tecnifiber») | Нормализуются в Tecnifibre; список брендов дополнен (Diadora, Slazenger, Oxdog, Diadem, Prince, Torres, Milo, Tennis Life); струны X-ONE / 305 SQUASH → Tecnifibre |
| Сбой в середине 3-часового прогона терял все данные | Автоперелогин после 15 подряд неудач; неполный прогон НЕ перезаписывает данные сайта (exit 1 + подробный лог); лог загружается артефактом в Actions даже при падении |
| Нет данных для корзины saletennis.com | Собирается `cart-map.json`: ID товара + внутренние ID размеров (нужны кнопке «Перенести в корзину» на сайте) |

## Автоматизация

### Вариант 1 — GitHub Actions (рекомендуется, без вашего участия)

Workflow `.github/workflows/parse.yml` запускается **каждый день в 12:00 по
Екатеринбургу** (или вручную: вкладка Actions → «Парсинг остатков SaleTennis»
→ Run workflow), парсит сайт и сам коммитит обновлённые данные в репозиторий.

Настройка (один раз):
1. GitHub → ваш репозиторий → **Settings → Secrets and variables → Actions**.
2. **New repository secret**: `SALETENNIS_EMAIL` = ваш логин.
3. **New repository secret**: `SALETENNIS_PASSWORD` = ваш пароль.
4. Готово — расписание заработает само.

⚠️ Нюанс: GitHub запускает браузер со своих серверов. Если сайт начнёт
блокировать «облачные» IP или показывать капчу — используйте вариант 2.

### Вариант 2 — Планировщик Windows (парсинг на вашем компьютере)

```powershell
# задача каждый день в 09:00 (пример)
schtasks /Create /TN "SaleTennis Parser" /SC DAILY /ST 09:00 `
  /TR "powershell -ExecutionPolicy Bypass -File C:\путь\к\QWERTY\parser\run-and-push.ps1"
```

Создайте `parser/run-and-push.ps1`:

```powershell
cd C:\путь\к\QWERTY
python parser\saletennis_parser.py --out public/data
npm run compress-images
git add public/data
git commit -m "data: парсинг остатков $(Get-Date -Format yyyy-MM-dd)"
git push
```

## Файлы на выходе

```
public/data/
├── products.csv              # каталог: артикул, название, бренд, цена, остатки по магазинам
├── sizes.csv                 # остатки в формате «товар × размер × магазин»
├── changes.csv               # журнал изменений (журнал продаж для сайта)
├── cart-map.json             # ссылка → ID товара + ID размеров (для корзины saletennis.com)
├── product_images/           # фотографии (кэш — скачивается только новое)
└── history/
    ├── <дата>_<время>.csv         # снимки каталога
    ├── sizes-<дата>_<время>.csv   # снимки размеров
    └── manifest.json              # обновляется автоматически
```
