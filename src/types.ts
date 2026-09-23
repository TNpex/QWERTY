// Типы данных для BI-аналитики

import type { Gender } from './utils/productMeta';

export interface Store {
  id: string;
  name: string;
}

export interface Product {
  id: string;
  name: string;
  brand: string;
  category: string;
  price: number;
  article?: string;
  /** Ссылка на страницу товара (saletennis.com) — стабильный уникальный идентификатор */
  link?: string;
  /** Имя файла фотографии из колонки «Фото» (лежит в public/data/product_images/) */
  photo?: string;
  /** Пол/возраст, определённый по названию: женский, мужской, детский, унисекс */
  gender?: Gender;
  /** Подтип одежды (Носки, Футболки и поло, Шорты, ...) — для фильтра перемещений */
  subtype?: string;
}

export interface InventoryItem {
  productId: string;
  storeId: string;
  size: string;
  quantity: number;
  /**
   * true — магазин НЕ возит эту позицию (пустая ячейка в файле либо
   * магазин вообще не упоминается в данных товара).
   * Такие строки не участвуют в метрике «нет в наличии» (OOS)
   * и в рекомендациях по перемещению — это не дефицит, а отсутствие
   * товара в ассортименте точки.
   */
  notCarried?: boolean;
  lastUpdated: string;
}

export type TransferPriority = 'high' | 'medium' | 'low';

/** Маршрут перемещения (см. utils/storeGroups.ts) */
export type TransferRoute = 'warehouse' | 'same-city' | 'intercity' | 'spb-expensive';

export interface TransferRecommendation {
  productId: string;
  productName: string;
  productLink?: string;
  brand: string;
  category: string;
  /** Подтип одежды (Носки, Футболки и поло, Шорты, ...) — для фильтра перемещений */
  subtype?: string;
  fromStore: string;
  fromStoreId: string;
  toStore: string;
  toStoreId: string;
  size: string;
  quantity: number;
  reason: string;
  priority: TransferPriority;
  /** Маршрут: склад→магазин, внутри города, между городами, из СПб (дорого) */
  route: TransferRoute;
  /** Текущий остаток этого размера у донора (до перемещения) */
  fromQty: number;
  /** Текущий остаток этого размера у получателя */
  toQty: number;
  /**
   * Ключ группы вариантов: один дефицит может закрываться из нескольких
   * источников (магазин ИЛИ склад) — UI показывает их как альтернативы.
   */
  optionGroup: string;
}

export type RestockUrgency = 'critical' | 'high' | 'medium';

export interface RestockRecommendation {
  productId: string;
  productName: string;
  productLink?: string;
  brand: string;
  category: string;
  subtype?: string;
  gender: Gender;
  sizes: {
    /** Размер (или «сет»/«банка»/«—» для безразмерных) */
    size: string;
    /** Сколько заказать до норматива */
    quantity: number;
    /** Норматив сети на этот размер (из таблиц минимумов) */
    target: number;
    /** Текущий остаток по всей сети */
    current: number;
  }[];
  /** Суммарно заказать по всем размерам */
  totalNeeded: number;
  /** @deprecated норматив теперь общесетевой — покрытие перемещением не требуется */
  transferCover: number;
  /** = totalNeeded (норматив считается по всей сети, включая склад) */
  toPurchase: number;
  /** Текущий суммарный остаток по всей сети */
  currentStock: number;
  /** Покрытие суммы нормативов текущим остатком, 0..100 (%) */
  coveragePercent: number;
  /**
   * Детерминированная срочность:
   * - critical: товара нет ни в одном магазине сети;
   * - high: покрытие нормативов < 50% или более половины размеров с нулём;
   * - medium: остальное.
   */
  urgency: RestockUrgency;
}

/** Формат исходного файла: «длинный» (строка на остаток) или «широкий» (магазины-колонки) */
export type FileFormat = 'long' | 'wide';

export interface ParsedData {
  stores: Store[];
  products: Product[];
  inventory: InventoryItem[];
  /** Момент загрузки файла (ISO-строка) */
  uploadedAt?: string;
  /** Определённый парсером формат файла */
  format?: FileFormat;
  /** Предупреждения парсера (пропущенные строки, нераспознанные магазины и т.п.) */
  warnings?: string[];
  /** Источник данных: встроенный набор (public/data) или загруженный пользователем файл */
  source?: 'bundled' | 'upload';
  /** Дата снимка остатков (для встроенных данных — дата последнего парсинга) */
  asOf?: string;
}
