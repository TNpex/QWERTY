import * as XLSX from 'xlsx';
import type { ParsedData, Store, Product, InventoryItem } from '../types';

// Стандартные колонки (НЕ магазины)
const STANDARD_COLUMNS = [
  'категория', 'артикул', 'название', 'бренд', 'цена', 'ссылка',
  'размеры и наличие', 'всего', 'фото', 'размер', 'количество',
  'магазин', 'store', 'наименование', 'product', 'name', 'brand',
  'category', 'price', 'url', 'image', 'size', 'quantity'
];

// Нормализация названия колонки
function normalize(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, '_');
}

// Поиск колонки по возможным названиям
function findColumn(headers: string[], possibleNames: string[]): string | null {
  const normalizedHeaders = headers.map(normalize);
  for (const possibleName of possibleNames) {
    const normalized = normalize(possibleName);
    const index = normalizedHeaders.findIndex(h => h === normalized || h.includes(normalized));
    if (index !== -1) return headers[index];
  }
  return null;
}

// Парсинг строки "Размеры и наличие" в массив {size, quantity}
function parseSizesAndAvailability(value: any): { size: string; quantity: number }[] {
  if (!value) return [];
  
  const str = String(value).trim();
  if (!str || str === '-' || str === '0') return [];
  
  const results: { size: string; quantity: number }[] = [];
  
  // Формат 1: "41: 3, 42: 5, 43: 2" или "41/3, 42/5"
  const colonSlashPattern = /(\d{2,3})\s*[:\/\-]\s*(\d+)/g;
  let match;
  while ((match = colonSlashPattern.exec(str)) !== null) {
    results.push({ size: match[1], quantity: parseInt(match[2]) || 0 });
  }
  if (results.length > 0) return results;
  
  // Формат 2: "41 (3 шт), 42 (5 шт)" или "41(3), 42(5)"
  const parenPattern = /(\d{2,3})\s*\((\d+)/g;
  while ((match = parenPattern.exec(str)) !== null) {
    results.push({ size: match[1], quantity: parseInt(match[2]) || 0 });
  }
  if (results.length > 0) return results;
  
  // Формат 3: "41 - 3, 42 - 5" или "41=3, 42=5"
  const dashPattern = /(\d{2,3})\s*[-=]\s*(\d+)/g;
  while ((match = dashPattern.exec(str)) !== null) {
    results.push({ size: match[1], quantity: parseInt(match[2]) || 0 });
  }
  if (results.length > 0) return results;
  
  // Формат 4: Просто список размеров через запятую/пробел "41, 42, 43" (количество неизвестно, ставим 1)
  const sizesOnly = str.split(/[,;\s]+/).map(s => s.trim()).filter(s => /^\d{2,3}$/.test(s));
  if (sizesOnly.length > 0) {
    return sizesOnly.map(size => ({ size, quantity: 1 }));
  }
  
  // Формат 5: Текст вида "р.41 - 3шт, р.42 - 5шт"
  const ruPattern = /р\.?\s*(\d{2,3})\s*[-–]?\s*(\d+)\s*шт?/gi;
  while ((match = ruPattern.exec(str)) !== null) {
    results.push({ size: match[1], quantity: parseInt(match[2]) || 0 });
  }
  if (results.length > 0) return results;
  
  return results;
}

// Парсинг значения из колонки магазина
function parseStoreValue(value: any): { total: number; sizes: { size: string; quantity: number }[] } {
  if (value === null || value === undefined || value === '') {
    return { total: 0, sizes: [] };
  }
  
  // Если число — это общее количество
  if (typeof value === 'number') {
    return { total: value, sizes: [] };
  }
  
  const str = String(value).trim();
  
  // Если просто число в строке
  if (/^\d+$/.test(str)) {
    return { total: parseInt(str), sizes: [] };
  }
  
  // Если есть размеры — парсим
  const sizes = parseSizesAndAvailability(str);
  if (sizes.length > 0) {
    const total = sizes.reduce((sum, s) => sum + s.quantity, 0);
    return { total, sizes };
  }
  
  // Если текст но не число — возможно "0" или "-"
  if (str === '-' || str === 'нет' || str === '0') {
    return { total: 0, sizes: [] };
  }
  
  return { total: 0, sizes: [] };
}

export function parseXLSX(file: File): Promise<ParsedData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[];
        
        if (jsonData.length === 0) {
          reject(new Error('Файл пустой'));
          return;
        }
        
        const headers = Object.keys(jsonData[0]);
        console.log('Найденные колонки:', headers);
        
        // Ищем стандартные колонки
        const nameCol = findColumn(headers, ['название', 'товар', 'name', 'product', 'наименование']);
        const brandCol = findColumn(headers, ['бренд', 'brand', 'производитель', 'марка']);
        const categoryCol = findColumn(headers, ['категория', 'category', 'тип', 'группа']);
        const priceCol = findColumn(headers, ['цена', 'price', 'стоимость']);
        const articleCol = findColumn(headers, ['артикул', 'article', 'код', 'sku']);
        const sizesCol = findColumn(headers, ['размеры и наличие', 'размеры', 'sizes']);
        const totalCol = findColumn(headers, ['всего', 'total', 'итого']);
        
        // Определяем магазины — все колонки, которые НЕ стандартные
        const storeColumns = headers.filter(h => {
          const normalized = normalize(h);
          return !STANDARD_COLUMNS.includes(normalized) && 
                 !normalized.includes('ссылка') && 
                 !normalized.includes('фото') &&
                 !normalized.includes('url') &&
                 !normalized.includes('image');
        });
        
        console.log('Колонки магазинов:', storeColumns);
        
        if (!nameCol) {
          reject(new Error(`Не найдена колонка "Название". Доступные: ${headers.join(', ')}`));
          return;
        }
        
        if (storeColumns.length === 0) {
          reject(new Error(`Не найдены колонки магазинов. Доступные: ${headers.join(', ')}`));
          return;
        }
        
        // Парсим данные
        const storesMap = new Map<string, Store>();
        const productsMap = new Map<string, Product>();
        const inventory: InventoryItem[] = [];
        
        let productIdCounter = 1;
        let storeIdCounter = 1;
        
        // Создаём магазины из колонок
        storeColumns.forEach(colName => {
          const storeId = `store_${storeIdCounter++}`;
          storesMap.set(colName, { id: storeId, name: colName });
        });
        
        jsonData.forEach((row, index) => {
          const productName = String(row[nameCol] || '').trim();
          if (!productName) return;
          
          const brand = brandCol ? String(row[brandCol] || 'Неизвестно').trim() : 'Неизвестно';
          const category = categoryCol ? String(row[categoryCol] || 'Другое').trim() : 'Другое';
          const price = priceCol ? Number(row[priceCol]) || 0 : 0;
          const article = articleCol ? String(row[articleCol] || '').trim() : '';
          
          // Создаём товар
          const productKey = `${productName}_${brand}_${article}`;
          let product = productsMap.get(productKey);
          if (!product) {
            product = {
              id: `p_${productIdCounter++}`,
              name: productName,
              brand,
              category,
              price,
              article,
            };
            productsMap.set(productKey, product);
          }
          
          // Парсим размеры из колонки "Размеры и наличие"
          let globalSizes: { size: string; quantity: number }[] = [];
          if (sizesCol && row[sizesCol]) {
            globalSizes = parseSizesAndAvailability(row[sizesCol]);
          }
          
          // Обрабатываем каждый магазин
          storeColumns.forEach(colName => {
            const store = storesMap.get(colName)!;
            const storeValue = row[colName];
            const parsed = parseStoreValue(storeValue);
            
            if (parsed.sizes.length > 0) {
              // Если в колонке магазина есть разбивка по размерам
              parsed.sizes.forEach(({ size, quantity }) => {
                inventory.push({
                  productId: product!.id,
                  storeId: store.id,
                  size,
                  quantity,
                  lastUpdated: new Date().toISOString(),
                });
              });
            } else if (globalSizes.length > 0 && parsed.total > 0) {
              // Если есть глобальные размеры и общее количество в магазине
              // Распределяем пропорционально или равномерно
              const perSize = Math.floor(parsed.total / globalSizes.length);
              let remainder = parsed.total % globalSizes.length;
              
              globalSizes.forEach(({ size }) => {
                const qty = perSize + (remainder > 0 ? 1 : 0);
                if (remainder > 0) remainder--;
                inventory.push({
                  productId: product!.id,
                  storeId: store.id,
                  size,
                  quantity: qty,
                  lastUpdated: new Date().toISOString(),
                });
              });
            } else if (globalSizes.length > 0 && parsed.total === 0) {
              // В магазине нет товара — записываем нули для всех размеров
              globalSizes.forEach(({ size }) => {
                inventory.push({
                  productId: product!.id,
                  storeId: store.id,
                  size,
                  quantity: 0,
                  lastUpdated: new Date().toISOString(),
                });
              });
            } else if (parsed.total > 0) {
              // Просто количество без размеров — записываем как "общий"
              inventory.push({
                productId: product!.id,
                storeId: store.id,
                size: '—',
                quantity: parsed.total,
                lastUpdated: new Date().toISOString(),
              });
            }
          });
        });
        
        const stores = Array.from(storesMap.values());
        const products = Array.from(productsMap.values());
        
        console.log(`✅ Загружено: ${products.length} товаров, ${stores.length} магазинов, ${inventory.length} записей`);
        console.log('Магазины:', stores.map(s => s.name));
        
        resolve({ stores, products, inventory });
      } catch (error) {
        reject(new Error(`Ошибка парсинга: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`));
      }
    };
    
    reader.onerror = () => reject(new Error('Ошибка чтения файла'));
    reader.readAsArrayBuffer(file);
  });
}
