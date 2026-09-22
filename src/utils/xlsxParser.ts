import type { ParsedData, Store, Product, InventoryItem } from '../types';

// Динамический импорт xlsx для уменьшения размера бандла
let XLSX: any = null;
async function loadXLSX() {
  if (!XLSX) {
    XLSX = await import('xlsx');
  }
  return XLSX;
}

// Маппинг названий магазинов из текста к колонкам
const STORE_NAME_MAPPING: Record<string, string> = {
  'санкт-петербург (спортивная)': 'Спб_Спортивная',
  'спб_спортивная': 'Спб_Спортивная',
  'спортивная': 'Спб_Спортивная',
  'санкт-петербург (ярослава)': 'Спб_Ярослава',
  'санкт-петербург (ярослава гашека)': 'Спб_Ярослава',
  'спб_ярослава': 'Спб_Ярослава',
  'ярослава': 'Спб_Ярослава',
  'ярослава гашека': 'Спб_Ярослава',
  'екб_склад': 'Екб_Склад',
  'основной склад екатеринбург': 'Екб_Склад',
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
  'елизаветенское шоссе': 'Екб_Елизавет',
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

// Парсинг "Размеры и наличие" - возвращает Map<магазин, Map<размер, количество>>
function parseSizesAndStores(value: any): Map<string, Map<string, number>> {
  if (!value) return new Map();
  const str = String(value).trim();
  if (!str) return new Map();
  
  const result = new Map<string, Map<string, number>>();
  let currentSize = '';
  
  // Разбиваем по |
  const parts = str.split('|').map(p => p.trim());
  
  for (const part of parts) {
    // Проверяем есть ли размер в начале (например "L:" или "43:")
    const sizeMatch = part.match(/^([A-Z0-9,\.]+):\s*(.+)/i);
    
    if (sizeMatch) {
      // Есть размер
      currentSize = sizeMatch[1].trim();
      const rest = sizeMatch[2].trim();
      
      // Парсим магазин и количество
      const storeQtyMatch = rest.match(/^(.+?)\s*-\s*(\d+)\s*(шт|пар)?/i);
      if (storeQtyMatch) {
        const storeName = storeQtyMatch[1].trim().toLowerCase();
        const quantity = parseInt(storeQtyMatch[2]);
        const columnName = STORE_NAME_MAPPING[storeName];
        
        if (columnName) {
          if (!result.has(columnName)) {
            result.set(columnName, new Map());
          }
          const storeSizes = result.get(columnName)!;
          storeSizes.set(currentSize, (storeSizes.get(currentSize) || 0) + quantity);
        }
      }
    } else {
      // Нет размера - это продолжение предыдущего размера
      if (currentSize) {
        const storeQtyMatch = part.match(/^(.+?)\s*-\s*(\d+)\s*(шт|пар)?/i);
        if (storeQtyMatch) {
          const storeName = storeQtyMatch[1].trim().toLowerCase();
          const quantity = parseInt(storeQtyMatch[2]);
          const columnName = STORE_NAME_MAPPING[storeName];
          
          if (columnName) {
            if (!result.has(columnName)) {
              result.set(columnName, new Map());
            }
            const storeSizes = result.get(columnName)!;
            storeSizes.set(currentSize, (storeSizes.get(currentSize) || 0) + quantity);
          }
        }
      }
    }
  }
  
  return result;
}

// Парсинг CSV (быстрее чем XLSX)
function parseCSV(text: string): any[] {
  const lines = text.split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];
  
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const result: any[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const row: any = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    result.push(row);
  }
  
  return result;
}

export async function parseXLSX(file: File): Promise<ParsedData> {
  let jsonData: any[];
  
  // CSV - быстрый парсинг без библиотек
  if (file.name.toLowerCase().endsWith('.csv')) {
    const text = await file.text();
    jsonData = parseCSV(text);
  } else {
    // XLSX - нужен xlsx
    const xlsx = await loadXLSX();
    
    const data = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as ArrayBuffer);
      reader.onerror = () => reject(new Error('Ошибка чтения файла'));
      reader.readAsArrayBuffer(file);
    });
    
    const workbook = xlsx.read(new Uint8Array(data), { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    jsonData = xlsx.utils.sheet_to_json(worksheet) as any[];
  }
  
  try {
    if (jsonData.length === 0) {
      throw new Error('Файл пустой');
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
    
    if (!nameCol) {
      throw new Error(`Не найдена колонка "Название". Доступные: ${headers.join(', ')}`);
    }
    
    // Определяем колонки магазинов
    const storeColumns = headers.filter(h => {
      const normalized = normalize(h);
      return !STANDARD_COLUMNS.map(normalize).includes(normalized);
    });
    
    console.log('Колонки магазинов:', storeColumns);
    
    if (storeColumns.length === 0) {
      throw new Error(`Не найдены колонки магазинов`);
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
      
      // Парсим размеры и наличие из текста
      const sizesAndStores = sizesCol ? parseSizesAndStores(row[sizesCol]) : new Map();
      
      if (sizesAndStores.size > 0) {
        // Есть данные из текста - используем их
        // Сначала собираем все размеры
        const allSizes = new Set<string>();
        sizesAndStores.forEach((storeSizes: Map<string, number>) => {
          storeSizes.forEach((_: number, size: string) => allSizes.add(size));
        });
        
        // Для каждого магазина
        storeColumns.forEach(colName => {
          const store = storesMap.get(colName)!;
          const storeSizes = sizesAndStores.get(colName);
          
          if (storeSizes && storeSizes.size > 0) {
            // Есть данные для этого магазина
            allSizes.forEach(size => {
              const quantity = storeSizes.get(size) || 0;
              inventory.push({
                productId: product!.id,
                storeId: store.id,
                size,
                quantity,
                lastUpdated: new Date().toISOString(),
              });
            });
          } else {
            // Нет данных - записываем нули для всех размеров
            allSizes.forEach(size => {
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
        // Нет данных из текста - используем числа из колонок магазинов
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
    
    return { stores, products, inventory };
  } catch (error) {
    throw new Error(`Ошибка парсинга: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`);
  }
}
