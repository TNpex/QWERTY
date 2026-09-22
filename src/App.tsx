import { useState } from 'react';
import { DataProvider, useData } from './context/DataContext';
import { FileUpload } from './components/FileUpload';
import { Dashboard } from './components/Dashboard';
import { InventoryTable } from './components/InventoryTable';
import { TransferRecommendations } from './components/TransferRecommendations';
import { RestockRecommendations } from './components/RestockRecommendations';
import { StoreStockChart, CategoryChart, SizeDistributionChart, StockoutPieChart, StoreComparisonChart } from './components/Charts';
import { LayoutDashboard, Package, ArrowLeftRight, ShoppingCart, BarChart3, Menu, X, Upload } from 'lucide-react';

type Tab = 'dashboard' | 'inventory' | 'transfers' | 'restock' | 'analytics';

function AppContent() {
  const { data, clearData } = useData();
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Если данные не загружены — показываем экран загрузки
  if (!data) {
    return <FileUpload />;
  }

  const tabs = [
    { id: 'dashboard' as Tab, label: 'Обзор', icon: LayoutDashboard },
    { id: 'inventory' as Tab, label: 'Инвентарь', icon: Package },
    { id: 'transfers' as Tab, label: 'Перемещения', icon: ArrowLeftRight },
    { id: 'restock' as Tab, label: 'Дозакупка', icon: ShoppingCart },
    { id: 'analytics' as Tab, label: 'Аналитика', icon: BarChart3 },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <div className="space-y-6">
            <Dashboard />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <StoreStockChart />
              <CategoryChart />
            </div>
          </div>
        );
      case 'inventory':
        return <InventoryTable />;
      case 'transfers':
        return <TransferRecommendations />;
      case 'restock':
        return <RestockRecommendations />;
      case 'analytics':
        return (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <StoreStockChart />
              <CategoryChart />
              <SizeDistributionChart />
              <StockoutPieChart />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <StoreComparisonChart />
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">Сводка по магазинам</h3>
                <div className="space-y-3">
                  {data.stores.map((store, i) => {
                    const storeStock = data.inventory
                      .filter(i => i.storeId === store.id)
                      .reduce((sum, i) => sum + i.quantity, 0);
                    const storeOOS = data.inventory
                      .filter(i => i.storeId === store.id && i.quantity === 0).length;
                    const storeTotal = data.inventory.filter(i => i.storeId === store.id).length;
                    const oosPercent = storeTotal > 0 ? Math.round((storeOOS / storeTotal) * 100) : 0;
                    
                    return (
                      <div key={store.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className={`w-3 h-3 rounded-full ${oosPercent > 25 ? 'bg-red-500' : oosPercent > 15 ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                          <span className="font-medium text-sm text-gray-700">{store.name}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-xs text-gray-500">Остаток: {storeStock} шт.</span>
                          <span className={`text-xs font-medium ${oosPercent > 25 ? 'text-red-600' : oosPercent > 15 ? 'text-amber-600' : 'text-emerald-600'}`}>
                            {oosPercent}% нет
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50/80">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/30 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed top-0 left-0 h-full w-64 bg-white border-r border-gray-200 z-50 transform transition-transform duration-300 ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      } lg:translate-x-0`}>
        <div className="p-6">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center">
              <span className="text-white font-bold text-lg">S</span>
            </div>
            <div>
              <h1 className="font-bold text-gray-800 text-lg leading-tight">SaleTennis</h1>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider">BI Analytics</p>
            </div>
          </div>

          <nav className="space-y-1">
            {tabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => { setActiveTab(tab.id); setSidebarOpen(false); }}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    activeTab === tab.id
                      ? 'bg-blue-50 text-blue-700 shadow-sm'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>

          {/* Reload Data Button */}
          <div className="mt-6 pt-6 border-t border-gray-100">
            <button
              onClick={clearData}
              className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-800 transition-all"
            >
              <Upload className="w-4 h-4" />
              Загрузить другой файл
            </button>
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 p-6 border-t border-gray-100">
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-4">
            <div className="text-xs font-medium text-blue-800 mb-1">Данные загружены</div>
            <div className="text-[10px] text-blue-600">{new Date().toLocaleString('ru-RU')}</div>
            <div className="mt-2 text-[10px] text-blue-500">
              {data.stores.length} магазинов • {data.products.length} товаров
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="lg:ml-64 min-h-screen">
        {/* Top Bar */}
        <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
          <div className="flex items-center justify-between px-4 lg:px-8 py-4">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="lg:hidden p-2 rounded-lg hover:bg-gray-100"
              >
                {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
              <div>
                <h2 className="text-xl font-bold text-gray-800">
                  {tabs.find(t => t.id === activeTab)?.label}
                </h2>
                <p className="text-xs text-gray-500">
                  {activeTab === 'dashboard' && 'Общая сводка по всем магазинам'}
                  {activeTab === 'inventory' && 'Детальная таблица наличия товаров и размеров'}
                  {activeTab === 'transfers' && 'Рекомендации по перемещению между магазинами'}
                  {activeTab === 'restock' && 'Что нужно дозакупить у поставщика'}
                  {activeTab === 'analytics' && 'Графики и аналитические отчёты'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-full">
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                <span className="text-xs font-medium text-emerald-700">Данные загружены</span>
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="p-4 lg:p-8">
          {renderContent()}
        </div>
      </main>
    </div>
  );
}

function App() {
  return (
    <DataProvider>
      <AppContent />
    </DataProvider>
  );
}

export default App;
