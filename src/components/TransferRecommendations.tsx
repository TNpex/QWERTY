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
} from 'lucide-react';
import { useFilteredData, useTransferRecommendations } from '../hooks/useAnalytics';
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
import { productSettingsKey } from '../utils/sport';
import {
  resolveCartItems,
  cartLinesToText,
  orderUrl,
  ORDER_BOOKMARKLET,
  SALETENNIS_CART_URL,
  type CartItemPayload,
  type CartLine,
} from '../utils/cart';
import {
  loadCredentials,
  saveCredentials,
  clearCredentials,
  type SaletennisCredentials,
} from '../utils/saletennisAuth';
import { ProductCardModal } from './ProductCardModal';
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
  toQty: number;
  variants: TransferRecommendation[];
}

type MyScope = 'incoming' | 'outgoing' | 'all';

export function TransferRecommendations() {
  const data = useFilteredData();
  const recommendations = useTransferRecommendations();
  const { storeProfile, settings, cartMap, saletennisSession, setSaletennisSession } = useData();
  const [myScope, setMyScope] = useState<MyScope>('all');
  // Корзина: выбранные позиции (ключ группы → строка), отправка, сессия
  const [selected, setSelected] = useState<Map<string, CartLine>>(new Map());
  const [cartBusy, setCartBusy] = useState<string | null>(null);
  const [cartMessage, setCartMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [showSessionInput, setShowSessionInput] = useState(false);
  const [sessionDraft, setSessionDraft] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  // Модальное окно заказа: позиции, вход на сайт, ошибки
  const [orderPayload, setOrderPayload] = useState<{
    url: string;
    items: CartItemPayload[];
    count: number;
    units: number;
    missingCount: number;
  } | null>(null);
  const [orderBusy, setOrderBusy] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [credLogin, setCredLogin] = useState('');
  const [credPassword, setCredPassword] = useState('');
  const [credRemember, setCredRemember] = useState(true);
  const [toStoreId, setToStoreId] = useState('all');
  const [fromStoreId, setFromStoreId] = useState('all');
  const [selectedSubtype, setSelectedSubtype] = useState('all');
  const [showSpbExpensive, setShowSpbExpensive] = useState(false);
  const [showOverstock, setShowOverstock] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);

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

  // ⭐ Минимумы «Моего магазина»: нехватка до минимума поднимается первой
  const productsById = useMemo(
    () => new Map((data?.products ?? []).map((p) => [p.id, p])),
    [data]
  );
  const profileMinimums = useMemo(
    () => (storeProfile ? settings.storeMinimums[storeProfile] ?? {} : {}),
    [storeProfile, settings]
  );
  const getMinInfo = useCallback(
    (rec: TransferRecommendation | undefined): { min: number; current: number } | null => {
      if (!rec || !profileStoreId || rec.toStoreId !== profileStoreId) return null;
      const product = productsById.get(rec.productId);
      if (!product) return null;
      const min = profileMinimums[productSettingsKey(product)];
      if (!min || min <= 0 || rec.toQty >= min) return null;
      return { min, current: rec.toQty };
    },
    [profileStoreId, productsById, profileMinimums]
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
    const byProduct = new Map<
      string,
      { productId: string; productName: string; productLink?: string; groups: Map<string, OptionGroupView> }
    >();
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
        group = { key: rec.optionGroup, size: rec.size, toStore: rec.toStore, toQty: rec.toQty, variants: [] };
        product.groups.set(rec.optionGroup, group);
      }
      group.variants.push(rec);
    }
    return [...byProduct.values()].slice(0, MAX_TRANSFER_DISPLAY);
  }, [filtered]);

  // Товары с нехваткой до минимума «моего магазина» — первыми (сортировка устойчивая)
  const sortedProductGroups = useMemo(() => {
    if (!profileStoreId) return productGroups;
    const weight = (g: (typeof productGroups)[number]) =>
      [...g.groups.values()].some((gr) => getMinInfo(gr.variants[0])) ? 0 : 1;
    return [...productGroups].sort((a, b) => weight(a) - weight(b));
  }, [productGroups, profileStoreId, getMinInfo]);

  // ---- Корзина: выбор позиций и отправка на saletennis.com ----
  const totalUnits = useMemo(
    () => [...selected.values()].reduce((sum, line) => sum + line.quantity, 0),
    [selected]
  );

  const toggleLine = (group: OptionGroupView) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(group.key)) {
        next.delete(group.key);
        return next;
      }
      const rec = group.variants[0];
      next.set(group.key, {
        key: group.key,
        name: rec.productName,
        ...(rec.productLink ? { link: rec.productLink } : {}),
        size: group.size,
        quantity: Math.max(1, rec.quantity),
        toStore: group.toStore,
      });
      return next;
    });
  };

  const changeQty = (key: string, value: number) => {
    setSelected((prev) => {
      const line = prev.get(key);
      if (!line) return prev;
      const next = new Map(prev);
      next.set(key, { ...line, quantity: Math.max(1, Math.min(99, Math.round(value) || 1)) });
      return next;
    });
  };

  /**
   * Основной сценарий (без cookie): открыть корзину saletennis.com со списком
   * в #stcart — там пользователь жмёт кнопку-закладку, и товары добавляются
   * под ЕГО собственным логином. Не залогинен — сайт попросит войти, список
   * сохранится (кнопка-закладка запомнит его в localStorage страницы).
   */
  /**
   * Отправка заказа: серверная функция входит на saletennis.com под учёткой
   * пользователя (или использует 🔑-сессию) и добавляет все позиции в корзину
   * аккаунта. Затем корзина открывается в новой вкладке — уже наполненная.
   */
  const runOrder = async (items: CartItemPayload[], creds: SaletennisCredentials | null) => {
    setOrderError(null);
    setCartMessage(null);
    setOrderBusy(creds ? 'Вхожу на saletennis.com…' : 'Добавляю в корзину…');
    try {
      let sessionToken = '';
      let added = 0;
      let failed = 0;
      let cartLines: number | null = null;
      const errors: string[] = [];
      const CHUNK = 150;
      for (let i = 0; i < items.length; i += CHUNK) {
        const chunk = items.slice(i, i + CHUNK);
        setOrderBusy(`Добавляю в корзину ${Math.min(i + CHUNK, items.length)}/${items.length}…`);
        const payload: Record<string, unknown> = {
          items: chunk.map((it) => ({
            itemId: it.itemId,
            count: it.count,
            size: it.size,
            name: it.name,
          })),
        };
        if (i === 0 && creds) {
          payload.login = creds.login;
          payload.password = creds.password;
        } else if (sessionToken) {
          payload.cookie = sessionToken;
        } else if (i === 0 && saletennisSession.trim()) {
          payload.cookie = saletennisSession.trim();
        } else {
          setOrderError('Нет способа авторизации — укажите логин/пароль или 🔑-сессию');
          return;
        }
        const resp = await fetch('/api/saletennis-cart', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (resp.status === 404) {
          setOrderError(
            'Автозаказ работает только на опубликованном сайте (Vercel). В локальной сборке используйте «Скопировать список».'
          );
          return;
        }
        const data = (await resp.json().catch(() => null)) as {
          added?: number;
          failed?: number;
          cartLines?: number;
          loginFailed?: boolean;
          unauthorized?: boolean;
          sessionToken?: string;
          error?: string;
          results?: { name: string; ok: boolean; error?: string }[];
        } | null;
        if (!data) {
          setOrderError(`Сервер ответил ошибкой (HTTP ${resp.status})`);
          return;
        }
        if (data.loginFailed) {
          setOrderError(
            data.error ??
              'Не удалось войти на saletennis.com — проверьте логин и пароль (они такие же, как при входе на сайт)'
          );
          return;
        }
        if (data.unauthorized) {
          setOrderError(
            data.error ?? 'Сессия saletennis.com недействительна — укажите логин/пароль заново'
          );
          return;
        }
        if (data.sessionToken) sessionToken = data.sessionToken;
        if (typeof data.cartLines === 'number') cartLines = data.cartLines;
        added += data.added ?? 0;
        failed += data.failed ?? 0;
        for (const r of data.results ?? []) {
          if (!r.ok && r.error) errors.push(`${r.name}: ${r.error}`);
        }
      }
      window.open(SALETENNIS_CART_URL, '_blank', 'noopener');
      setOrderPayload(null);
      setSelected(new Map());
      setCartMessage({
        text:
          `Добавлено в корзину: ${added} из ${items.length}` +
          (failed > 0 ? ` (с ошибками: ${failed} — ${errors.slice(0, 2).join('; ')})` : '') +
          (cartLines !== null ? ` · в корзине на сайте сейчас ${cartLines} поз.` : '') +
          ' — корзина открыта, оформляйте заказ!',
        error: failed > 0 || added === 0,
      });
    } catch (e) {
      setOrderError(String(e));
    } finally {
      setOrderBusy(null);
    }
  };

  const goOrder = () => {
    const lines = [...selected.values()];
    if (lines.length === 0 || orderBusy) return;
    const { items, missing } = resolveCartItems(cartMap, lines);
    if (items.length === 0) {
      setCartMessage({
        text: `Не удалось собрать заказ: ${missing[0]?.reason ?? 'нет данных корзины'}. Используйте «Скопировать список».`,
        error: true,
      });
      return;
    }
    if (missing.length > 0) {
      navigator.clipboard
        ?.writeText(cartLinesToText(missing.map((m) => m.line)))
        .catch(() => undefined);
    }
    const payload = {
      url: orderUrl(items),
      items,
      count: items.length,
      units: items.reduce((sum, i) => sum + i.count, 0),
      missingCount: missing.length,
    };
    setOrderPayload(payload);
    setOrderError(null);
    const saved = loadCredentials();
    if (saved) {
      // учётка запомнена — заказ одним нажатием, без окна
      void runOrder(items, saved);
      return;
    }
    setCredLogin('');
    setCredPassword('');
    setCredRemember(true);
  };

  const submitFromModal = () => {
    if (!orderPayload || orderBusy) return;
    const login = credLogin.trim();
    if (!login || !credPassword) {
      setOrderError('Введите логин (e-mail) и пароль от saletennis.com');
      return;
    }
    const creds = { login, password: credPassword };
    if (credRemember) saveCredentials(creds);
    else clearCredentials();
    void runOrder(orderPayload.items, creds);
  };

  const copyList = async () => {
    const text = cartLinesToText([...selected.values()]);
    try {
      await navigator.clipboard.writeText(text);
      setCartMessage({ text: 'Список скопирован в буфер обмена', error: false });
    } catch {
      setCartMessage({ text: 'Не удалось скопировать — разрешите доступ к буферу', error: true });
    }
  };

  const sendToCart = async () => {
    const lines = [...selected.values()];
    if (lines.length === 0 || cartBusy) return;
    const { items, missing } = resolveCartItems(cartMap, lines);
    if (!saletennisSession.trim()) {
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
    }
    const parts = [`Добавлено в корзину: ${added} из ${items.length}`];
    if (missing.length > 0) {
      parts.push(`${missing.length} позиций без данных корзины — список скопирован в буфер`);
      navigator.clipboard
        ?.writeText(cartLinesToText(missing.map((m) => m.line)))
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
            (оставляет {SPB_DONOR_KEEP}); перемещаем туда, где позиции <b>0 или 1</b>.{' '}
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
              <b>Основной способ (одним нажатием):</b> «Перейти к заказу» → введите логин и
              пароль от saletennis.com (те же, что на сайте) и отметьте «Запомнить» → товары
              добавятся в корзину вашего аккаунта, и она откроется сама. Со следующего раза —
              просто «Перейти к заказу», без окна.
            </p>
            <p>
              <b>Способ без пароля — кнопка-закладка.</b> Одноразово перетащите кнопку ниже на{' '}
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
              <b>Как заказывать закладкой:</b> 1) отметьте позиции и количество → 2) «Перейти
              к заказу» → в окне раскройте «Другие способы» → «Открыть корзину со списком» →
              3) на открытой странице нажмите закладку «🛒 SaleTennis Заказ» — товары добавятся{' '}
              <b>под вашим браузерным логином</b> (не вошли? войдите и нажмите ещё раз) →
              4) оформляйте заказ.
            </p>
            <p className="text-gray-400">
              Альтернатива без закладки — «⚡ Авто-добавление» через 🔑-сессию (полностью
              автоматически, но значение PHPSESSID придётся обновлять, когда сайт разлогинит).
            </p>
          </div>
        </div>
      )}

      {/* Карточки товаров */}
      <div className="space-y-3">
        {sortedProductGroups.map((product) => {
          const storeTotals = productStoreTotals.get(product.productId);
          const brand = data.products.find((p) => p.id === product.productId)?.brand ?? '';
          return (
            <div
              key={product.productId}
              className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <button
                    onClick={() => setSelectedProduct(product.productId)}
                    className="font-medium text-sm text-gray-800 hover:text-blue-600 hover:underline text-left"
                    title="Открыть карточку товара"
                  >
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
                {[...product.groups.values()].map((group) => (
                  <div
                    key={group.key}
                    className={`rounded-lg px-3 py-2 ${
                      selected.has(group.key)
                        ? 'bg-emerald-50 ring-1 ring-emerald-300'
                        : 'bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <input
                        type="checkbox"
                        checked={selected.has(group.key)}
                        onChange={() => toggleLine(group)}
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
                      {(() => {
                        const mi = getMinInfo(group.variants[0]);
                        return mi ? (
                          <span
                            className="text-[10px] font-bold text-amber-700 bg-amber-100 border border-amber-300 rounded-full px-2 py-0.5"
                            title={`Минимум для «${storeProfile}»: ${mi.min} шт.`}
                          >
                            ⭐ Минимум {mi.min} (есть {mi.current})
                          </span>
                        ) : null;
                      })()}
                      {group.variants.length > 1 && (
                        <span className="text-[10px] font-semibold text-purple-600 bg-purple-50 border border-purple-200 rounded-full px-2 py-0.5">
                          {group.variants.length} варианта — выберите один
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
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 text-center text-gray-500">
          <Package className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p>Нет рекомендаций по выбранным фильтрам</p>
          <p className="text-xs mt-1">
            {spbExpensiveCount > 0 && !showSpbExpensive
              ? 'Возможно, всё скрыто как дорогая логистика из СПб — включите показ выше'
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
                      onClick={() => setSelectedProduct(pos.productId)}
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

      {/* Модальное окно заказа: вход на saletennis.com и добавление в корзину */}
      {orderPayload && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50"
          onClick={() => (orderBusy ? undefined : setOrderPayload(null))}
          role="dialog"
          aria-modal="true"
          aria-label="Заказ на saletennis.com"
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-xl w-full p-6 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-800 mb-1">
              🛒 Заказ: {orderPayload.count} поз. · {orderPayload.units} шт.
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Товары добавятся в корзину <b>вашего аккаунта</b> saletennis.com — как если бы
              вы нажимали «В корзину» на сайте вручную. После этого откроется корзина для
              оформления.
            </p>

            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 mb-3">
              <div className="text-xs font-semibold text-emerald-800 mb-1.5">
                Способ 1 — кнопка-закладка (без пароля, работает всегда)
              </div>
              <p className="text-[11px] text-gray-600 leading-relaxed mb-2.5">
                <b>Один раз:</b> перетащите тёмную кнопку ниже на панель закладок браузера
                (Ctrl+Shift+B, если панели не видно). <b>Каждый заказ:</b> нажмите «Открыть
                корзину» → на открывшейся странице нажмите закладку «🛒 SaleTennis Заказ» →
                товары добавятся (войдя под своим логином — в корзину аккаунта; без входа —
                в гостевую корзину, после входа проверьте её).
              </p>
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
                  onClick={() => window.open(orderPayload.url, '_blank', 'noopener')}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-semibold transition-colors"
                >
                  Открыть корзину со списком →
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-4">
              <div className="text-xs font-semibold text-gray-700 mb-3">
                Способ 2 — автоматически по логину/паролю saletennis.com
              </div>
              <div className="space-y-2.5">
                <input
                  type="text"
                  value={credLogin}
                  onChange={(e) => setCredLogin(e.target.value)}
                  placeholder="Логин (e-mail) на saletennis.com"
                  autoComplete="username"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 bg-white"
                />
                <input
                  type="password"
                  value={credPassword}
                  onChange={(e) => setCredPassword(e.target.value)}
                  placeholder="Пароль"
                  autoComplete="current-password"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitFromModal();
                  }}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 bg-white"
                />
                <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={credRemember}
                    onChange={(e) => setCredRemember(e.target.checked)}
                    className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  Запомнить на этом компьютере — дальше заказ будет формироваться одним
                  нажатием «Перейти к заказу», без этого окна
                </label>
                {orderError && (
                  <div className="text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {orderError}
                  </div>
                )}
                <button
                  onClick={submitFromModal}
                  disabled={orderBusy !== null}
                  className="w-full px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-wait text-white rounded-xl text-sm font-semibold transition-colors"
                >
                  {orderBusy ?? 'Добавить в корзину и открыть saletennis.com →'}
                </button>
                <p className="text-[10px] text-gray-400 leading-relaxed">
                  🔒 Пароль передаётся только сайту saletennis.com (через защищённый серверный
                  модуль дашборда) и не сохраняется на сервере. «Запомнить» хранит его лишь
                  в этом браузере; снять — уберите галочку или очистите настройки сайта.
                  {orderPayload.missingCount > 0 && (
                    <>
                      {' '}Ещё {orderPayload.missingCount} поз. без данных карты корзины —
                      список скопирован в буфер обмена.
                    </>
                  )}
                </p>
              </div>
            </div>

            <p className="mt-3 text-[11px] text-gray-400">
              Способ 3 (альтернатива закладке): «🔑 Корзина saletennis» рядом с фильтрами →
              вставить значение cookie PHPSESSID → «⚡ Авто-добавление» в нижней панели.
            </p>

            <div className="mt-5 flex items-center gap-2 justify-end">
              <button
                onClick={copyList}
                className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl text-xs"
              >
                Скопировать список
              </button>
              <button
                onClick={() => setOrderPayload(null)}
                disabled={orderBusy !== null}
                className="px-4 py-2 bg-gray-900 hover:bg-gray-700 disabled:opacity-50 text-white rounded-xl text-sm font-medium"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Плавающая панель корзины + ввод сессии + сообщения */}
      {(selected.size > 0 || showSessionInput || cartMessage) && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 w-full max-w-[96vw] px-2 pointer-events-none">
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
          {selected.size > 0 && (
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
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => changeQty(line.key, line.quantity - 1)}
                        className="w-6 h-6 rounded bg-white/10 hover:bg-white/25 font-bold"
                        title="Меньше"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={line.quantity}
                        onChange={(e) => changeQty(line.key, Number(e.target.value))}
                        className="w-12 h-6 text-center rounded bg-white/10 border border-white/20 text-white text-xs focus:ring-1 focus:ring-emerald-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        title="Сколько заказать"
                      />
                      <button
                        onClick={() => changeQty(line.key, line.quantity + 1)}
                        className="w-6 h-6 rounded bg-white/10 hover:bg-white/25 font-bold"
                        title="Больше"
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={goOrder}
                  disabled={orderBusy !== null}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-wait rounded-xl text-sm font-semibold whitespace-nowrap transition-colors"
                  title="Добавить выбранные позиции в корзину saletennis.com и открыть её"
                >
                  {orderBusy ?? 'Перейти к заказу →'}
                </button>
                <button
                  onClick={sendToCart}
                  disabled={cartBusy !== null}
                  className="px-3 py-2 bg-white/10 hover:bg-white/20 disabled:opacity-60 disabled:cursor-wait rounded-xl text-xs whitespace-nowrap transition-colors"
                  title="Добавить автоматически через сохранённую 🔑-сессию (без кнопки-закладки)"
                >
                  {cartBusy ?? '⚡ Авто-добавление'}
                </button>
                <button
                  onClick={copyList}
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
        <ProductCardModal productId={selectedProduct} onClose={() => setSelectedProduct(null)} />
      )}
    </div>
  );
}
