import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Package,
  Info,
  Warehouse,
  Banknote,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  MapPin,
  Shirt,
  LayoutGrid,
  List,
  Flame,
} from 'lucide-react';
import {
  useFilteredData,
  useIsHot,
  useStoreProfileSummaries,
  useTransferRecommendations,
} from '../hooks/useAnalytics';
import { useData } from '../context/DataContext';
import {
  MAX_TRANSFER_DISPLAY,
  SPB_EXCESS_TRIGGER,
  CITY_EXCESS_TRIGGER,
  SPB_DONOR_KEEP,
  CITY_DONOR_KEEP,
  getOverstockPositions,
} from '../utils/analyticsCore';
import { isWarehouse, shortStoreLabel, ROUTE_LABELS, type TransferRoute } from '../utils/storeGroups';
import { effectiveMinimum, STORE_SPORT_LABELS } from '../utils/storeRules';
import { productSettingsKey } from '../utils/sport';
import { ORDER_BOOKMARKLET, type CartLine } from '../utils/cart';
import {
  addLines,
  buildOrder,
  dropLines,
  removeLine,
  setLineQty,
  summarizeKeys,
  toggleLine,
  type OrderSelection,
} from '../utils/orderSelection';
import { ProductCardModal, ProductImage } from './ProductCardModal';
import { useProductRoute } from '../utils/router';
import type { TransferRecommendation } from '../types';

const PRIORITY_STYLES: Record<string, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-blue-100 text-blue-700',
};

const PRIORITY_LABELS: Record<string, string> = {
  high: 'Высокий',
  medium: 'Средний',
  low: 'Низкий',
};

const ROUTE_STYLES: Record<TransferRoute, string> = {
  warehouse: 'bg-blue-50 text-blue-700 border border-blue-200',
  'same-city': 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  intercity: 'bg-gray-100 text-gray-600 border border-gray-200',
  'spb-expensive': 'bg-red-50 text-red-600 border border-red-200',
};

const ROUTE_ICONS: Record<TransferRoute, typeof Warehouse> = {
  warehouse: Warehouse,
  'same-city': MapPin,
  intercity: ArrowRight,
  'spb-expensive': Banknote,
};

/** Группа вариантов одного дефицита: товар + размер + получатель; источники — альтернативы */
interface OptionGroupView {
  key: string;
  size: string;
  toStore: string;
  toStoreId: string;
  toQty: number;
  variants: TransferRecommendation[];
}

interface ProductGroupView {
  productId: string;
  productName: string;
  productLink?: string;
  groups: Map<string, OptionGroupView>;
}

type MyScope = 'incoming' | 'outgoing' | 'all';
/** Вид списка рекомендаций: строки или карточки с фото (выбор запоминается) */
type ViewMode = 'list' | 'cards';

const VIEW_STORAGE_KEY = 'saletennis-transfers-view';

function loadViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'cards' ? 'cards' : 'list';
  } catch {
    return 'list';
  }
}

/** Счётчик −/+ (общее значение для строки, плавающей панели и окна заказа) */
function QtyStepper({
  value,
  onChange,
  dark = false,
}: {
  value: number;
  onChange: (value: number) => void;
  dark?: boolean;
}) {
  const btn = dark
    ? 'bg-white/10 hover:bg-white/25 text-white'
    : 'bg-white hover:bg-gray-100 text-gray-600 border border-gray-200';
  const input = dark
    ? 'bg-white/10 border-white/20 text-white'
    : 'bg-white border-gray-200 text-gray-800';
  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      <button
        onClick={() => onChange(value - 1)}
        className={`w-6 h-6 rounded font-bold ${btn}`}
        title="Меньше"
        type="button"
      >
        −
      </button>
      <input
        type="number"
        min={1}
        max={99}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`w-12 h-6 text-center rounded border text-xs focus:ring-1 focus:ring-emerald-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${input}`}
        title="Сколько заказать (значение общее для строки, панели корзины и окна заказа)"
      />
      <button
        onClick={() => onChange(value + 1)}
        className={`w-6 h-6 rounded font-bold ${btn}`}
        title="Больше"
        type="button"
      >
        +
      </button>
    </div>
  );
}

