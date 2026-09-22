import { useState } from 'react';
import { Search, Filter, ChevronDown, ChevronUp } from 'lucide-react';
import { useData } from '../context/DataContext';

export function InventoryTable() {
  const { data } = useData();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedStore, setSelectedStore] = useState<string>('all');
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);

  if (!data) return null;

  const { stores, products, inventory } = data;
  const categories = ['all', ...new Set(products.map(p => p.category))];
  
  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         p.brand.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || p.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const getStockForProduct = (productId: string, storeId: string, size: string) => {
    const item = inventory.find(i => i.productId === productId && i.storeId === storeId && i.size === size);
    return item?.quantity || 0;
  };

  const getTotalStockForProduct = (productId: string) => {
    return inventory.filter(i => i.productId === productId).reduce((sum, i) => sum + i.quantity, 0);
  };

  const getStockColor = (qty: number) => {
    if (qty === 0) return 'bg-red-100 text-red-700 font-bold';
    if (qty <= 2) return 'bg-amber-100 text-amber-700 font-semibold';
    return 'bg-emerald-100 text-emerald-700';
  };

  const displayStores = selectedStore === 'all' ? stores : stores.filter(s => s.id === selectedStore);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input
            type="text"
            placeholder="Поиск по названию или бренду..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
          />
        </div>
        <div className="flex gap-3">
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="pl-10 pr-8 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm appearance-none bg-white cursor-pointer"
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat === 'all' ? 'Все категории' : cat}</option>
              ))}
            </select>
          </div>
          <select
            value={selectedStore}
            onChange={(e) => setSelectedStore(e.target.value)}
            className="px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm appearance-none bg-white cursor-pointer"
          >
            <option value="all">Все магазины</option>
            {stores.map(store => (
              <option key={store.id} value={store.id}>{store.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        {/* Table Header */}
        <div className="grid gap-2 px-4 py-2 bg-gray-50 rounded-lg text-xs font-semibold text-gray-600 uppercase tracking-wide"
             style={{ gridTemplateColumns: `2fr 0.8fr 0.8fr ${displayStores.length}fr` }}>
          <div>Товар</div>
          <div>Бренд</div>
          <div className="text-center">Общий остаток</div>
          <div className="text-center">По магазинам</div>
        </div>

        {/* Product Rows */}
        {filteredProducts.map(product => {
          const sizes = [...new Set(inventory.filter(i => i.productId === product.id).map(i => i.size))].sort();
          const isExpanded = expandedProduct === product.id;
          const totalStock = getTotalStockForProduct(product.id);
          
          return (
            <div key={product.id} className="border border-gray-100 rounded-lg overflow-hidden hover:border-blue-200 transition-colors">
              {/* Main Row */}
              <div 
                className="grid gap-2 px-4 py-3 items-center cursor-pointer hover:bg-blue-50/30 transition-colors"
                style={{ gridTemplateColumns: `2fr 0.8fr 0.8fr ${displayStores.length}fr` }}
                onClick={() => setExpandedProduct(isExpanded ? null : product.id)}
              >
                <div className="flex items-center gap-2">
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  <div>
                    <div className="font-medium text-gray-800 text-sm">{product.name}</div>
                    <div className="text-xs text-gray-500">{product.category}</div>
                  </div>
                </div>
                <div className="text-sm text-gray-600">{product.brand}</div>
                <div className="text-center">
                  <span className={`inline-flex items-center justify-center min-w-[2rem] h-7 px-2 rounded-full text-xs ${
                    totalStock === 0 ? 'bg-red-100 text-red-700' : totalStock < 10 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                  }`}>
                    {totalStock} шт.
                  </span>
                </div>
                <div className="flex gap-2 justify-center">
                  {displayStores.map(store => {
                    const storeStock = inventory
                      .filter(i => i.productId === product.id && i.storeId === store.id)
                      .reduce((sum, i) => sum + i.quantity, 0);
                    return (
                      <div key={store.id} className="text-center">
                        <div className={`inline-flex items-center justify-center min-w-[2rem] h-7 px-2 rounded text-xs font-medium ${
                          storeStock === 0 ? 'bg-red-100 text-red-700' : storeStock < 5 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                        }`}>
                          {storeStock}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Expanded Detail */}
              {isExpanded && (
                <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-3">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr>
                          <th className="text-left py-2 px-2 text-gray-500 font-medium">Размер</th>
                          {displayStores.map(store => (
                            <th key={store.id} className="text-center py-2 px-2 text-gray-500 font-medium">
                              {store.name}
                            </th>
                          ))}
                          <th className="text-center py-2 px-2 text-gray-500 font-medium">Итого</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sizes.map(size => (
                          <tr key={size} className="border-t border-gray-100">
                            <td className="py-2 px-2 font-medium text-gray-700">{size}</td>
                            {displayStores.map(store => {
                              const qty = getStockForProduct(product.id, store.id, size);
                              return (
                                <td key={store.id} className="text-center py-2 px-2">
                                  <span className={`inline-flex items-center justify-center w-8 h-6 rounded text-xs ${getStockColor(qty)}`}>
                                    {qty}
                                  </span>
                                </td>
                              );
                            })}
                            <td className="text-center py-2 px-2 font-semibold text-gray-700">
                              {inventory
                                .filter(i => i.productId === product.id && i.size === size)
                                .reduce((sum, i) => sum + i.quantity, 0)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-2 text-xs text-gray-500">
                    {product.price > 0 && <>Цена: {product.price.toLocaleString()} ₽ | </>}
                    Обновлено: {new Date().toLocaleDateString('ru-RU')}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-6 flex items-center gap-6 text-xs text-gray-500 border-t border-gray-100 pt-4">
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-5 rounded bg-emerald-100 border border-emerald-200 flex items-center justify-center text-[10px] text-emerald-700 font-bold">5</span>
          В наличии (3+)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-5 rounded bg-amber-100 border border-amber-200 flex items-center justify-center text-[10px] text-amber-700 font-bold">2</span>
          Мало (1-2)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-5 rounded bg-red-100 border border-red-200 flex items-center justify-center text-[10px] text-red-700 font-bold">0</span>
          Нет в наличии
        </span>
      </div>
    </div>
  );
}
