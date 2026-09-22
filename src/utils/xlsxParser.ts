import * as XLSX from 'xlsx';
import type { ParsedData, Store, Product, InventoryItem } from '../types';

// Утилита для нормализации названий колонок
function normalizeColumnName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, '_');
}

// Поиск колонки по возможным названиям
function findColumn(headers: string[], possibleNames: string[]): string | null {
  const normalizedHeaders = headers.map(normalizeColumnName);
  for (const possibleName of possibleNames) {
    const normalized = normalizeColumnName(possibleName);
    const index = normalizedHeaders.findIndex(h => h.includes(normalized));
    if (index !== -1) return headers[index];
  }
  return null;
}

export function parseXLSX(file: File): Promise<ParsedData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Берём первый лист
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Конвертируем в JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[];
        
        if (jsonData.length === 0) {
          reject(new Error('Файл пустой'));
          return;
        }
        
        // Получаем заголовки
        const headers = Object.keys(jsonData[0]);
        
        // Ищем нужные колонки
        const productCol = findColumn(headers, ['товар', 'название', 'name', 'product', 'наименование']);
        const brandCol = findColumn(headers, ['бренд', 'brand', 'производитель', 'марка']);
        const sizeCol = findColumn(headers, ['размер', 'size', 'р-р']);
        const storeCol = findColumn(headers, ['магазин', 'store', 'точка', 'адрес']);
        const quantityCol = findColumn(headers, ['количество', 'quantity', 'остаток', 'кол-во', 'qty']);
        const priceCol = findColumn(headers, ['цена', 'price', 'стоимость']);
        const categoryCol = findColumn(headers, ['категория', 'category', 'тип', 'группа']);
        const articleCol = findColumn(headers, ['артикул', 'article', 'код', 'sku']);
        
        if (!productCol || !sizeCol || !storeCol || !quantityCol) {
          reject(new Error(
            `Не найдены обязательные колонки. Найдены: ${headers.join(', ')}\n` +
            `Нужны минимум: товар, размер, магазин, количество`
          ));
          return;
        }
        
        // Парсим данные
        const storesMap = new Map<string, Store>();
        const productsMap = new Map<string, Product>();
        const inventory: InventoryItem[] = [];
        
        let productIdCounter = 1;
        let storeIdCounter = 1;
        
        jsonData.forEach((row, index) => {
          const productName = String(row[productCol] || '').trim();
          const size = String(row[sizeCol] || '').trim();
          const storeName = String(row[storeCol] || '').trim();
          const quantity = Number(row[quantityCol]) || 0;
          const brand = brandCol ? String(row[brandCol] || 'Неизвестно').trim() : 'Неизвестно';
          const price = priceCol ? Number(row[priceCol]) || 0 : 0;
          const category = categoryCol ? String(row[categoryCol] || 'Другое').trim() : 'Другое';
          const article = articleCol ? String(row[articleCol] || '').trim() : '';
          
          if (!productName || !size || !storeName) {
            console.warn(`Строка ${index + 2}: пропущена (нет товара, размера или магазина)`);
            return;
          }
          
          // Создаём или получаем магазин
          let store = storesMap.get(storeName);
          if (!store) {
            store = { id: `store_${storeIdCounter++}`, name: storeName };
            storesMap.set(storeName, store);
          }
          
          // Создаём или получаем товар
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
          
          // Добавляем запись инвентаря
          inventory.push({
            productId: product.id,
            storeId: store.id,
            size,
            quantity,
            lastUpdated: new Date().toISOString(),
          });
        });
        
        const stores = Array.from(storesMap.values());
        const products = Array.from(productsMap.values());
        
        console.log(`Загружено: ${products.length} товаров, ${stores.length} магазинов, ${inventory.length} записей`);
        
        resolve({ stores, products, inventory });
      } catch (error) {
        reject(new Error(`Ошибка парсинга файла: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`));
      }
    };
    
    reader.onerror = () => reject(new Error('Ошибка чтения файла'));
    reader.readAsArrayBuffer(file);
  });
}
