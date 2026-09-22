import * as XLSX from 'xlsx';
import type { ParsedData, Store, Product, InventoryItem } from '../types';

// Маппинг названий магазинов из текста к колонкам
const STORE_NAME_MAPPING: Record<string, string> = {
  'санкт-петербург (спортивная)': 'Спб_Спортивная',
  'спб_спортивная': 'Спб_Спортивная',
  'спортивная': 'Спб_Спортивная',
  'санкт-петербург (ярослава)': 'Спб_Ярослава',
  'спб_ярослава': 'Спб_Ярослава',
  'ярослава': 'Спб_Ярослава',
  'екб_склад': 'Екб_Склад',
  'склад': 'Екб_Склад',
  'екб_соболева': 'Екб_Соболева',
  'соболева': 'Екб_Соболева',
  'уфа': 'Уфа',
  'ижевск': 'Ижевск',
  'тюмень (народная)': 'Тюмень_Народная',
  'тюмень_народная': 'Тюмень_Народная',
  'народная': 'Тюмень_Народная',
  'тюмень': 'Тюмень_Народная',
  'екб_бисертская': 'Екб_Бисертская',
  'бисертская': 'Екб_Бисертская',
  'екб_парина': 'Екб_Парина',
  'парина': 'Екб_Парина',
  'екб_елизавет': 'Екб_Елизавет',
  'елизавет': 'Екб_Елизавет',
};

// Стандартные колонки (НЕ магазины)
const STANDARD_COLUMNS = [
  'категория', 'артикул', 'название', 'бренд', 'цена', 'ссылка',
  'размеры и наличие', 'всего', 'фото'
];

function normalize(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, '_');
}

function findColumn(headers: string[], possibleNames: string[]): string | null {
  const normalizedHeaders = headers.map(normalize);
  for (const possibleName of possibleNames) {
    const normalized = normalize(possibleName);
    const index = normalizedHeaders.findIndex(h => h === normalized || h.includes(normalized));
    if (index !== -1) return headers[index];
  }
  return null;
}

// Парсинг "Размеры и наличие" - извлекает размеры (если есть)
function parseSizes(value: any): string[] {
  if (!value) return [];
  const str = String(value).trim();
  
  // Ищем числа 36-46 (размеры обуви)
  const sizes = new Set<string>();
  const sizePattern = /\b(3[6-9]|4[0-6])\b/g;
  let match;
  while ((match = sizePattern.exec(str)) !== null) {
    sizes.add(match[1]);
  }
  
  // Ищем размеры одежды XS-XXL
  const clothingPattern = /\b(XS|S|M|L|XL|XXL|2XL|3XL)\b/gi;
  while ((match = clothingPattern.exec(str)) !== null) {
    sizes.add(match[1].toUpperCase());
  }
  
  return Array.from(sizes);
}

// Парсинг "Размеры и наличие" - извлекает {магазин: количество}
function parseStoreQuantities(value: any): Map<string, number> {
  if (!value) return new Map();
  const str = String(value).trim();
  const result = new Map<string, number>();
  
  // Формат: "Санкт-Петербург (Спортивная) 1 шт | Ижевск 1 шт | ..."
  const parts = str.split('|').map(p => p.trim());
  
  for (const part of parts) {
    // Извлекаем название магазина и количество
    const match = part.match(/^(.+?)\s+(\d+)\s*шт?/i);
    if (match) {
      const storeName = match[1].trim().toLowerCase();
      const quantity = parseInt(match[2]);
      
      // Находим соответствие колонке
      const columnName = STORE_NAME_MAPPING[storeName];
      if (columnName) {
        result.set(columnName, quantity);
      }
    }
  }
  
  return result;
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
        const nameCol = findColumn(headers, ['название', 'товар', 'name', 'product']);
        const brandCol = findColumn(headers, ['бренд', 'brand', 'производитель']);
        const categoryCol = findColumn(headers, ['категория', 'category', 'тип']);
        const priceCol = findColumn(headers, ['цена', 'price', 'стоимость']);
        const articleCol = findColumn(headers, ['артикул', 'article', 'код', 'sku']);
        const sizesCol = findColumn(headers, ['размеры и наличие', 'размеры', 'sizes']);
        const totalCol = findColumn(headers, ['всего', 'total', 'итого']);
        
        if (!nameCol) {
          reject(new Error(`Не найдена колонка "Название". Доступные: ${headers.join(', ')}`));
          return;
        }
        
        // Определяем колонки магазинов
        const storeColumns = headers.filter(h => {
          const normalized = normalize(h);
          return !STANDARD_COLUMNS.map(normalize).includes(normalized);
        });
        
        console.log('Колонки магазинов:', storeColumns);
        
        if (storeColumns.length === 0) {
          reject(new Error(`Не найдены колонки магазинов`));
          return;
        }
        
        // Создаём магазины
        const stores: Store[] = storeColumns.map((colName, index) => ({
          id: `store_${index + 1}`,
          name: colName,
        }));
        
        const storesMap = new Map<string, Store>();
        stores.forEach(s => storesMap.set(s.name, s));
        
        const productsMap = new Map<string, Product>();
        const inventory: InventoryItem[] = [];
        let productIdCounter = 1;
        
        jsonData.forEach((row) => {
          const productName = String(row[nameCol] || '').trim();
          if (!productName) return;
          
          const brand = brandCol ? String(row[brandCol] || 'Неизвестно').trim() : 'Неизвестно';
          const category = categoryCol ? String(row[categoryCol] || 'Другое').trim() : 'Другое';
          const priceStr = priceCol ? String(row[priceCol] || '0').replace(/[^\d]/g, '') : '0';
          const price = parseInt(priceStr) || 0;
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
          
          // Парсим размеры из "Размеры и наличие"
          const sizes = sizesCol ? parseSizes(row[sizesCol]) : [];
          
          // Парсим количества по магазинам из текста
          const storeQuantitiesFromText = sizesCol ? parseStoreQuantities(row[sizesCol]) : new Map();
          
          // Если есть размеры — создаём записи для каждого размера
          if (sizes.length > 0) {
            // Для каждого магазина
            storeColumns.forEach(colName => {
              const store = storesMap.get(colName)!;
              const quantity = Number(row[colName]) || 0;
              
              if (quantity > 0) {
                // Распределяем количество по размерам равномерно
                const perSize = Math.floor(quantity / sizes.length);
                let remainder = quantity % sizes.length;
                
                sizes.forEach(size => {
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
              } else {
                // Нет товара — записываем нули
                sizes.forEach(size => {
                  inventory.push({
                    productId: product!.id,
                    storeId: store.id,
                    size,
                    quantity: 0,
                    lastUpdated: new Date().toISOString(),
                  });
                });
              }
            });
          } else {
            // Нет размеров (сумки, ракетки) — просто записываем количество
            storeColumns.forEach(colName => {
              const store = storesMap.get(colName)!;
              const quantity = Number(row[colName]) || 0;
              
              inventory.push({
                productId: product!.id,
                storeId: store.id,
                size: '—',
                quantity,
                lastUpdated: new Date().toISOString(),
              });
            });
          }
        });
        
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
