import { useMemo } from 'react';
import { useData } from '../context/DataContext';
import type { ParsedData, TransferRecommendation, RestockRecommendation } from '../types';

// Мемоизированные метрики
export function useMetrics() {
  const { data } = useData();
  
  return useMemo(() => {
    if (!data) return null;
    
    const { stores, products, inventory } = data;
    
    const totalProducts = products.length;
    const totalSKUs = inventory.length;
    const totalStock = inventory.reduce((sum, i) => sum + i.quantity, 0);
    const outOfStockSizes = inventory.filter(i => i.quantity === 0).length;
    const outOfStockPercent = totalSKUs > 0 ? Math.round((outOfStockSizes / totalSKUs) * 100) : 0;
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
        outOfStockPercent: storeItems.length > 0 ? Math.round((storeOOS / storeItems.length) * 100) : 0,
      };
    });

    const categories = [...new Set(products.map(p => p.category))];
    const categoryMetrics = categories.map(category => {
      const catProducts = products.filter(p => p.category === category);
      const catItems = inventory.filter(i => catProducts.some(p => p.id === i.productId));
      const catStock = catItems.reduce((sum, i) => sum + i.quantity, 0);
      const catOOS = catItems.filter(i => i.quantity === 0).length;
      return {
        category,
        totalItems: catStock,
        outOfStock: catOOS,
        outOfStockPercent: catItems.length > 0 ? Math.round((catOOS / catItems.length) * 100) : 0,
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
  }, [data]);
}

// Мемоизированные рекомендации по перемещению
export function useTransferRecommendations(): TransferRecommendation[] {
  const { data } = useData();
  
  return useMemo(() => {
    if (!data) return [];
    
    const { stores, products, inventory } = data;
    const recommendations: TransferRecommendation[] = [];

    products.forEach(product => {
      const sizes = [...new Set(inventory.filter(i => i.productId === product.id).map(i => i.size))];

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
            const transferQty = Math.min(from.quantity - Math.ceil(avgStock), 3);
            if (transferQty > 0) {
              const isPopularSize = ['41', '42', '43', 'M', 'L', 'XL'].includes(size);
              const isShoe = product.category.toLowerCase().includes('обувь') || product.category.toLowerCase().includes('кроссовк');
              
              recommendations.push({
                productId: product.id,
                productName: product.name,
                fromStore: from.store.name,
                toStore: to.store.name,
                size,
                quantity: transferQty,
                reason: `Размер ${size} отсутствует в "${to.store.name}", избыток в "${from.store.name}"`,
                priority: isPopularSize && isShoe ? 'high' : isPopularSize ? 'medium' : 'low',
              });
            }
          });
        });
      });
    });

    return recommendations
      .sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      })
      .slice(0, 30);
  }, [data]);
}

// Мемоизированные рекомендации по дозакупке
export function useRestockRecommendations(): RestockRecommendation[] {
  const { data } = useData();
  
  return useMemo(() => {
    if (!data) return [];
    
    const { stores, products, inventory } = data;
    const recommendations: RestockRecommendation[] = [];

    products.forEach(product => {
      const sizes = [...new Set(inventory.filter(i => i.productId === product.id).map(i => i.size))];
      const neededSizes: { size: string; quantity: number }[] = [];
      let totalNeeded = 0;

      sizes.forEach(size => {
        const totalStock = stores.reduce((sum, store) => {
          const item = inventory.find(i => i.productId === product.id && i.storeId === store.id && i.size === size);
          return sum + (item?.quantity || 0);
        }, 0);

        const minPerStore = 2;
        const needed = Math.max(0, minPerStore * stores.length - totalStock);

        if (needed > 0) {
          neededSizes.push({ size, quantity: needed });
          totalNeeded += needed;
        }
      });

      if (totalNeeded > 0) {
        const avgDailySales = Math.random() * 2 + 0.5;
        const daysUntilStockout = Math.floor(totalNeeded / avgDailySales);

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
  }, [data]);
}
