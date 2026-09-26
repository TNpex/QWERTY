import { useMemo, useState } from 'react';
import { Download, Search, Store as StoreIcon, Trash2, X } from 'lucide-react';
import { useData } from '../context/DataContext';
import { productSettingsKey } from '../utils/sport';
import {downloadStoreProfile, isProfileEmpty, profileOf, STORE_SPORT_LABELS, type StoreSport, storeSellsProduct} from '../utils/storeRules';
import { isWarehouse, shortStoreLabel } from '../utils/storeGroups';
import { ProductCardModal } from './ProductCardModal';
import { useProductRoute } from '../utils/router';

/**
 * 🏬 Магазины — профили точек продаж.
 *
 * Профиль магазина влияет на:
 * - «Перемещения»: ⛔ товары вне ассортимента точки и 🚫 запрещённые товары
 *   ей не предлагаются, 📴 выключенные перемещения убирают точку из доноров
 *   и получателей, ⭐ минимум по умолчанию поднимает нехватку первой;
 * - «Дозакупку»: норматив ходового товара «минимум в каждом магазине»
 *   считается только по «своим» точкам;
 * - «Обзор»: позиции вне ассортимента точки не попадают в её знаменатель.
 *
 * «Профиль магазина (JSON)» выгружает профиль отдельным файлом формата,
 * совместимого с общим product-settings.json — заготовка под личные кабинеты
 * магазинов: точка правит свой файл (или раздел общего файла) сама.
 */

const SPORT_OPTIONS: StoreSport[] = ['all', 'tennis', 'padel', 'other'];
const MAX_SEARCH_RESULTS = 25;