export function TransferRecommendations() {
  const data = useFilteredData();
  const recommendations = useTransferRecommendations();
  const isHot = useIsHot();
  const profileSummaries = useStoreProfileSummaries();
  const { storeProfile, settings, cartMap, saletennisSession, setSaletennisSession } = useData();
  const [myScope, setMyScope] = useState<MyScope>('all');
  // Корзина: выбранные позиции (ключ группы → строка), отправка, сессия
  const [selected, setSelected] = useState<OrderSelection>(new Map());
  const [cartBusy, setCartBusy] = useState<string | null>(null);
  const [cartMessage, setCartMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [showSessionInput, setShowSessionInput] = useState(false);
  const [sessionDraft, setSessionDraft] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode);
  /**
   * Окно заказа НЕ хранит снимок списка: оно открыто/закрыто, а содержимое
   * (числа, ссылка, текст) каждый раз считается из текущего выбора — иначе
   * правка количества в плавающей панели не доезжала до сайта (уезжало 1 шт.).
   */
  const [orderOpen, setOrderOpen] = useState(false);
  const [toStoreId, setToStoreId] = useState('all');
  const [fromStoreId, setFromStoreId] = useState('all');
  const [selectedSubtype, setSelectedSubtype] = useState('all');
  const [showSpbExpensive, setShowSpbExpensive] = useState(false);
  const [showOverstock, setShowOverstock] = useState(false);
  // Карточка товара — часть адреса (?product=<id>): работает кнопка «Назад»,
  // ссылку на товар можно скопировать, перезагрузка открывает ту же карточку
  const {
    productId: selectedProduct,
    openProduct: openProductCard,
    closeProduct: closeProductCard,
  } = useProductRoute('transfers');

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, viewMode);
    } catch {
      /* приватный режим */
    }
  }, [viewMode]);

  // Подтипы одежды (носки, футболки, шорты, платья…) — из товаров текущей выборки
  const subtypes = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    for (const product of data.products) {
      if (product.subtype) set.add(product.subtype);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [data]);

  // Остатки по товарам для наглядных чипов: productId → (storeId → qty)
  const productStoreTotals = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    if (!data) return map;
    for (const item of data.inventory) {
      if (item.notCarried) continue;
      let byStore = map.get(item.productId);
      if (!byStore) {
        byStore = new Map();
        map.set(item.productId, byStore);
      }
      byStore.set(item.storeId, (byStore.get(item.storeId) ?? 0) + item.quantity);
    }
    return map;
  }, [data]);

  const overstock = useMemo(() => (data ? getOverstockPositions(data) : []), [data]);

  // Профиль «Мой магазин»: id выбранного магазина и область рекомендаций
  const profileStoreId = useMemo(
    () => data?.stores.find((st) => st.name === storeProfile)?.id ?? null,
    [data, storeProfile]
  );
  useEffect(() => {
    setMyScope(profileStoreId ? 'incoming' : 'all');
  }, [profileStoreId]);

  const spbExpensiveCount = recommendations.filter((r) => r.route === 'spb-expensive').length;

  const productsById = useMemo(
    () => new Map((data?.products ?? []).map((p) => [p.id, p])),
    [data]
  );

  /**
   * ⭐ Минимум магазина-получателя: индивидуальный минимум товара перекрывает
   * минимум по умолчанию из профиля магазина. Действует для ЛЮБОГО магазина,
   * а не только для «Моего».
   */
  const getMinInfo = useCallback(
    (rec: TransferRecommendation | undefined): { min: number; current: number; store: boolean } | null => {
      if (!rec) return null;
      const product = productsById.get(rec.productId);
      if (!product) return null;
      const { min, source } = effectiveMinimum(settings, rec.toStore, productSettingsKey(product));
      if (!min || min <= 0 || rec.toQty >= min) return null;
      return { min, current: rec.toQty, store: source === 'store' };
    },
    [productsById, settings]
  );

  const filtered = useMemo(
    () =>
      recommendations.filter(
        (r) =>
          (myScope === 'all' ||
            !profileStoreId ||
            (myScope === 'incoming'
              ? r.toStoreId === profileStoreId
              : r.fromStoreId === profileStoreId)) &&
          (toStoreId === 'all' || r.toStoreId === toStoreId) &&
          (fromStoreId === 'all' || r.fromStoreId === fromStoreId) &&
          (selectedSubtype === 'all' || r.subtype === selectedSubtype) &&
          (showSpbExpensive || r.route !== 'spb-expensive')
      ),
    [recommendations, myScope, profileStoreId, toStoreId, fromStoreId, selectedSubtype, showSpbExpensive]
  );

  // Группировка: товар → группы вариантов (размер+получатель) → источники-альтернативы
  const productGroups = useMemo(() => {
    const byProduct = new Map<string, ProductGroupView>();
    for (const rec of filtered) {
      let product = byProduct.get(rec.productId);
      if (!product) {
        product = {
          productId: rec.productId,
          productName: rec.productName,
          productLink: rec.productLink,
          groups: new Map(),
        };
        byProduct.set(rec.productId, product);
      }
      let group = product.groups.get(rec.optionGroup);
      if (!group) {
        group = {
          key: rec.optionGroup,
          size: rec.size,
          toStore: rec.toStore,
          toStoreId: rec.toStoreId,
          toQty: rec.toQty,
          variants: [],
        };
        product.groups.set(rec.optionGroup, group);
      }
      group.variants.push(rec);
    }
    return [...byProduct.values()].slice(0, MAX_TRANSFER_DISPLAY);
  }, [filtered]);

  // Товары с нехваткой до ⭐ минимума — первыми (сортировка устойчивая)
  const sortedProductGroups = useMemo(() => {
    const weight = (g: ProductGroupView) =>
      [...g.groups.values()].some((gr) => getMinInfo(gr.variants[0])) ? 0 : 1;
    return [...productGroups].sort((a, b) => weight(a) - weight(b));
  }, [productGroups, getMinInfo]);

  // ---- Корзина: выбор позиций и отправка на saletennis.com ----
  const totalUnits = useMemo(
    () => [...selected.values()].reduce((sum, line) => sum + line.quantity, 0),
    [selected]
  );

  /**
   * Заказ считается ИЗ ТЕКУЩЕГО ВЫБОРА при каждом рендере: ссылка, числа и
   * текст всегда свежие, из какого бы места ни правили количество.
   */
  const order = useMemo(() => buildOrder(cartMap, selected), [cartMap, selected]);

  const toggleGroup = (group: OptionGroupView) => {
    const rec = group.variants[0];
    const line: Omit<CartLine, 'quantity'> & { quantity?: number } = {
      key: group.key,
      name: rec.productName,
      ...(rec.productLink ? { link: rec.productLink } : {}),
      size: group.size,
      quantity: Math.max(1, rec.quantity),
      toStore: group.toStore,
    };
    setSelected((prev) => toggleLine(prev, line));
  };

  const changeQty = (key: string, value: number) => {
    setSelected((prev) => setLineQty(prev, key, value));
  };

  /** Карточный вид: отметить/снять все дефициты товара сразу */
  const toggleProduct = (product: ProductGroupView) => {
    const keys = [...product.groups.keys()];
    const summary = summarizeKeys(selected, keys);
    setSelected((prev) => {
      if (summary.positions === keys.length) return dropLines(prev, keys);
      return addLines(
        prev,
        [...product.groups.values()].map((group) => {
          const rec = group.variants[0];
          const existing = prev.get(group.key);
          return {
            key: group.key,
            name: rec.productName,
            ...(rec.productLink ? { link: rec.productLink } : {}),
            size: group.size,
            quantity: existing ? existing.quantity : Math.max(1, rec.quantity),
            toStore: group.toStore,
          };
        })
      );
    });
  };

  /**
   * Основной сценарий (без cookie): открыть окно заказа. Ссылка на корзину
   * saletennis.com со списком в #stcart собирается в момент нажатия кнопки
   * внутри окна — из свежих количеств.
   */
  const goOrder = () => {
    if (order.empty || cartBusy !== null) return;
    if (order.items.length === 0) {
      setCartMessage({
        text: `Не удалось собрать заказ: ${order.missing[0]?.reason ?? 'нет данных корзины'}. Используйте «Скопировать список».`,
        error: true,
      });
      return;
    }
    setOrderOpen(true);
  };

  const openCart = () => {
    // Свежая ссылка (включая последние правки количества) — в момент клика
    const draft = buildOrder(cartMap, selected);
    if (draft.missing.length > 0) {
      navigator.clipboard
        ?.writeText(draft.missing.map((m) => `${m.line.name} | ${m.line.size} | ${m.line.quantity} шт. — ${m.reason}`).join('\n'))
        .catch(() => undefined);
    }
    window.open(draft.url, '_blank', 'noopener');
  };

  const copyList = async () => {
    const text = buildOrder(cartMap, selected).text;
    try {
      await navigator.clipboard.writeText(text);
      setCartMessage({ text: 'Список скопирован в буфер обмена', error: false });
    } catch {
      setCartMessage({ text: 'Не удалось скопировать — разрешите доступ к буферу', error: true });
    }
  };

  const sendToCart = async () => {
    if (order.empty || cartBusy) return;
    // Свежие позиции — в момент нажатия (не снимок)
    const draft = buildOrder(cartMap, selected);
    const { items, missing } = draft;
    const sessionCookie = saletennisSession.trim();
    if (!sessionCookie) {
      setSessionDraft(saletennisSession);
      setShowSessionInput(true);
      setCartMessage({
        text: 'Сначала укажите сессию saletennis.com (🔑) — инструкция в открывшемся окне',
        error: true,
      });
      return;
    }
    if (items.length === 0) {
      setCartMessage({
        text: `Нечего добавлять: ${missing[0]?.reason ?? 'нет данных корзины'}. Воспользуйтесь «Скопировать список».`,
        error: true,
      });
      return;
    }
    setCartMessage(null);
    let added = 0;
    let unauthorized = false;
    let unauthorizedError = '';
    const errors: string[] = [];
    const BATCH = 10;
    try {
      for (let i = 0; i < items.length; i += BATCH) {
        const batch = items.slice(i, i + BATCH);
        setCartBusy(`Добавляю ${Math.min(i + BATCH, items.length)}/${items.length}…`);
        const resp = await fetch('/api/saletennis-cart', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            cookie: saletennisSession.trim(),
            items: batch.map((it) => ({
              itemId: it.itemId,
              count: it.count,
              size: it.size,
              name: it.name,
            })),
          }),
        });
        if (resp.status === 404) {
          errors.push('API корзины недоступно (работает только на сайте Vercel, не в локальной сборке)');
          break;
        }
        const payload = (await resp.json().catch(() => null)) as {
          unauthorized?: boolean;
          error?: string;
          results?: { name: string; ok: boolean; error?: string }[];
        } | null;
        if (!resp.ok || !payload) {
          errors.push(`HTTP ${resp.status}`);
          continue;
        }
        if (payload.unauthorized) {
          unauthorized = true;
          unauthorizedError = payload.error ?? '';
          break;
        }
        for (const r of payload.results ?? []) {
          if (r.ok) added++;
          else errors.push(`${r.name}: ${r.error ?? 'ошибка'}`);
        }
      }
    } catch (e) {
      errors.push(String(e));
    }
    setCartBusy(null);
    if (unauthorized) {
      setSessionDraft('');
      setShowSessionInput(true);
      setCartMessage({
        text:
          unauthorizedError ||
          'Сессия saletennis.com истекла — вставьте свежий PHPSESSID (🔑)',
        error: true,
      });
      return;
    }
    if (added > 0) {
      window.open('https://www.saletennis.com/cabinet/cart/', '_blank', 'noopener');
      setSelected(new Map());
      setOrderOpen(false);
    }
    const parts = [`Добавлено в корзину: ${added} из ${items.length}`];
    if (missing.length > 0) {
      parts.push(`${missing.length} позиций без данных корзины — список скопирован в буфер`);
      navigator.clipboard
        ?.writeText(missing.map((m) => `${m.line.name} | ${m.line.size} | ${m.line.quantity} шт.`).join('\n'))
        .catch(() => undefined);
    }
    if (errors.length > 0) {
      parts.push(`ошибки: ${errors.slice(0, 2).join('; ')}${errors.length > 2 ? '…' : ''}`);
    }
    setCartMessage({ text: parts.join(' · '), error: added === 0 });
  };

  const saveSession = () => {
    setSaletennisSession(sessionDraft);
    setShowSessionInput(false);
    setCartMessage({ text: 'Сессия saletennis.com сохранена (только в этом браузере)', error: false });
  };

  if (!data) return null;

  const selectedToStore = data.stores.find((s) => s.id === toStoreId);
  const uniqueMoves = new Set(filtered.map((r) => r.optionGroup)).size;

  return (
    <div className="space-y-4">
      {/* Профиль «Мой магазин» — видно только свои перемещения */}
      {profileStoreId && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-blue-800">📍 Мой магазин: {storeProfile}</span>
          <div className="inline-flex rounded-full border border-blue-300 overflow-hidden text-xs">
            {(
              [
                ['incoming', 'Входящие (мне)'],
                ['outgoing', 'Исходящие (от меня)'],
                ['all', 'Вся сеть'],
              ] as [MyScope, string][]
            ).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => setMyScope(mode)}
                className={`px-3 py-1 font-medium transition-colors ${
                  myScope === mode
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-blue-700 hover:bg-blue-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-blue-500 ml-auto">
            магазин выбирается в сайдбаре слева
          </span>
        </div>
      )}

      {/* Плашка: какие профили магазинов учтены и почему часть рекомендаций скрыта */}
      {profileSummaries.length > 0 && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3">
          <div className="text-xs font-semibold text-indigo-900 mb-1.5">
            🏬 Учтены профили магазинов ({profileSummaries.length}) — часть рекомендаций скрыта
            намеренно
          </div>
          <div className="flex flex-wrap gap-1.5">
            {profileSummaries.map((summary) => {
              const reasons: string[] = [];
              if (summary.profile.sport !== 'all') {
                reasons.push(
                  `${STORE_SPORT_LABELS[summary.profile.sport]} → скрыто ${summary.excluded.sport} тов.`
                );
              }
              if (summary.profile.hiddenCategories.length > 0) {
                reasons.push(
                  `⛔ категории (${summary.profile.hiddenCategories.length}) → скрыто ${summary.excluded.category} тов.`
                );
              }
              if (Object.keys(summary.profile.bannedProducts).length > 0) {
                reasons.push(
                  `🚫 запреты: ${Object.keys(summary.profile.bannedProducts).length} тов.`
                );
              }
              if (summary.profile.transfersDisabled) reasons.push('📴 перемещения выключены');
              if (summary.profile.defaultMinimum > 0) {
                reasons.push(`⭐ минимум ${summary.profile.defaultMinimum} шт. на позицию`);
              }
              if (reasons.length === 0) reasons.push('правила не заданы');
              return (
                <span
                  key={summary.storeName}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-indigo-200 text-[11px] text-gray-700"
                  title={`${summary.storeName}: ${reasons.join('; ')}. Вне ассортимента точки: ${summary.excluded.total} из ${summary.products} товаров — они не предлагаются магазину в перемещениях и не участвуют в его нормативе дозакупки.`}
                >
                  <b className="text-indigo-800">
                    {isWarehouse(summary.storeName) ? '📦 ' : ''}
                    {shortStoreLabel(summary.storeName)}
                  </b>
                  <span className="text-gray-500">{reasons.join(' · ')}</span>
                  {summary.excluded.total > 0 && (
                    <span className="text-[10px] text-red-500 font-semibold">
                      −{summary.excluded.total} тов.
                    </span>
                  )}
                </span>
              );
            })}
          </div>
          <p className="text-[10px] text-indigo-500 mt-2">
            Профили правятся на вкладке «🏬 Магазины», индивидуальные запреты и минимумы — в
            карточке товара («🏬 Правила по магазинам»). 🚫 Запрет сильнее всех остальных правил.
          </p>
        </div>
      )}

      {/* Панель фильтров */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <Package className="w-5 h-5 text-blue-600" />
              {selectedToStore
                ? `Отсутствующий ассортимент: ${selectedToStore.name}`
                : 'Рекомендации по перемещению'}
            </h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {uniqueMoves} дефицитов · {filtered.length} вариантов перемещения
              {toStoreId !== 'all' && ' — чем заполнить выбранный магазин'}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {/* Переключатель список ⇄ карточки (выбор запоминается) */}
            <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
              <button
                onClick={() => setViewMode('list')}
                className={`px-2.5 py-2 text-xs font-medium transition-colors ${
                  viewMode === 'list'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-500 hover:bg-gray-50'
                }`}
                title="Список: строки с вариантами перемещения"
              >
                <List className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('cards')}
                className={`px-2.5 py-2 text-xs font-medium transition-colors ${
                  viewMode === 'cards'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-500 hover:bg-gray-50'
                }`}
                title="Карточки: крупное фото товара, дефициты и остатки по магазинам"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
            </div>
            {subtypes.length > 0 && (
              <select
                value={selectedSubtype}
                onChange={(e) => setSelectedSubtype(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white cursor-pointer focus:ring-2 focus:ring-blue-500"
                title="Подтип одежды"
              >
                <option value="all">👕 Вся одежда</option>
                {subtypes.map((subtype) => (
                  <option key={subtype} value={subtype}>
                    {subtype}
                  </option>
                ))}
              </select>
            )}
            <select
              value={toStoreId}
              onChange={(e) => setToStoreId(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white cursor-pointer focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">Куда: все магазины</option>
              {data.stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {isWarehouse(store.name) ? '📦 ' : ''}
                  Куда: {store.name}
                </option>
              ))}
            </select>
            <select
              value={fromStoreId}
              onChange={(e) => setFromStoreId(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white cursor-pointer focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">Откуда: все</option>
              {data.stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {isWarehouse(store.name) ? '📦 ' : ''}
                  Откуда: {store.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => setShowHelp((v) => !v)}
              className={`px-3 py-2 border rounded-lg text-xs whitespace-nowrap transition-colors ${
                showHelp
                  ? 'border-blue-300 bg-blue-50 text-blue-700'
                  : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
              }`}
              title="Как переносить заказ на saletennis.com без вставки cookie (одноразовая настройка)"
            >
              📖 Как заказать
            </button>
            <button
              onClick={() => {
                setSessionDraft(saletennisSession);
                setShowSessionInput(true);
              }}
              className={`px-3 py-2 border rounded-lg text-xs whitespace-nowrap transition-colors ${
                saletennisSession
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
              }`}
              title="Сессия (cookie PHPSESSID) для переноса корзины на saletennis.com"
            >
              🔑 Корзина saletennis: {saletennisSession ? 'подключена ✓' : 'не подключена'}
            </button>
          </div>
        </div>

        {/* Предупреждение про дорогую логистику из СПб */}
        {spbExpensiveCount > 0 && (
          <div className="mt-3 flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <Banknote className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-amber-800 flex-1">
              <b>Перемещения из Санкт-Петербурга в другие города стоят дорого.</b> Обычно выгоднее
              дозаказать у поставщика или оставить товар в СПб. Скрыто по умолчанию:{' '}
              {spbExpensiveCount} таких рекомендаций.
              <label className="ml-2 inline-flex items-center gap-1.5 cursor-pointer font-medium underline decoration-dotted">
                <input
                  type="checkbox"
                  checked={showSpbExpensive}
                  onChange={(e) => setShowSpbExpensive(e.target.checked)}
                  className="rounded border-amber-400"
                />
                Показать
              </label>
            </div>
          </div>
        )}

        <div className="mt-3 flex items-start gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-gray-400" />
          <p>
            Правила: в магазинах <b>Екатеринбурга, Тюмени, Уфы, Ижевска</b> избытком считается{' '}
            <b>&gt; {CITY_EXCESS_TRIGGER - 1} шт.</b> одного размера (донор оставляет{' '}
            {CITY_DONOR_KEEP}), в <b>Санкт-Петербурге</b> — <b>&gt; {SPB_EXCESS_TRIGGER - 1} шт.</b>{' '}
            (оставляет {SPB_DONOR_KEEP}); перемещаем туда, где позиции <b>0 или 1</b> (или не
            хватает до ⭐ минимума магазина).{' '}
            <b>Склад — без правил</b>: если размер есть на складе, показываем вариант перевозки
            одновременно с магазинным (это <b>альтернативы</b>, выбирайте одну). 🔝 Приоритет —
            приоритетные размеры (женские S/M, мужские M/L, обувь 41–44) при нуле у получателя.
          </p>
        </div>
      </div>

      {/* Инструкция: заказ без вставки cookie (кнопка-закладка) */}
      {showHelp && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">
            🛒 Перенос заказа на saletennis.com
          </h4>
          <div className="text-xs text-gray-600 space-y-2 leading-relaxed">
            <p>
              <b>Как это работает:</b> корзина saletennis.com привязана к <b>сессии вашего
              браузера</b> (а не к аккаунту), поэтому товары добавляются из вашего браузера —
              кнопкой-закладкой. Вход по логину/паролю через сервер наполнял бы «чужую» сессию —
              поэтому такой способ убран.
            </p>
            <p>
              <b>Кнопка-закладка.</b> Одноразово перетащите кнопку ниже на{' '}
              <b>панель закладок</b> браузера (если панели нет — нажмите Ctrl+Shift+B):
            </p>
            <p className="py-1">
              <a
                href={ORDER_BOOKMARKLET}
                onClick={(e) => e.preventDefault()}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white rounded-xl text-sm font-semibold cursor-grab select-none"
                title="Перетащите меня на панель закладок (не нажимайте!)"
              >
                🛒 SaleTennis Заказ
              </a>
              <span className="ml-2 text-gray-400">← перетащить, не нажимать</span>
            </p>
            <p>
              <b>Как заказывать закладкой:</b> 1) отметьте позиции и количество (счётчик −/+ есть в
              строке рекомендации, в плавающей панели и в окне заказа — значение общее) → 2)
              «Перейти к заказу» → «Открыть корзину со списком» → 3) на открытой странице нажмите
              закладку «🛒 SaleTennis Заказ» — товары добавятся в корзину <b>вашего браузера</b>{' '}
              (входить на сайт не обязательно) → 4) оформляйте заказ.
            </p>
            <p className="text-gray-400">
              Альтернатива без закладки — «⚡ Авто-добавление» через 🔑-сессию (полностью
              автоматически, но значение PHPSESSID придётся обновлять, когда сайт разлогинит).
            </p>
          </div>
        </div>
      )}

      {/* Карточки товаров (вид «карточки»: крупное фото) */}
      {viewMode === 'cards' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {sortedProductGroups.map((product) => {
            const storeTotals = productStoreTotals.get(product.productId);
            const fullProduct = productsById.get(product.productId);
            const keys = [...product.groups.keys()];
            const inOrder = summarizeKeys(selected, keys);
            const hot = fullProduct ? isHot(fullProduct) : false;
            const minGroups = [...product.groups.values()].filter((g) => getMinInfo(g.variants[0]));
            return (
              <div
                key={product.productId}
                className={`bg-white rounded-xl shadow-sm border overflow-hidden flex flex-col hover:shadow-md transition-all ${
                  inOrder.positions > 0 ? 'border-emerald-300 ring-1 ring-emerald-200' : 'border-gray-100'
                }`}
              >
                <button
                  onClick={() => openProductCard(product.productId)}
                  className="block w-full h-44 bg-gradient-to-br from-gray-50 to-blue-50 border-b border-gray-100"
                  title="Открыть карточку товара"
                >
                  {fullProduct ? (
                    <ProductImage product={fullProduct} alt={product.productName} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300">
                      <Package className="w-12 h-12" />
                    </div>
                  )}
                </button>
                <div className="p-3 flex flex-col gap-2 flex-1">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <button
                        onClick={() => openProductCard(product.productId)}
                        className="text-sm font-medium text-gray-800 hover:text-blue-600 hover:underline text-left leading-snug"
                        title={product.productName}
                      >
                        {hot && '🔥 '}
                        {product.productName}
                      </button>
                      <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1.5">
                        <span>{fullProduct?.brand ?? ''}</span>
                        {product.productLink && (
                          <a
                            href={product.productLink}
                            target="_blank"
                            rel="noreferrer"
                            className="text-gray-400 hover:text-blue-500"
                            title="Открыть на saletennis.com"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="w-3 h-3 inline" />
                          </a>
                        )}
                      </div>
                    </div>
                    <span
                      className="text-[11px] font-bold text-gray-700 bg-gray-100 px-2 py-1 rounded-full flex-shrink-0"
                      title="Сколько размерных дефицитов у товара"
                    >
                      {product.groups.size} дефиц.
                    </span>
                  </div>

                  {minGroups.length > 0 && (
                    <span className="self-start text-[10px] font-bold text-amber-700 bg-amber-100 border border-amber-300 rounded-full px-2 py-0.5">
                      ⭐ минимум не закрыт: {minGroups.length} поз.
                    </span>
                  )}

                  {/* Остатки по магазинам */}
                  {storeTotals && (
                    <div className="flex flex-wrap gap-1">
                      {data.stores
                        .filter((s) => storeTotals.has(s.id))
                        .map((store) => {
                          const qty = storeTotals.get(store.id) ?? 0;
                          const warehouse = isWarehouse(store.name);
                          return (
                            <span
                              key={store.id}
                              title={`${store.name}: ${qty} шт.`}
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border ${
                                warehouse
                                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                                  : qty === 0
                                    ? 'bg-red-50 border-red-200 text-red-600'
                                    : qty >= CITY_EXCESS_TRIGGER
                                      ? 'bg-amber-50 border-amber-200 text-amber-700'
                                      : 'bg-gray-50 border-gray-200 text-gray-600'
                              }`}
                            >
                              {shortStoreLabel(store.name)}: <b>{qty}</b>
                            </span>
                          );
                        })}
                    </div>
                  )}

                  {/* Дефициты: размер → куда */}
                  <div className="flex flex-wrap gap-1">
                    {[...product.groups.values()].slice(0, 6).map((group) => (
                      <span
                        key={group.key}
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border ${
                          selected.has(group.key)
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                            : 'bg-white border-gray-200 text-gray-600'
                        }`}
                        title={`Размер ${group.size} → ${group.toStore} (сейчас ${group.toQty})`}
                      >
                        <b>{group.size}</b>
                        <ArrowRight className="w-2.5 h-2.5" />
                        {shortStoreLabel(group.toStore)}
                      </span>
                    ))}
                    {product.groups.size > 6 && (
                      <span className="text-[10px] text-gray-400 self-center">
                        +{product.groups.size - 6}
                      </span>
                    )}
                  </div>

                  <div className="mt-auto pt-2 flex items-center gap-2">
                    <button
                      onClick={() => toggleProduct(product)}
                      className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                        inOrder.positions > 0
                          ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                          : 'bg-gray-900 text-white hover:bg-gray-700'
                      }`}
                      title={
                        inOrder.positions > 0
                          ? 'Убрать все позиции товара из заказа'
                          : 'Добавить все дефициты товара в заказ (количество можно править в строках и в панели корзины)'
                      }
                    >
                      {inOrder.positions > 0 ? '✓ В заказе — убрать' : 'В заказ: все дефициты'}
                    </button>
                  </div>
                  {inOrder.positions > 0 && (
                    <div className="text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1 text-center">
                      ✓ {inOrder.positions} поз. · {inOrder.units} шт. уже в заказе
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Список товаров (вид «список») */}
      {viewMode === 'list' && (
        <div className="space-y-3">
          {sortedProductGroups.map((product) => {
            const storeTotals = productStoreTotals.get(product.productId);
            const fullProduct = productsById.get(product.productId);
            const brand = fullProduct?.brand ?? '';
            const hot = fullProduct ? isHot(fullProduct) : false;
            return (
              <div
                key={product.productId}
                className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:shadow-md transition-all"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <button
                      onClick={() => openProductCard(product.productId)}
                      className="font-medium text-sm text-gray-800 hover:text-blue-600 hover:underline text-left"
                      title="Открыть карточку товара"
                    >
                      {hot && (
                        <Flame className="w-3.5 h-3.5 inline text-orange-500 mr-1 align-[-2px]" />
                      )}
                      {product.productName}
                    </button>
                    {product.productLink && (
                      <a
                        href={product.productLink}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-1.5 text-gray-400 hover:text-blue-500"
                        title="Открыть на saletennis.com"
                      >
                        <ExternalLink className="w-3 h-3 inline" />
                      </a>
                    )}
                    <div className="text-xs text-gray-500 mt-0.5">{brand}</div>
                  </div>
                  <span className="text-xs font-bold text-gray-700 bg-gray-100 px-2.5 py-1 rounded-full flex-shrink-0">
                    {product.groups.size} дефиц.
                  </span>
                </div>

                {/* Наглядные текущие остатки по магазинам */}
                {storeTotals && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {data.stores
                      .filter((s) => storeTotals.has(s.id))
                      .map((store) => {
                        const qty = storeTotals.get(store.id) ?? 0;
                        const warehouse = isWarehouse(store.name);
                        return (
                          <span
                            key={store.id}
                            title={`${store.name}: ${qty} шт.`}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border ${
                              warehouse
                                ? 'bg-blue-50 border-blue-200 text-blue-700'
                                : qty === 0
                                  ? 'bg-red-50 border-red-200 text-red-600'
                                  : qty >= CITY_EXCESS_TRIGGER
                                    ? 'bg-amber-50 border-amber-200 text-amber-700'
                                    : 'bg-gray-50 border-gray-200 text-gray-600'
                            }`}
                          >
                            {shortStoreLabel(store.name)}: <b>{qty}</b>
                          </span>
                        );
                      })}
                  </div>
                )}

                {/* Группы вариантов: один дефицит — несколько альтернативных источников */}
                <div className="space-y-2">
                  {[...product.groups.values()].map((group) => {
                    const line = selected.get(group.key);
                    const mi = getMinInfo(group.variants[0]);
                    return (
                      <div
                        key={group.key}
                        className={`rounded-lg px-3 py-2 ${
                          line ? 'bg-emerald-50 ring-1 ring-emerald-300' : 'bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <input
                            type="checkbox"
                            checked={Boolean(line)}
                            onChange={() => toggleGroup(group)}
                            className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer flex-shrink-0"
                            title="Выбрать позицию в корзину saletennis.com"
                          />
                          <span className="font-bold text-xs text-gray-800 bg-white border border-gray-200 rounded px-2 py-0.5">
                            {group.size}
                          </span>
                          <span className="text-xs text-gray-500">
                            нужно в <b className="text-gray-700">{shortStoreLabel(group.toStore)}</b>{' '}
                            (сейчас {group.toQty})
                          </span>
                          {mi && (
                            <span
                              className="text-[10px] font-bold text-amber-700 bg-amber-100 border border-amber-300 rounded-full px-2 py-0.5"
                              title={
                                mi.store
                                  ? `Минимум по умолчанию для «${group.toStore}»: ${mi.min} шт. (индивидуальный минимум товара его перекрывает)`
                                  : `Минимум для «${group.toStore}»: ${mi.min} шт.`
                              }
                            >
                              ⭐ Минимум {mi.min} (есть {mi.current})
                            </span>
                          )}
                          {group.variants.length > 1 && (
                            <span className="text-[10px] font-semibold text-purple-600 bg-purple-50 border border-purple-200 rounded-full px-2 py-0.5">
                              {group.variants.length} варианта — выберите один
                            </span>
                          )}
                          {/* Счётчик количества — прямо в строке рекомендации */}
                          {line && (
                            <span className="ml-auto flex items-center gap-1.5">
                              <span className="text-[10px] text-emerald-700 whitespace-nowrap">
                                в заказ:
                              </span>
                              <QtyStepper
                                value={line.quantity}
                                onChange={(value) => changeQty(group.key, value)}
                              />
                            </span>
                          )}
                        </div>
                        <div className="space-y-1">
                          {group.variants.map((rec) => {
                            const RouteIcon = ROUTE_ICONS[rec.route];
                            return (
                              <div
                                key={`${rec.fromStoreId}|${rec.size}|${rec.toStoreId}`}
                                className="flex items-center gap-2 flex-wrap text-xs bg-white rounded-lg px-3 py-1.5 border border-gray-100"
                              >
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${ROUTE_STYLES[rec.route]}`}
                                >
                                  <RouteIcon className="w-3 h-3" />
                                  {ROUTE_LABELS[rec.route]}
                                </span>
                                <span className={isWarehouse(rec.fromStore) ? 'text-blue-700 font-medium' : 'text-gray-600'}>
                                  {shortStoreLabel(rec.fromStore)}{' '}
                                  <span className="text-gray-400">({rec.fromQty} шт.)</span>
                                </span>
                                <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
                                <span className="text-gray-600">
                                  {shortStoreLabel(rec.toStore)}{' '}
                                  <span className="text-red-400">({rec.toQty} шт.)</span>
                                </span>
                                <span className="font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5">
                                  везти {rec.quantity}
                                </span>
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${PRIORITY_STYLES[rec.priority]}`}
                                >
                                  {PRIORITY_LABELS[rec.priority]}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {filtered.length === 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 text-center text-gray-500">
          <Package className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p>Нет рекомендаций по выбранным фильтрам</p>
          <p className="text-xs mt-1">
            {spbExpensiveCount > 0 && !showSpbExpensive
              ? 'Возможно, всё скрыто как дорогая логистика из СПб — включите показ выше'
              : profileSummaries.length > 0
                ? 'Возможно, рекомендации скрыты профилями магазинов (🚫 запреты, ⛔ ассортимент, 📴 перемещения) — см. плашку выше'
                : 'Все размеры распределены равномерно'}
          </p>
        </div>
      )}

      {/* Переизбыток */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <button
          onClick={() => setShowOverstock(!showOverstock)}
          className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <Shirt className="w-4 h-4 text-amber-500" />
            Переизбыток в магазинах: &gt;{CITY_EXCESS_TRIGGER - 1} шт. размера (в СПб &gt;
            {SPB_EXCESS_TRIGGER - 1}) — {overstock.length} позиций
          </div>
          {showOverstock ? (
            <ChevronUp className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          )}
        </button>
        {showOverstock && (
          <div className="border-t border-gray-100 p-4 max-h-[400px] overflow-y-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {overstock.slice(0, 200).map((pos, i) => (
                <div
                  key={`${pos.productId}|${pos.storeId}|${pos.size}|${i}`}
                  className="flex items-center justify-between gap-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2"
                >
                  <div className="min-w-0">
                    <button
                      onClick={() => openProductCard(pos.productId)}
                      className="text-xs font-medium text-gray-800 hover:text-blue-600 hover:underline truncate block max-w-full text-left"
                      title={pos.productName}
                    >
                      {pos.productName}
                    </button>
                    <div className="text-[10px] text-gray-500">
                      {shortStoreLabel(pos.storeName)} · размер {pos.size}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-bold text-amber-700">{pos.quantity} шт.</div>
                    <div className="text-[10px] text-amber-600">можно отдать {pos.excess}</div>
                  </div>
                </div>
              ))}
            </div>
            {overstock.length > 200 && (
              <p className="text-xs text-gray-400 text-center mt-3">
                Показаны первые 200 из {overstock.length}
              </p>
            )}
            {overstock.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-4">
                Переизбытка в магазинах нет
              </p>
            )}
          </div>
        )}
      </div>

      {/* Окно заказа: считается из выбранных позиций ВЖИВУЮ — количество можно
          править и удалять на месте, кнопки всегда берут свежие числа */}
      {orderOpen && (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/50"
          onClick={() => (cartBusy ? undefined : setOrderOpen(false))}
          role="dialog"
          aria-modal="true"
          aria-label="Заказ на saletennis.com"
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-1">
              <h3 className="text-lg font-bold text-gray-800">
                🛒 Заказ: {order.count} поз. · {order.units} шт.
              </h3>
              <button
                onClick={() => setOrderOpen(false)}
                disabled={cartBusy !== null}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 disabled:opacity-50"
                aria-label="Закрыть"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Список считается из выбранных позиций вживую: поправьте количество или удалите
              позицию здесь — «Открыть корзину со списком», «⚡ Авто-добавление» и «Скопировать
              список» возьмут свежие числа. Корзина saletennis.com привязана к <b>сессии вашего
              браузера</b>, поэтому товары добавляет кнопка-закладка.
            </p>

            {/* Позиции заказа с количеством */}
            <div className="rounded-xl border border-gray-200 divide-y divide-gray-100 mb-3 max-h-64 overflow-y-auto">
              {order.items.length === 0 && order.missing.length === 0 && (
                <p className="text-xs text-gray-400 p-3">Нечего заказывать — отметьте позиции</p>
              )}
              {[...selected.values()].map((line) => {
                const resolved = order.items.find(
                  (item) => item.name === line.name && item.sizeLabel === line.size
                );
                return (
                  <div key={line.key} className="flex items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-gray-800 truncate" title={line.name}>
                        {line.name}
                      </div>
                      <div className="text-[10px] text-gray-500">
                        размер {line.size} → {line.toStore}
                        {resolved && resolved.count !== line.quantity && (
                          <span className="text-blue-600">
                            {' '}
                            · в корзине сайта суммарно: {resolved.count} шт.
                          </span>
                        )}
                        {!resolved && <span className="text-amber-600"> · нет данных корзины</span>}
                      </div>
                    </div>
                    <QtyStepper value={line.quantity} onChange={(v) => changeQty(line.key, v)} />
                    <button
                      onClick={() => setSelected((prev) => removeLine(prev, line.key))}
                      className="flex-shrink-0 p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                      title="Убрать позицию из заказа"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 mb-3">
              <div className="text-xs font-semibold text-emerald-800 mb-1.5">
                Кнопка-закладка — без паролей и cookie
              </div>
              <ol className="text-[11px] text-gray-600 leading-relaxed space-y-1 mb-2.5 list-decimal list-inside">
                <li>
                  Один раз: перетащите тёмную кнопку ниже на <b>панель закладок</b> браузера
                  (не видно панель? Ctrl+Shift+B);
                </li>
                <li>Нажмите «Открыть корзину со списком» — откроется вкладка saletennis.com;</li>
                <li>
                  На ней нажмите закладку <b>«🛒 SaleTennis Заказ»</b> — появится плашка
                  «Добавляю 1 из N…», товары лягут в корзину, и она обновится сама.
                </li>
              </ol>
              <div className="flex gap-2 flex-wrap items-center">
                <a
                  href={ORDER_BOOKMARKLET}
                  onClick={(e) => e.preventDefault()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white rounded-xl text-sm font-semibold cursor-grab select-none"
                  title="Перетащите меня на панель закладок (не нажимать!)"
                >
                  🛒 SaleTennis Заказ
                </a>
                <button
                  onClick={openCart}
                  disabled={order.items.length === 0}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl text-sm font-semibold transition-colors"
                  title={`Открыть корзину saletennis.com со списком (${order.count} поз. · ${order.units} шт.)`}
                >
                  Открыть корзину со списком →
                </button>
                <button
                  onClick={() => void sendToCart()}
                  disabled={cartBusy !== null || order.items.length === 0}
                  className="px-3 py-2 bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 rounded-xl text-xs whitespace-nowrap transition-colors"
                  title="Добавить автоматически через сохранённую 🔑-сессию"
                >
                  {cartBusy ?? '⚡ Авто-добавление'}
                </button>
              </div>
              <p className="text-[10px] text-gray-400 mt-2">
                Вход на сайт не обязателен: гостевая корзина тоже «прилипает» к вашему браузеру —
                войдёте и оформите заказ позже.
              </p>
            </div>

            {order.missingCount > 0 && (
              <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Ещё {order.missingCount} поз. не добавятся автоматически (нет данных в карте
                корзины): {order.missing.slice(0, 3).map((m) => `${m.line.name} (${m.line.size})`).join(', ')}
                {order.missingCount > 3 ? '…' : ''}
              </p>
            )}

            <div className="mt-5 flex items-center gap-2 justify-end">
              <button
                onClick={() => void copyList()}
                className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl text-xs"
              >
                Скопировать список
              </button>
              <button
                onClick={() => setOrderOpen(false)}
                disabled={cartBusy !== null}
                className="px-4 py-2 bg-gray-900 hover:bg-gray-700 disabled:opacity-50 text-white rounded-xl text-sm font-medium"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Плавающая панель корзины + ввод сессии + сообщения.
          Скрыта, пока открыто окно заказа, — раньше она лежала поверх окна и
          правка количества не попадала в ссылку для закладки. */}
      {((selected.size > 0 && !orderOpen) || showSessionInput || cartMessage) && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[120] flex flex-col items-center gap-2 w-full max-w-[96vw] px-2 pointer-events-none">
          {cartMessage && (
            <div
              className={`pointer-events-auto px-4 py-2.5 rounded-xl shadow-lg text-xs font-medium flex items-center gap-3 max-w-full ${
                cartMessage.error ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'
              }`}
            >
              <span className="truncate">{cartMessage.text}</span>
              <button
                onClick={() => setCartMessage(null)}
                className="opacity-70 hover:opacity-100 flex-shrink-0"
                aria-label="Закрыть сообщение"
              >
                ✕
              </button>
            </div>
          )}
          {showSessionInput && (
            <div className="pointer-events-auto bg-white rounded-2xl shadow-2xl border border-gray-200 px-5 py-4 w-[540px] max-w-full">
              <div className="text-sm font-semibold text-gray-800 mb-1.5">
                🔑 Сессия saletennis.com (один раз)
              </div>
              <p className="text-[11px] text-gray-500 mb-2.5 leading-relaxed">
                Войдите в saletennis.com в этом браузере → расширение <b>Cookie-Editor</b> →
                Export → найдите cookie <b>PHPSESSID</b> → скопируйте её значение сюда.
                Значение хранится только в этом браузере и используется лишь для добавления
                товаров в вашу корзину.
              </p>
              <div className="flex gap-2">
                <input
                  value={sessionDraft}
                  onChange={(e) => setSessionDraft(e.target.value)}
                  placeholder="значение PHPSESSID"
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={saveSession}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                >
                  Сохранить
                </button>
                <button
                  onClick={() => setShowSessionInput(false)}
                  className="px-3 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm hover:bg-gray-200"
                >
                  Закрыть
                </button>
              </div>
            </div>
          )}
          {selected.size > 0 && !orderOpen && (
            <div className="pointer-events-auto bg-gray-900 text-white rounded-2xl shadow-2xl px-5 py-3.5 flex flex-col gap-2.5 w-[640px] max-w-full">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm whitespace-nowrap">
                  🛒 Выбрано: <b>{selected.size}</b> поз. · <b>{totalUnits}</b> шт.
                </span>
                <button
                  onClick={() => setSelected(new Map())}
                  className="px-2.5 py-1 bg-white/10 hover:bg-white/20 rounded-lg text-xs whitespace-nowrap"
                >
                  Сбросить всё
                </button>
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1 pr-1 -mr-1">
                {[...selected.values()].map((line) => (
                  <div
                    key={line.key}
                    className="flex items-center gap-2 text-xs bg-white/5 rounded-lg px-2.5 py-1.5"
                  >
                    <span className="truncate flex-1 min-w-0" title={line.name}>
                      {line.name}
                    </span>
                    <span className="text-gray-300 whitespace-nowrap">разм. {line.size}</span>
                    <span className="text-gray-400 whitespace-nowrap">
                      → {shortStoreLabel(line.toStore)}
                    </span>
                    <QtyStepper
                      value={line.quantity}
                      onChange={(value) => changeQty(line.key, value)}
                      dark
                    />
                    <button
                      onClick={() => setSelected((prev) => removeLine(prev, line.key))}
                      className="flex-shrink-0 text-gray-400 hover:text-white px-1"
                      title="Убрать позицию"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={goOrder}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 rounded-xl text-sm font-semibold whitespace-nowrap transition-colors"
                  title="Открыть окно заказа: список, количества и кнопка-закладка"
                >
                  Перейти к заказу →
                </button>
                <button
                  onClick={() => void sendToCart()}
                  disabled={cartBusy !== null}
                  className="px-3 py-2 bg-white/10 hover:bg-white/20 disabled:opacity-60 disabled:cursor-wait rounded-xl text-xs whitespace-nowrap transition-colors"
                  title="Добавить автоматически через сохранённую 🔑-сессию (без кнопки-закладки)"
                >
                  {cartBusy ?? '⚡ Авто-добавление'}
                </button>
                <button
                  onClick={() => void copyList()}
                  className="px-3 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-xs whitespace-nowrap"
                >
                  Скопировать список
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {selectedProduct && (
        <ProductCardModal productId={selectedProduct} onClose={() => closeProductCard()} />
      )}
    </div>
  );
}
