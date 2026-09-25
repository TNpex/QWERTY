import { useEffect, useRef, useState } from 'react';
import { DataProvider, useData } from './context/DataContext';
import { useMetrics } from './hooks/useAnalytics';
import { oosLevel } from './utils/analyticsCore';
import { isWarehouse } from './utils/storeGroups';
import { downloadBrandOverrides } from './utils/overrides';
import { downloadSettings, settingsCounts } from './utils/settings';
import { FileUpload } from './components/FileUpload';
import { Dashboard } from './components/Dashboard';
import { InventoryTable } from './components/InventoryTable';
import { TransferRecommendations } from './components/TransferRecommendations';
import { RestockRecommendations } from './components/RestockRecommendations';
import {
  StoreStockChart,
  CategoryChart,
  SizeDistributionChart,
  StockoutPieChart,
  StoreComparisonChart,
} from './components/Charts';
import {
  LayoutDashboard,
  Package,
  ArrowLeftRight,
  ShoppingCart,
  BarChart3,
  Store,
  Menu,
  X,
  Upload,
  Loader2,
  AlertTriangle,
  Flame,
  Database,
  ChevronDown,
  Settings,
} from 'lucide-react';
import { SalesHistory } from './components/SalesHistory';
import { FilterBar } from './components/FilterBar';
import { StoreProfiles } from './components/StoreProfiles';
import { StorePicker } from './components/StorePicker';
import { useRoute, useNavigateTab } from './utils/router';
import { useStoreScope } from './hooks/useStoreScope';
import { applyTheme, loadTheme, saveTheme, toggleTheme, type Theme } from './theme';
import { loadServicePanelOpen, saveServicePanelOpen } from './utils/uiPrefs';
import { ALL_SCOPE } from './utils/storeScope';
import type { TabId } from './types';

type Tab = TabId;

/** Подпись страницы в заголовке вкладки браузера */
const TAB_TITLES: Record<TabId, string> = {
  dashboard: '📊 Обзор',
  inventory: '🎾 Инвентарь',
  sales: '🔥 Продажи',
  transfers: '🔄 Перемещения',
  restock: '🛒 Дозакупка',
  stores: '🏬 Магазины',
  analytics: '📈 Аналитика',
};

const OOS_LEVEL_STYLES = {
  ok: { dot: 'bg-emerald-500', text: 'text-emerald-600' },
  warn: { dot: 'bg-amber-500', text: 'text-amber-600' },
  bad: { dot: 'bg-red-500', text: 'text-red-600' },
} as const;

