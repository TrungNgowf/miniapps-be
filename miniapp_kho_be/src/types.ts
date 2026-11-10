export interface Location {
  locationId: string;
  /** Tenant sở hữu. Người dùng chỉ thấy địa điểm thuộc tenant của mình hoặc tenant con. */
  tenantId: string;
  kind: 'store' | 'warehouse';
  name: string;
  address: string;
  district: string;
  province: string;
  openedAt: string;
}

export interface PricePoint {
  date: string;
  price: number;
}

export interface Product {
  sku: string;
  barcode: string;
  name: string;
  brand: string;
  category: string;
  unit: string;
  /** Quy cách đóng gói, ví dụ "1L", "Lốc 4 hộp" */
  pack: string;
  /** Số đơn vị lẻ trong một quy cách bán, 1 với hàng lẻ */
  packQty: number;
  price: number;
  cost: number;
  vat: number;
  imageId: string;
  priceHistory: PricePoint[];
}

export interface StockRow {
  qty: number;
  min: number;
}

export type MovementType = 'RECEIPT' | 'SALE' | 'ADJUST' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'WASTE';

export interface Movement {
  id: string;
  ts: string;
  locationId: string;
  sku: string;
  type: MovementType;
  /** Dương là nhập, âm là xuất */
  qty: number;
  qtyAfter: number;
  ref?: string;
  note?: string;
  by: string;
}

export interface DailySales {
  date: string;
  locationId: string;
  category: string;
  revenue: number;
  units: number;
  orders: number;
}

export type TransferStatus = 'REQUESTED' | 'APPROVED' | 'SHIPPED' | 'RECEIVED' | 'REJECTED' | 'CANCELLED';

export interface TransferLine {
  sku: string;
  qty: number;
  /** Số thực nhận, chỉ có khi đã nhận hàng */
  receivedQty?: number;
}

export interface TransferEvent {
  ts: string;
  status: TransferStatus;
  by: string;
  note?: string;
}

export interface Transfer {
  id: string;
  fromLocationId: string;
  toLocationId: string;
  status: TransferStatus;
  lines: TransferLine[];
  note: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  events: TransferEvent[];
}

export interface Principal {
  userId: string;
  username: string;
  fullName: string;
  tenantId: string;
  tenantName: string;
  roles: string[];
}

export type Capability =
  | 'stock.read'
  | 'stock.write'
  | 'stock.minimum'
  | 'transfer.request'
  | 'transfer.receive'
  | 'transfer.approve';

export type MutationEvent =
  | { t: 'movement'; m: Movement; requestId?: string }
  | { t: 'transfer'; tr: Transfer }
  | { t: 'minimum'; locationId: string; sku: string; min: number };