export function StoreProfiles() {
  const { data, settings, storeProfile, setStoreProfile, updateStoreProfile, setProductBanned } =
    useData();
  const [selected, setSelected] = useState<string>(storeProfile || '');
  const [query, setQuery] = useState('');
  const [bansOpen, setBansOpen] = useState(false);
  // Карточка товара — часть адреса (?product=<id>), кнопка «Назад» её закрывает
  const { productId: openProduct, openProduct: openCard, closeProduct: closeCard } =
    useProductRoute('stores');
  const [savedFile, setSavedFile] = useState<string | null>(null);

  const products = useMemo(() => data?.products ?? [], [data]);

  /**
   * Ассортимент точки: сколько артикулов она РЕАЛЬНО продаёт из всех —
   * с учётом профиля (вид спорта, ⛔ скрытые категории с исключениями,
   * 🚫 индивидуальные запреты), а не только «возит по данным».
   */
  const assortment = useMemo(() => {
    const carried = new Map<string, Set<string>>();
    if (!data) return carried;
    const productById = new Map(data.products.map((p) => [p.id, p]));
    const storeNameById = new Map(data.stores.map((st) => [st.id, st.name]));
    for (const item of data.inventory) {
      if (item.notCarried) continue;
      const storeName = storeNameById.get(item.storeId);
      const product = productById.get(item.productId);
      if (!storeName || !product) continue;
      if (!storeSellsProduct(settings, storeName, product)) continue;
      let set = carried.get(item.storeId);
      if (!set) {
        set = new Set();
        carried.set(item.storeId, set);
      }
      set.add(item.productId);
    }
    return carried;
  }, [data, settings]);

  /** Запреты: ключ товара → товар (для человекочитаемого списка) */
  const productByKey = useMemo(() => {
    const map = new Map<string, (typeof products)[number]>();
    for (const product of products) {
      const key = productSettingsKey(product);
      if (!map.has(key)) map.set(key, product);
    }
    return map;
  }, [products]);

  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category))].sort((a, b) => a.localeCompare(b, 'ru')),
    [products]
  );

  const storeName = selected || data?.stores[0]?.name || '';
  const profile = useMemo(() => profileOf(settings, storeName), [settings, storeName]);

  /** Подтипы товаров по категориям — для исключений из скрытых категорий */
  const subtypesByCategory = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const product of products) {
      if (!product.subtype) continue;
      const list = map.get(product.category) ?? [];
      if (!list.includes(product.subtype)) list.push(product.subtype);
      map.set(product.category, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.localeCompare(b, 'ru'));
    return map;
  }, [products]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.article ?? '').toLowerCase().includes(q) ||
          p.brand.toLowerCase().includes(q)
      )
      .slice(0, MAX_SEARCH_RESULTS);
  }, [products, query]);

  if (!data) return null;

  const bannedKeys = Object.keys(profile.bannedProducts);
  const totalProducts = products.length;

  const toggleCategory = (category: string) => {
    const hidden = profile.hiddenCategories.includes(category)
      ? profile.hiddenCategories.filter((c) => c !== category)
      : [...profile.hiddenCategories, category];
    updateStoreProfile(storeName, { hiddenCategories: hidden });
  };

  /** Исключение подтипа из скрытой категории («все аксессуары, кроме носков») */
  const toggleException = (category: string, subtype: string) => {
    const current = profile.categoryExceptions[category] ?? [];
    const next = current.includes(subtype)
      ? current.filter((s) => s !== subtype)
      : [...current, subtype];
    const categoryExceptions = { ...profile.categoryExceptions, [category]: next };
    if (next.length === 0) delete categoryExceptions[category];
    updateStoreProfile(storeName, { categoryExceptions });
  };

  const exportProfile = () => {
    const fileName = downloadStoreProfile(settings, storeName);
    setSavedFile(fileName);
    window.setTimeout(() => setSavedFile(null), 6000);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
          <StoreIcon className="w-5 h-5 text-indigo-600" />
          Профили магазинов
        </h3>
        <p className="text-sm text-gray-500 mt-0.5">
          Вид спорта точки, скрытые категории, перемещения, минимум на позицию и индивидуальные
          запреты товаров. Профиль влияет на «Перемещения», норматив ходовых товаров в «Дозакупке»
          и на «Обзор» по магазину.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 items-start">
        {/* Список магазинов */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 space-y-1.5">
          {data.stores.map((store) => {
            const p = profileOf(settings, store.name);
            const carried = assortment.get(store.id)?.size ?? 0;
            const active = !isProfileEmpty(p);
            const isSelected = store.name === storeName;
            return (
              <button
                key={store.id}
                onClick={() => {
                  setSelected(store.name);
                  setQuery('');
                }}
                className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
                  isSelected
                    ? 'border-indigo-300 bg-indigo-50'
                    : 'border-gray-100 bg-white hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-medium text-gray-800 truncate">
                    {isWarehouse(store.name) ? '📦 ' : ''}
                    {store.name}
                  </span>
                  {store.name === storeProfile && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700"
                      title="Это «Мой магазин» из сайдбара"
                    >
                      📍 мой
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-1.5 flex-wrap text-[10px]">
                  <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                    ассортимент: {carried} из {totalProducts} артикулов
                  </span>
                  {p.sport !== 'all' && (
                    <span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">
                      {STORE_SPORT_LABELS[p.sport]}
                    </span>
                  )}
                  {p.hiddenCategories.length > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                      ⛔ {p.hiddenCategories.length} кат.
                    </span>
                  )}
                  {Object.keys(p.bannedProducts).length > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                      🚫 {Object.keys(p.bannedProducts).length}
                    </span>
                  )}
                  {p.transfersDisabled && (
                    <span className="px-1.5 py-0.5 rounded bg-gray-700 text-white">
                      📴 перемещения выключены
                    </span>
                  )}
                  {p.defaultMinimum > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                      ⭐ от {p.defaultMinimum} шт.
                    </span>
                  )}
                  {!active && <span className="px-1.5 py-0.5 rounded bg-gray-50 text-gray-400">без правил</span>}
                </div>
              </button>
            );
          })}
        </div>

        {/* Профиль магазина */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h4 className="text-base font-bold text-gray-800">
                {isWarehouse(storeName) ? '📦 ' : ''}
                {storeName}
              </h4>
              <p className="text-xs text-gray-500 mt-0.5">
                {shortStoreLabel(storeName)} · ассортимент: {assortment.get(
                  data.stores.find((s) => s.name === storeName)?.id ?? ''
                )?.size ?? 0}{' '}
                из {totalProducts} артикулов
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={exportProfile}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 transition-colors"
                title="Скачать профиль отдельным JSON-файлом формата product-settings.json — его можно импортировать обратно или положить в public/data/, чтобы профиль стал общим для сайта"
              >
                <Download className="w-3.5 h-3.5" />
                Профиль магазина (JSON)
              </button>
              {storeName !== storeProfile && (
                <button
                  onClick={() => {
                    setStoreProfile(storeName);
                    setSelected(storeName);
                  }}
                  className="px-3 py-2 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors"
                  title="Сделать этот магазин «Моим» — «Перемещения» и «Обзор» переключатся на него"
                >
                  📍 Сделать моим магазином
                </button>
              )}
            </div>
          </div>
          {savedFile && (
            <p className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              ✓ Профиль выгружен: <b>{savedFile}</b>. Формат совместим с общим
              product-settings.json — файл можно импортировать в сайдбаре («Загрузить настройки
              товаров») или положить в <code>public/data/product-settings.json</code>, чтобы
              профиль стал общим для сайта, а не только для вашего браузера.
            </p>
          )}

          {/* Вид спорта */}
          <section>
            <div className="text-xs font-semibold text-gray-600 mb-2">Вид спорта</div>
            <div className="flex gap-1.5 flex-wrap">
              {SPORT_OPTIONS.map((sport) => (
                <button
                  key={sport}
                  onClick={() => updateStoreProfile(storeName, { sport })}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                    profile.sport === sport
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-indigo-50'
                  }`}
                >
                  {STORE_SPORT_LABELS[sport]}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5">
              Например, точка «только падел» — теннисные товары в её перемещения не попадают и не
              учитываются в нормативе дозакупки. Универсальные товары («Теннис/Падел», прочее)
              подходят любой точке.
            </p>
          </section>

          {/* Категории */}
          <section>
            <div className="text-xs font-semibold text-gray-600 mb-2">
              Категории{' '}
              {profile.hiddenCategories.length > 0 && (
                <span className="font-normal text-gray-400">
                  — скрыто {profile.hiddenCategories.length}
                </span>
              )}
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {categories.map((category) => {
                const hidden = profile.hiddenCategories.includes(category);
                return (
                  <button
                    key={category}
                    onClick={() => toggleCategory(category)}
                    className={`px-2.5 py-1 rounded-full border text-[11px] transition-colors ${
                      hidden
                        ? 'bg-gray-700 text-white border-gray-700 line-through'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                    }`}
                    title={hidden ? 'Категория скрыта — вернуть в ассортимент' : 'Скрыть категорию в этом магазине'}
                  >
                    {hidden ? '⛔ ' : ''}
                    {category}
                  </button>
                );
              })}
            </div>
            {profile.hiddenCategories.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {profile.hiddenCategories.map((category) => {
                  const subtypes = subtypesByCategory.get(category) ?? [];
                  if (subtypes.length === 0) return null;
                  const exceptions = profile.categoryExceptions[category] ?? [];
                  return (
                    <div key={category} className="flex items-center gap-1.5 flex-wrap text-[11px]">
                      <span className="text-gray-400">⛔ {category} — но продавать:</span>
                      {subtypes.map((subtype) => {
                        const active = exceptions.includes(subtype);
                        return (
                          <button
                            key={subtype}
                            onClick={() => toggleException(category, subtype)}
                            className={`px-2 py-0.5 rounded-full border transition-colors ${
                              active
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-50'
                            }`}
                            title={
                              active
                                ? 'Убрать исключение: подтип снова скрыт вместе с категорией'
                                : 'Оставить этот подтип в продаже, даже когда категория скрыта'
                            }
                          >
                            {active ? '✓ ' : ''}
                            {subtype}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Перемещения */}
          <section>
            <div className="text-xs font-semibold text-gray-600 mb-2">Перемещения</div>
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={() =>
                  updateStoreProfile(storeName, { transfersDisabled: !profile.transfersDisabled })
                }
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                  profile.transfersDisabled
                    ? 'bg-gray-700 text-white border-gray-700'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                }`}
                title="Выключить перемещения совсем: магазин не участвует ни как получатель, ни как донор"
              >
                {profile.transfersDisabled ? '📴 Перемещения выключены' : '✅ Перемещения включены'}
              </button>
              <label className="flex items-center gap-2 text-xs text-gray-600">
                Минимум на позицию по умолчанию, шт.:
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={profile.defaultMinimum || ''}
                  placeholder="0"
                  onChange={(e) => {
                    const num = parseInt(e.target.value.replace(',', '.'), 10);
                    updateStoreProfile(storeName, {
                      defaultMinimum: Number.isFinite(num) && num > 0 ? num : 0,
                    });
                  }}
                  className="w-20 px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-400"
                />
              </label>
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5">
              ⭐ Индивидуальный минимум товара (карточка товара → «🏬 Правила по магазинам»)
              перекрывает минимум по умолчанию.
            </p>
          </section>

          {/* Индивидуальные запреты товаров */}
          <section>
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-xs font-semibold text-gray-600">
                Индивидуальные запреты товаров{' '}
                <span className="font-normal text-gray-400">— 🚫 {bannedKeys.length}</span>
              </div>
              {bannedKeys.length > 0 && (
                <button
                  onClick={() => setBansOpen((o) => !o)}
                  className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
                  title={bansOpen ? 'Свернуть список запрещённых товаров' : 'Показать список запрещённых товаров'}
                >
                  {bansOpen ? '▾ Скрыть список' : '▸ Показать список'}
                </button>
              )}
            </div>
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск по названию, артикулу или бренду…"
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            {query.trim() && (
              <div className="mt-2 rounded-lg border border-gray-100 divide-y divide-gray-50 max-h-64 overflow-y-auto">
                {searchResults.length === 0 && (
                  <p className="text-xs text-gray-400 p-3">Ничего не найдено</p>
                )}
                {searchResults.map((product) => {
                  const key = productSettingsKey(product);
                  const banned = profile.bannedProducts[key] === true;
                  return (
                    <div key={product.id} className="flex items-center gap-2 px-3 py-2">
                      <button
                        onClick={() => openCard(product.id)}
                        className="text-xs text-gray-800 hover:text-blue-600 hover:underline text-left min-w-0 truncate"
                        title="Открыть карточку товара"
                      >
                        {product.name}
                      </button>
                      <span className="text-[10px] text-gray-400 flex-shrink-0">
                        {product.brand}
                        {product.article ? ` · ${product.article}` : ''}
                      </span>
                      <button
                        onClick={() => setProductBanned(storeName, key, !banned)}
                        className={`ml-auto flex-shrink-0 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                          banned
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                            : 'bg-white text-red-600 border-red-200 hover:bg-red-50'
                        }`}
                      >
                        {banned ? '✓ Разрешить' : '🚫 Запретить'}
                      </button>
                    </div>
                  );
                })}
                {searchResults.length === MAX_SEARCH_RESULTS && (
                  <p className="text-[10px] text-gray-400 p-2">
                    Показаны первые {MAX_SEARCH_RESULTS} — уточните запрос
                  </p>
                )}
              </div>
            )}

            {bansOpen && bannedKeys.length > 0 && (
              <div className="mt-3 space-y-1">
                {bannedKeys.map((key) => {
                  const product = productByKey.get(key);
                  return (
                    <div
                      key={key}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-50 border border-red-100"
                    >
                      <span className="text-xs">🚫</span>
                      {product ? (
                        <button
                          onClick={() => openCard(product.id)}
                          className="text-xs text-gray-800 hover:text-blue-600 hover:underline text-left min-w-0 truncate"
                          title="Открыть карточку товара"
                        >
                          {product.name}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-500 truncate">{key}</span>
                      )}
                      <span className="text-[10px] text-gray-400 flex-shrink-0 ml-auto">
                        {product?.brand ?? ''}
                      </span>
                      <button
                        onClick={() => setProductBanned(storeName, key, false)}
                        className="flex-shrink-0 p-1 rounded text-gray-400 hover:text-red-600 hover:bg-white"
                        title="Снять запрет"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
                <button
                  onClick={() => updateStoreProfile(storeName, { bannedProducts: {} })}
                  className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-red-600 mt-1"
                >
                  <Trash2 className="w-3 h-3" />
                  Снять все запреты в этом магазине
                </button>
              </div>
            )}
            {bannedKeys.length === 0 && !query.trim() && (
              <p className="text-[11px] text-gray-400 mt-2">
                Запретов нет — товар предлагается магазину на общих правилах. Найдите товар выше и
                нажмите «🚫 Запретить», либо сделайте это в карточке товара («🏬 Правила по
                магазинам»).
              </p>
            )}
          </section>

          {/* Заметка */}
          <section>
            <div className="text-xs font-semibold text-gray-600 mb-2">Заметка о магазине</div>
            <textarea
              value={profile.note}
              onChange={(e) => updateStoreProfile(storeName, { note: e.target.value })}
              rows={3}
              placeholder="Например: точка в торговом центре, мало места под обувь; падел-направление развиваем, теннисные струны не возим…"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-400 resize-y"
            />
          </section>
        </div>
      </div>

      {openProduct && (
        <ProductCardModal productId={openProduct} onClose={closeCard} />
      )}
    </div>
  );
}