function StoreSummary() {
  const metrics = useMetrics();
  if (!metrics) return null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">Сводка по магазинам</h3>
      <div className="space-y-3">
        {metrics.storeMetrics.map((store) => {
          const warehouse = isWarehouse(store.name);
          const styles = warehouse
            ? { dot: 'bg-blue-500', text: 'text-blue-600' }
            : OOS_LEVEL_STYLES[oosLevel(store.outOfStockPercent)];
          return (
            <div
              key={store.id}
              className={`flex items-center justify-between p-3 rounded-lg ${
                warehouse ? 'bg-blue-50 border border-blue-100' : 'bg-gray-50'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${styles.dot}`} />
                <span className={`font-medium text-sm ${warehouse ? 'text-blue-800' : 'text-gray-700'}`}>
                  {warehouse ? '📦 ' : ''}
                  {store.name}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-gray-500">Остаток: {store.totalItems} шт.</span>
                <span className={`text-xs font-medium ${styles.text}`}>
                  {store.outOfStockPercent}% нет
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[10px] text-gray-400">
        Доля «нет в наличии» считается только по позициям, которые магазин возит.
      </p>
    </div>
  );
}

function AppContent() {
  const {
    data,
    hydrated,
    clearData,
    bundledData,
    restoreBundled,
    brandOverrides,
    settings,
    importSettings,
    storeProfile,
    setStoreProfile,
    loadError,
    retryLoad,
    resetLocalSettings,
  } = useData();
  const { setScope } = useStoreScope();
  // Тёмная тема: выбор запоминается, класс ставится на <html>
  const [theme, setTheme] = useState<Theme>(loadTheme);
  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);

  // Служебная панель сайдбара (загрузка файла, настройки, сведения о данных) —
  // по умолчанию свёрнута, чтобы на телефоне не закрывать дашборд. Выбор
  // запоминается на устройстве.
  const [serviceOpen, setServiceOpen] = useState<boolean>(loadServicePanelOpen);
  useEffect(() => {
    saveServicePanelOpen(serviceOpen);
  }, [serviceOpen]);

  // Каждая вкладка — своя страница: адрес меняется, работают «Назад»/«Вперёд»
  const route = useRoute();
  const activeTab: Tab = route.tab;
  const setActiveTab = useNavigateTab();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Название раздела — в заголовок вкладки браузера
  useEffect(() => {
    document.title = `${TAB_TITLES[activeTab] ?? 'SaleTennis'} — SaleTennis BI`;
  }, [activeTab]);
  const overrideCount = Object.keys(brandOverrides).length;
  const settingsFileRef = useRef<HTMLInputElement>(null);
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);
  const counts = settingsCounts(settings);
  const settingsTotal =
    counts.sports + counts.excluded + counts.supplied + counts.hot + counts.minimums + counts.profiles;

  // Восстановление сохранённых данных из IndexedDB
  if (!hydrated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-gray-50">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        <p className="text-sm text-gray-500">Загрузка данных…</p>
      </div>
    );
  }

  // Если данные не загружены — показываем причину и экран загрузки файла
  if (!data) {
    return (
      <div>
        {loadError && (
          <div className="px-4 pt-4">
            <div className="max-w-3xl mx-auto bg-red-50 border border-red-200 rounded-xl p-5">
              <div className="text-sm font-semibold text-red-800">
                ⚠ Не удалось загрузить данные сайта
              </div>
              <div className="mt-1 text-xs text-red-700 break-words">{loadError}</div>
              <p className="mt-2 text-[11px] text-red-600 leading-relaxed">
                Обычно это сбой сети или блокировка хостинга у провайдера: попробуйте
                <b> мобильную сеть</b> (или раздачу с телефона), включите в браузере
                <b> защищённый DNS</b> (Настройки → Конфиденциальность → «Использовать защищённый
                DNS» → Cloudflare) и нажмите «Повторить». Данные сайта при этом никуда не деваются —
                они лежат в репозитории и отдаются при каждом открытии.
              </p>
              <button
                onClick={retryLoad}
                className="mt-3 px-4 py-2 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-500 transition-colors"
              >
                ↻ Повторить загрузку
              </button>
            </div>
          </div>
        )}
        <FileUpload />
      </div>
    );
  }

  const tabs = [
    { id: 'dashboard' as Tab, label: '📊 Обзор', icon: LayoutDashboard },
    { id: 'inventory' as Tab, label: '🎾 Инвентарь', icon: Package },
    { id: 'sales' as Tab, label: '🔥 Продажи', icon: Flame },
    { id: 'transfers' as Tab, label: '🔄 Перемещения', icon: ArrowLeftRight },
    { id: 'restock' as Tab, label: '🛒 Дозакупка', icon: ShoppingCart },
    { id: 'stores' as Tab, label: '🏬 Магазины', icon: Store },
    { id: 'analytics' as Tab, label: '📈 Аналитика', icon: BarChart3 },
  ];

  const isBundled = data.source !== 'upload';
  const uploadedAtText = isBundled && data.asOf
    ? `снимок от ${new Date(data.asOf).toLocaleDateString('ru-RU')}`
    : data.uploadedAt
      ? new Date(data.uploadedAt).toLocaleString('ru-RU')
      : '—';

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard onNavigate={setActiveTab} />;
      case 'inventory':
        return <InventoryTable />;
      case 'sales':
        return <SalesHistory />;
      case 'transfers':
        return <TransferRecommendations />;
      case 'restock':
        return <RestockRecommendations />;
      case 'stores':
        return <StoreProfiles />;
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
              <StoreSummary />
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
        <div
          className="fixed inset-0 bg-black/30 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 h-full w-64 bg-gradient-to-b from-green-50 to-white border-r border-green-100 z-50 transform transition-transform duration-300 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0`}
      >
        <div className="p-6">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 bg-gradient-to-br from-green-500 to-green-600 rounded-xl flex items-center justify-center shadow-lg">
              <span className="text-white text-2xl">🎾</span>
            </div>
            <div>
              <h1 className="font-bold text-gray-800 text-lg leading-tight">SaleTennis</h1>
              <p className="text-[10px] text-green-600 uppercase tracking-wider font-semibold">
                BI Analytics
              </p>
            </div>
          </div>

          {/* Профиль устройства: «Мой магазин» */}
          <div className="px-4 pb-3">
            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
              Мой магазин
            </label>
            <StorePicker
              stores={data.stores}
              value={storeProfile}
              onChange={(name) => {
                setStoreProfile(name);
                // область общая для всех вкладок и видна в адресе (?scope=…)
                setScope(name || ALL_SCOPE);
              }}
            />
          </div>

          <nav className="space-y-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    setSidebarOpen(false);
                  }}
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
        </div>

        {/* Служебная панель: загрузка файла, настройки товаров, сведения о данных.
            Свёрнута по умолчанию — на телефоне она занимала пол-сайда и закрывала
            дашборд. Кнопка «Настройки и данные» раскрывает всё то же содержимое. */}
        <div className="absolute bottom-0 left-0 right-0 border-t border-gray-100">
          {serviceOpen && (
            <div className="px-6 pt-5 pb-2 max-h-[50vh] overflow-y-auto">
              <div className="space-y-1 mb-3">
                <button
                  onClick={clearData}
                  className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-800 transition-all"
                >
                  <Upload className="w-4 h-4" />
                  Загрузить другой файл
                </button>
                {!isBundled && bundledData && (
                  <button
                    onClick={restoreBundled}
                    className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-800 transition-all"
                  >
                    <Database className="w-4 h-4" />
                    Вернуться к данным сайта
                  </button>
                )}
              </div>

              {settingsTotal > 0 && (
                <button
                  onClick={() => downloadSettings(settings)}
                  className="w-full mb-2 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 transition-colors"
                  title={`Ориентации: ${counts.sports}, перемещение «Не требуется»: ${counts.excluded}, «Поставляется»: ${counts.supplied}, ходовые вручную: ${counts.hot}, минимумы товаров: ${counts.minimums}, профили магазинов: ${counts.profiles} (в т.ч. 🚫 запретов: ${counts.bans}). Скачайте JSON, чтобы перенести настройки на другой компьютер, передать коллегам или зафиксировать в public/data/product-settings.json для всех.`}
                >
                  <Upload className="w-3.5 h-3.5" />
                  Настройки товаров: {settingsTotal} — скачать JSON
                </button>
              )}
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      'Сбросить ЛОКАЛЬНЫЕ настройки этого устройства и вернуться к общим настройкам сайта (public/data/product-settings.json)?\n\n' +
                        'Будут убраны ваши правки: ориентации товаров, «Поставляется», ходовые, исключения, минимумы и профили магазинов, заданные в этом браузере.\n' +
                        'Общие настройки и данные остатков не пострадают.'
                    )
                  ) {
                    resetLocalSettings();
                    setSettingsMsg('✓ Локальные правки сброшены — действуют общие настройки сайта');
                    window.setTimeout(() => setSettingsMsg(null), 5000);
                  }
                }}
                className="w-full mb-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-white text-gray-400 border border-gray-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
                title="Убрать локальные правки этого браузера и снова использовать только общие настройки сайта (нужно, если вы экспериментировали и локальные значения перекрывают общие)"
              >
                ↺ Сбросить локальные настройки
              </button>
              <button
                onClick={() => settingsFileRef.current?.click()}
                className="w-full mb-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-white text-gray-500 border border-gray-200 hover:bg-gray-50 transition-colors"
                title="Загрузить product-settings.json (ориентации Падел/Теннис и исключения-услуги) — например, полученный от админа"
              >
                <Database className="w-3.5 h-3.5" />
                Загрузить настройки товаров
              </button>
              <input
                ref={settingsFileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  const text = await file.text();
                  setSettingsMsg(importSettings(text) ? '✓ Настройки загружены' : '⚠ Файл не похож на настройки');
                  window.setTimeout(() => setSettingsMsg(null), 4000);
                }}
              />
              {settingsMsg && (
                <div className="mb-2 text-center text-[11px] text-gray-500">{settingsMsg}</div>
              )}
              {overrideCount > 0 && (
                <button
                  onClick={() => downloadBrandOverrides(brandOverrides)}
                  className="w-full mb-3 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors"
                  title="Скачать brand-edits.json и записать правки в CSV: npm run apply-edits -- brand-edits.json"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Правки брендов: {overrideCount} — скачать JSON
                </button>
              )}
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-4">
                <div className="text-xs font-medium text-blue-800 mb-1">
                  {isBundled ? 'Встроенные данные' : 'Загруженный файл'}
                </div>
                <div className="text-[10px] text-blue-600">{uploadedAtText}</div>
                <div className="mt-2 text-[10px] text-blue-500">
                  {data.stores.length} магазинов • {data.products.length} товаров
                </div>
              </div>
            </div>
          )}

          <div className="p-3">
            <button
              onClick={() => setServiceOpen((o) => !o)}
              aria-expanded={serviceOpen}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
              title="Показать/скрыть загрузку файла, настройки товаров и сведения о данных"
            >
              <span className="flex items-center gap-2">
                <Settings className="w-3.5 h-3.5" />
                Настройки и данные
              </span>
              <ChevronDown
                className={`w-4 h-4 transition-transform ${serviceOpen ? 'rotate-180' : ''}`}
              />
            </button>
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
                aria-label="Открыть меню"
              >
                {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
              <div>
                <h2 className="text-xl font-bold text-gray-800">
                  {tabs.find((t) => t.id === activeTab)?.label}
                </h2>
                <p className="text-xs text-gray-500">
                  {activeTab === 'dashboard' && 'Сводка по сети или по выбранному магазину'}
                  {activeTab === 'inventory' && 'Детальная таблица наличия товаров и размеров'}
                  {activeTab === 'sales' && 'Продажи, перемещения и распроданные товары по снимкам'}
                  {activeTab === 'transfers' && 'Рекомендации по перемещению между магазинами'}
                  {activeTab === 'restock' && 'Что нужно дозакупить у поставщика'}
                  {activeTab === 'stores' && 'Профили точек: вид спорта, категории, перемещения, запреты товаров'}
                  {activeTab === 'analytics' && 'Графики и аналитические отчёты'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setTheme((current) => toggleTheme(current))}
                className="p-2 rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
                title={
                  theme === 'dark'
                    ? 'Включить светлую тему (выбор запоминается в браузере)'
                    : 'Включить тёмную тему (выбор запоминается в браузере)'
                }
                aria-label="Переключить тему"
              >
                <span className="text-base leading-none">{theme === 'dark' ? '☀️' : '🌙'}</span>
              </button>
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-full">
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                <span className="text-xs font-medium text-emerald-700">Данные загружены</span>
              </div>
            </div>
          </div>
          {/* Предупреждения парсера */}
          {data.warnings && data.warnings.length > 0 && (
            <div className="px-4 lg:px-8 pb-3">
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-amber-800">
                  {data.warnings.map((warning, i) => (
                    <div key={i}>{warning}</div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </header>

        {/* Page Content */}
        <div className="p-4 lg:p-8 space-y-4">
          <FilterBar />
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
