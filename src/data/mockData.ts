// Типы данных
export interface Store {
  id: string;
  name: string;
  address: string;
}

export interface Product {
  id: string;
  name: string;
  brand: string;
  category: string;
  gender: 'male' | 'female' | 'unisex';
  price: number;
  image?: string;
}

export interface InventoryItem {
  productId: string;
  storeId: string;
  size: string;
  quantity: number;
  lastUpdated: string;
}

export interface TransferRecommendation {
  productId: string;
  productName: string;
  fromStore: string;
  toStore: string;
  size: string;
  quantity: number;
  reason: string;
  priority: 'high' | 'medium' | 'low';
}

export interface RestockRecommendation {
  productId: string;
  productName: string;
  brand: string;
  sizes: { size: string; quantity: number }[];
  totalNeeded: number;
  urgency: 'critical' | 'high' | 'medium';
  avgDailySales: number;
  daysUntilStockout: number;
}

// Магазины
export const stores: Store[] = [
  { id: 'store1', name: 'SaleTennis ТЦ "Европа"', address: 'ул. Ленина, 15' },
  { id: 'store2', name: 'SaleTennis ТЦ "Галерея"', address: 'пр. Мира, 42' },
  { id: 'store3', name: 'SaleTennis ТЦ "Мега"', address: 'ул. Спортивная, 8' },
  { id: 'store4', name: 'SaleTennis ТЦ "Арена"', address: 'бул. Победы, 101' },
];

// Размеры
export const allSizes = ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'];
export const clothingSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

// Товары
export const products: Product[] = [
  { id: 'p1', name: 'Кроссовки Nike Court Vapor', brand: 'Nike', category: 'Обувь', gender: 'unisex', price: 8990 },
  { id: 'p2', name: 'Кроссовки Adidas Barricade', brand: 'Adidas', category: 'Обувь', gender: 'unisex', price: 12490 },
  { id: 'p3', name: 'Кроссовки Asics Gel-Resolution', brand: 'Asics', category: 'Обувь', gender: 'unisex', price: 11990 },
  { id: 'p4', name: 'Ракетка Wilson Pro Staff 97', brand: 'Wilson', category: 'Ракетки', gender: 'unisex', price: 24990 },
  { id: 'p5', name: 'Ракетка Babolat Pure Aero', brand: 'Babolat', category: 'Ракетки', gender: 'unisex', price: 19990 },
  { id: 'p6', name: 'Футболка Nike Dri-FIT', brand: 'Nike', category: 'Одежда', gender: 'male', price: 3490 },
  { id: 'p7', name: 'Шорты Adidas Adizero', brand: 'Adidas', category: 'Одежда', gender: 'male', price: 2990 },
  { id: 'p8', name: 'Юбка Nike Court Flare', brand: 'Nike', category: 'Одежда', gender: 'female', price: 3990 },
  { id: 'p9', name: 'Кроссовки New Balance Fresh Foam', brand: 'New Balance', category: 'Обувь', gender: 'unisex', price: 9990 },
  { id: 'p10', name: 'Сумка Babolat Pure Aero 12', brand: 'Babolat', category: 'Сумки', gender: 'unisex', price: 8490 },
  { id: 'p11', name: 'Кроссовки Nike Zoom Vapor X', brand: 'Nike', category: 'Обувь', gender: 'unisex', price: 13990 },
  { id: 'p12', name: 'Футболка Asics Gel-Network', brand: 'Asics', category: 'Одежда', gender: 'male', price: 2790 },
];

// Генерация данных инвентаря
function generateInventory(): InventoryItem[] {
  const items: InventoryItem[] = [];
  const shoeSizes = ['39', '40', '41', '42', '43', '44', '45'];
  const clothingSizesList = ['S', 'M', 'L', 'XL'];
  
  products.forEach(product => {
    const sizes = product.category === 'Обувь' ? shoeSizes : 
                  product.category === 'Одежда' ? clothingSizesList : ['one'];
    
    stores.forEach(store => {
      sizes.forEach(size => {
        // Генерируем реалистичные данные: некоторые размеры заканчиваются
        const rand = Math.random();
        let quantity = 0;
        
        if (product.category === 'Обувь') {
          // Популярные размеры 41-43 часто заканчиваются
          if (['41', '42', '43'].includes(size)) {
            quantity = rand > 0.6 ? Math.floor(Math.random() * 3) : 0;
          } else {
            quantity = rand > 0.3 ? Math.floor(Math.random() * 5) + 1 : 0;
          }
        } else if (product.category === 'Одежда') {
          // M и L популярнее
          if (['M', 'L'].includes(size)) {
            quantity = rand > 0.5 ? Math.floor(Math.random() * 3) : 0;
          } else {
            quantity = rand > 0.3 ? Math.floor(Math.random() * 4) + 1 : 0;
          }
        } else {
          quantity = rand > 0.4 ? Math.floor(Math.random() * 3) + 1 : 0;
        }
        
        items.push({
          productId: product.id,
          storeId: store.id,
          size,
          quantity,
          lastUpdated: new Date(Date.now() - Math.random() * 86400000 * 3).toISOString(),
        });
      });
    });
  });
  
  return items;
}

export const inventory: InventoryItem[] = generateInventory();

