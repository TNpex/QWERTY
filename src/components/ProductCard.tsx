import { useState } from 'react';
import { useData } from '../context/DataContext';
import { Package, TrendingUp, AlertTriangle } from 'lucide-react';

export function ProductCard({ productId }: { productId: string }) {
  const { data } = useData();
  const [imageLoaded, setImageLoaded] = useState(false);
  
  if (!data) return null;
  
  const product = data.products.find(p => p.id === productId);
  if (!product) return null;
  
  const totalStock = data.inventory
    .filter(i => i.productId === productId)
    .reduce((sum, i) => sum + i.quantity, 0);
  
  const storesWithStock = data.stores.filter(store => {
    const storeStock = data.inventory
      .filter(i => i.productId === productId && i.storeId === store.id)
      .reduce((sum, i) => sum + i.quantity, 0);
    return storeStock > 0;
  }).length;
  
  // Генерируем placeholder изображение на основе категории
  const getImageUrl = () => {
    if (product.category.toLowerCase().includes('обувь') || product.category.toLowerCase().includes('кроссовк')) {
      return 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&h=300&fit=crop';
    }
    if (product.category.toLowerCase().includes('одежд')) {
      return 'https://images.unsplash.com/photo-1556906781-9a412961c28c?w=400&h=300&fit=crop';
    }
    if (product.category.toLowerCase().includes('ракетк')) {
      return 'https://images.unsplash.com/photo-1617883861744-13b534e3b168?w=400&h=300&fit=crop';
    }
    return 'https://images.unsplash.com/photo-1554062614-6da4fa26fa3b?w=400&h=300&fit=crop';
  };
  
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-lg transition-all duration-300">
      {/* Изображение */}
      <div className="relative h-48 bg-gradient-to-br from-green-50 to-blue-50 overflow-hidden">
        {!imageLoaded && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Package className="w-12 h-12 text-gray-300 animate-pulse" />
          </div>
        )}
        <img
          src={getImageUrl()}
          alt={product.name}
          className={`w-full h-full object-cover transition-opacity duration-300 ${
            imageLoaded ? 'opacity-100' : 'opacity-0'
          }`}
          onLoad={() => setImageLoaded(true)}
          loading="lazy"
        />
        {/* Бейдж категории */}
        <div className="absolute top-3 left-3 bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full text-xs font-semibold text-gray-700">
          {product.category}
        </div>
        {/* Бейдж бренда */}
        <div className="absolute top-3 right-3 bg-green-500 text-white px-3 py-1 rounded-full text-xs font-bold">
          {product.brand}
        </div>
      </div>
      
      {/* Информация */}
      <div className="p-4">
        <h3 className="font-semibold text-gray-800 mb-2 line-clamp-2 text-sm">
          {product.name}
        </h3>
        
        {/* Цена */}
        {product.price > 0 && (
          <div className="text-2xl font-bold text-green-600 mb-3">
            {product.price.toLocaleString('ru-RU')} ₽
          </div>
        )}
        
        {/* Статистика */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600 flex items-center gap-1">
              <Package className="w-4 h-4" />
              Общий остаток:
            </span>
            <span className={`font-bold ${
              totalStock === 0 ? 'text-red-600' : totalStock < 10 ? 'text-amber-600' : 'text-green-600'
            }`}>
              {totalStock} шт.
            </span>
          </div>
          
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600 flex items-center gap-1">
              <TrendingUp className="w-4 h-4" />
              В магазинах:
            </span>
            <span className="font-semibold text-blue-600">
              {storesWithStock} / {data.stores.length}
            </span>
          </div>
          
          {totalStock === 0 && (
            <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              <AlertTriangle className="w-4 h-4" />
              <span>Нет в наличии</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
