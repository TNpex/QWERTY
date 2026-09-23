// Типы данных для BI-аналитики

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
}

export type RestockUrgency = 'critical' | 'high' | 'medium';

export interface RestockRecommendation {
  productId: string;
  productName: string;
  productLink?: string;
  brand: string;
  category: string;
  sizes: {
    size: string;
    /** Сколько не хватает до норматива */
    quantity: number;
    /** Сколько из недостающего покрывается перемещением (склад/избытки) */
    transferCover: number;
    /** Сколько нужно заказать у поставщика */
    toPurchase: number;
  }[];
  /** Сколько единиц не хватает до норматива (MIN_PER_STORE на каждый возящий магазин) */
  totalNeeded: number;
  /** Сколько из недостающего можно покрыть перемещением (склад / избытки магазинов) */
  transferCover: number;
  /** Сколько реально нужно заказать у поставщика (totalNeeded − transferCover) */
  toPurchase: number;
  /** Текущий суммарный остаток по магазинам, которые возят товар, шт. */
  currentStock: number;
  /** Покрытие норматива запасом, 0..100 (%) */
  coveragePercent: number;
  /**
   * Детерминированная срочность (без случайных чисел):
   * - critical: товар полностью отсутствует во всех возящих магазинах;
   * - high: покрытие норматива < 50% либо более половины размеров с нулём;
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