// Генерация рекомендаций по перемещению
export function getTransferRecommendations(): TransferRecommendation[] {
  const recommendations: TransferRecommendation[] = [];
  
  products.forEach(product => {
    const sizes = product.category === 'Обувь' ? ['39', '40', '41', '42', '43', '44', '45'] :
                  product.category === 'Одежда' ? ['S', 'M', 'L', 'XL'] : ['one'];
    
    sizes.forEach(size => {
      const storeStocks = stores.map(store => {
        const item = inventory.find(i => i.productId === product.id && i.storeId === store.id && i.size === size);
        return { store, quantity: item?.quantity || 0 };
      });
      
      const totalStock = storeStocks.reduce((sum, s) => sum + s.quantity, 0);
      if (totalStock === 0) return;
      
      const avgStock = totalStock / stores.length;
      const storesWithExcess = storeStocks.filter(s => s.quantity > avgStock + 1);
      const storesWithDeficit = storeStocks.filter(s => s.quantity === 0 && totalStock > 0);
      
      storesWithExcess.forEach(from => {
        storesWithDeficit.forEach(to => {
          const transferQty = Math.min(from.quantity - Math.ceil(avgStock), 2);
          if (transferQty > 0) {
            recommendations.push({
              productId: product.id,
              productName: product.name,
              fromStore: from.store.name,
              toStore: to.store.name,
              size,
              quantity: transferQty,
              reason: `В ${to.store.name} нет размера ${size}, а в ${from.store.name} избыток`,
              priority: product.category === 'Обувь' && ['41', '42', '43'].includes(size) ? 'high' : 'medium',
            });
          }
        });
      });
    });
  });
  
  return recommendations.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  }).slice(0, 20);
}

// Генерация рекомендаций по дозакупке
export function getRestockRecommendations(): RestockRecommendation[] {
  const recommendations: RestockRecommendation[] = [];
  
  products.forEach(product => {
    const sizes = product.category === 'Обувь' ? ['39', '40', '41', '42', '43', '44', '45'] :
                  product.category === 'Одежда' ? ['S', 'M', 'L', 'XL'] : ['one'];
    
    const neededSizes: { size: string; quantity: number }[] = [];
    let totalNeeded = 0;
    
    sizes.forEach(size => {
      const totalStock = stores.reduce((sum, store) => {
        const item = inventory.find(i => i.productId === product.id && i.storeId === store.id && i.size === size);
        return sum + (item?.quantity || 0);
      }, 0);
      
      // Определяем минимальный запас на каждый магазин
      const minPerStore = product.category === 'Обувь' ? 2 : 3;
      const needed = Math.max(0, minPerStore * stores.length - totalStock);
      
      if (needed > 0) {
        neededSizes.push({ size, quantity: needed });
        totalNeeded += needed;
      }
    });
    
    if (totalNeeded > 0) {
      const avgDailySales = Math.random() * 3 + 1;
      const daysUntilStockout = totalNeeded > 0 ? Math.floor(totalNeeded / avgDailySales) : 999;
      
      recommendations.push({
        productId: product.id,
        productName: product.name,
        brand: product.brand,
        sizes: neededSizes,
        totalNeeded,
        urgency: daysUntilStockout < 5 ? 'critical' : daysUntilStockout < 14 ? 'high' : 'medium',
        avgDailySales: Math.round(avgDailySales * 10) / 10,
        daysUntilStockout,
      });
    }
  });
  
  return recommendations.sort((a, b) => {
    const urgencyOrder = { critical: 0, high: 1, medium: 2 };
    return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
  });
}

// Метрики
export function getMetrics() {
  const totalProducts = products.length;
  const totalSKUs = inventory.length;
  const totalStock = inventory.reduce((sum, i) => sum + i.quantity, 0);
  const outOfStockSizes = inventory.filter(i => i.quantity === 0).length;
  const outOfStockPercent = Math.round((outOfStockSizes / totalSKUs) * 100);
  const totalValue = inventory.reduce((sum, i) => {
    const product = products.find(p => p.id === i.productId);
    return sum + (product?.price || 0) * i.quantity;
  }, 0);
  
  const storeMetrics = stores.map(store => {
    const storeItems = inventory.filter(i => i.storeId === store.id);
    const storeStock = storeItems.reduce((sum, i) => sum + i.quantity, 0);
    const storeOOS = storeItems.filter(i => i.quantity === 0).length;
    return {
      ...store,
      totalItems: storeStock,
      outOfStock: storeOOS,
      outOfStockPercent: Math.round((storeOOS / storeItems.length) * 100),
    };
  });
  
  const categoryMetrics = ['Обувь', 'Одежда', 'Ракетки', 'Сумки'].map(category => {
    const catProducts = products.filter(p => p.category === category);
    const catItems = inventory.filter(i => catProducts.some(p => p.id === i.productId));
    const catStock = catItems.reduce((sum, i) => sum + i.quantity, 0);
    const catOOS = catItems.filter(i => i.quantity === 0).length;
    return {
      category,
      totalItems: catStock,
      outOfStock: catOOS,
      outOfStockPercent: Math.round((catOOS / catItems.length) * 100),
    };
  });
  
  return {
    totalProducts,
    totalSKUs,
    totalStock,
    outOfStockSizes,
    outOfStockPercent,
    totalValue,
    storeMetrics,
    categoryMetrics,
  };
}
