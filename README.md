# SaleTennis BI Analytics — Инструкция по использованию

## 📋 Что это за проект?

Это BI-дашборд для анализа наличия товаров и размеров по магазинам сети SaleTennis.
Сейчас он работает на **демо-данных** (моковые данные). Чтобы он показывал реальные данные, нужно подключить парсинг с сайта saletennis.com.

---

## 🚀 Пошаговый план действий

### ШАГ 1: Запустить проект локально (проверить что работает)

```bash
# 1. Установить Node.js (если ещё не установлен) — скачать с https://nodejs.org
#    Рекомендуется версия 18 или выше

# 2. Скачать/клонировать проект в папку

# 3. Открыть терминал в папке проекта и выполнить:
npm install          # Установить зависимости
npm run dev          # Запустить в режиме разработки
```

Откроется на `http://localhost:5173` — можно посмотреть как выглядит дашборд.

---

### ШАГ 2: Подключить реальные данные с saletennis.com

Сейчас данные генерируются случайно в файле `src/data/mockData.ts`.
Вам нужно заменить их на реальные. Есть 3 варианта:

#### Вариант А: Парсинг сайта (автоматический)

Создать скрипт, который будет забирать данные с saletennis.com:

```bash
# Установить библиотеки для парсинга
npm install axios cheerio
```

Создать файл `src/scripts/scraper.ts`:

```typescript
import axios from 'axios';
import * as cheerio from 'cheerio';

// Пример: парсинг страницы товара
async function scrapeProduct(url: string) {
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);
  
  // Здесь нужно адаптировать под реальную структуру HTML сайта
  const sizes: string[] = [];
  $('.size-option').each((_, el) => {
    sizes.push($(el).text().trim());
  });
  
  return sizes;
}
```

> ⚠️ **Важно:** Структуру CSS-селекторов нужно будет подсмотреть на реальном сайте.
> Откройте saletennis.com → правый клик → "Просмотр кода" → найдите элементы с размерами.

#### Вариант Б: API (если есть)

Если у saletennis.com есть API (или у вас есть доступ к базе данных 1С/CRM), 
лучше использовать его. Обратитесь к разработчику сайта за документацией API.

#### Вариант В: Ручной ввод через Excel/CSV

Самый простой вариант — загрузка из файла:

```bash
npm install xlsx
```

Создать файл `src/scripts/importFromExcel.ts`:

```typescript
import * as XLSX from 'xlsx';

function importInventory(filePath: string) {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet);
  // data — массив объектов с товарами
  return data;
}
```

Формат Excel-файла:
| Товар | Бренд | Размер | Магазин | Количество | Цена |
|-------|-------|--------|---------|------------|------|
| Кроссовки Nike | Nike | 42 | ТЦ Европа | 3 | 8990 |

---

### ШАГ 3: Заменить моковые данные на реальные

Откройте файл `src/data/mockData.ts` и замените:

```typescript
// БЫЛО (моковые данные):
export const products: Product[] = [
  { id: 'p1', name: 'Кроссовки Nike...', ... },
  ...
];

export const inventory: InventoryItem[] = generateInventory();

// СТАЛО (реальные данные):
export const products: Product[] = await fetchProductsFromAPI();
export const inventory: InventoryItem[] = await fetchInventoryFromAPI();
```

---

### ШАГ 4: Настроить автоматическое обновление

Чтобы данные обновлялись автоматически, добавьте таймер:

```typescript
// В App.tsx или отдельном хуке
useEffect(() => {
  const interval = setInterval(() => {
    refreshData(); // Функция загрузки данных
  }, 1000 * 60 * 60); // Каждые 1 час
  
  return () => clearInterval(interval);
}, []);
```

---

### ШАГ 5: Выложить в интернет (деплой)

#### Простой вариант — Vercel (бесплатно):
```bash
npm install -g vercel
vercel          # Следуйте инструкциям
```

#### Другой вариант — Netlify:
```bash
npm run build   # Собрать проект
# Загрузить папку dist/ на netlify.com
```

#### Или свой сервер:
```bash
npm run build
# Скопировать содержимое папки dist/ на ваш сервер
```

---

## 📁 Структура файлов проекта

```
src/
├── App.tsx                          ← Главный компонент (навигация)
├── main.tsx                         ← Точка входа
├── index.css                        ← Стили
├── data/
│   └── mockData.ts                  ← ⭐ ДАННЫЕ — заменить на реальные!
├── components/
│   ├── Dashboard.tsx                ← KPI-карточки и обзор
│   ├── InventoryTable.tsx           ← Таблица наличия товаров
│   ├── TransferRecommendations.tsx  ← Куда переместить товар
│   ├── RestockRecommendations.tsx   ← Что дозакупить
│   └── Charts.tsx                   ← Графики и диаграммы
```

---

## ❓ Частые вопросы

**Q: Как часто обновлять данные?**  
A: Рекомендуется раз в 1-4 часа. Можно настроить cron-задачу на сервере.

**Q: Можно ли добавить новые магазины?**  
A: Да, в файле `src/data/mockData.ts` в массиве `stores` добавьте новый объект.

**Q: Как добавить новые категории товаров?**  
A: Добавьте товары с новой категорией в массив `products` и обновите список категорий в компонентах.

**Q: Нужен ли бэкенд?**  
A: Для начала — нет. Но если данные будут на сервере, нужен бэкенд (Node.js/Python).

---

## 🔧 Технологии

- **React** — UI-фреймворк
- **Vite** — сборщик проекта
- **Tailwind CSS** — стили
- **Recharts** — графики
- **Lucide React** — иконки
