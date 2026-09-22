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
}

export interface InventoryItem {
  productId: string;
  storeId: string;
  size: string;
  quantity: number;
  lastUpdated: string;
}

export interface TransferRecommendation {
  productId: string;
  productName: string;
  fromStore: string;
  toStore: string;
  size: string;
  quantity: number;
  reason: string;
  priority: 'high' | 'medium' | 'low';
}

export interface RestockRecommendation {
  productId: string;
  productName: string;
  brand: string;
  sizes: { size: string; quantity: number }[];
  totalNeeded: number;
  urgency: 'critical' | 'high' | 'medium';
  avgDailySales: number;
  daysUntilStockout: number;
}

export interface ParsedData {
  stores: Store[];
  products: Product[];
  inventory: InventoryItem[];
}
