import fs from 'node:fs';
import path from 'node:path';
import { ApiError } from './errors.js';
import type {
  DailySales,
  Location,
  Movement,
  MovementType,
  MutationEvent,
  PricePoint,
  Product,
  StockRow,
  Transfer,
  TransferStatus,
} from './types.js';

export type StockStatus = 'out' | 'low' | 'ok';

export interface StockItem {
  sku: string;
  barcode: string;
  name: string;
  brand: string;
  category: string;
  unit: string;
  pack: string;
  packQty: number;
  imageId: string;
  price: number;
  cost: number;
  qty: number;
  min: number;
  status: StockStatus;
  value: number;
  avgDaily: number;
  daysCover: number | null;
}

export interface Actor {
  username: string;
}

const keyOf = (locationId: string, sku: string) => `${locationId}|${sku}`;
const MAX_QTY = 100_000;

export function localDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dayNumber(date: string): number {
  return Math.round(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000);
}

function shiftDate(date: string, days: number): string {
  if (days === 0) return date;
  return new Date((dayNumber(date) + days) * 86_400_000).toISOString().slice(0, 10);
}

function statusOf(qty: number, min: number): StockStatus {
  return qty <= 0 ? 'out' : qty <= min ? 'low' : 'ok';
}

function assertQty(value: unknown, label = 'Số lượng'): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > MAX_QTY) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${label} phải là số nguyên dương`);
  }
  return value;
}

export class Store {
  readonly locations: Location[];
  readonly products: Map<string, Product>;
  readonly productList: Product[];
  readonly priceHistory: Record<string, PricePoint[]>;
  readonly meta: { version: string; generatedAt: string; anchorDate: string; products: number };
  readonly today: string;
  private readonly stock = new Map<string, StockRow>();
  private readonly stockByLocation = new Map<string, Set<string>>();
  private readonly movements: Movement[] = [];
  private readonly movementsByKey = new Map<string, Movement[]>();
  private readonly movementsByLocation = new Map<string, Movement[]>();
  private readonly dailySales: DailySales[];
  private readonly transfers: Transfer[];
  private readonly requestIds = new Map<string, string[]>();
  private readonly logFile: string;
  private writing: Promise<void> = Promise.resolve();
  private seq = 0;

  private constructor(dataDir: string) {
    const read = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8')) as T;
    if (!fs.existsSync(path.join(dataDir, 'meta.json'))) {
      throw new Error(`Chưa có dữ liệu trong ${dataDir}. Chạy "pnpm gen:data" trước.`);
    }
    this.meta = read('meta.json');
    this.today = localDate();
    const shift = dayNumber(this.today) - dayNumber(this.meta.anchorDate);
    const shiftTs = (ts: string) => (shift === 0 ? ts : shiftDate(ts.slice(0, 10), shift) + ts.slice(10));

    this.locations = read<Location[]>('locations.json');
    this.productList = read<Product[]>('products.json');
    this.products = new Map(this.productList.map((p) => [p.sku, p]));
    const history = read<Record<string, PricePoint[]>>('price-history.json');
    this.priceHistory = Object.fromEntries(
      Object.entries(history).map(([sku, points]) => [sku, points.map((p) => ({ date: shiftDate(p.date, shift), price: p.price }))]),
    );
    for (const [locationId, sku, qty, min] of read<[string, string, number, number][]>('stock.json')) {
      this.stock.set(keyOf(locationId, sku), { qty, min });
      this.link(locationId, sku);
    }
    for (const m of read<Movement[]>('movements.json')) {
      m.ts = shiftTs(m.ts);
      this.indexMovement(m);
    }
    this.dailySales = read<DailySales[]>('daily-sales.json').map((d) => ({ ...d, date: shiftDate(d.date, shift) }));
    this.transfers = read<Transfer[]>('transfers.json').map((t) => ({
      ...t,
      id: t.id,
      createdAt: shiftTs(t.createdAt),
      updatedAt: shiftTs(t.updatedAt),
      events: t.events.map((e) => ({ ...e, ts: shiftTs(e.ts) })),
    }));
    this.logFile = path.join(dataDir, 'mutations.jsonl');
    this.replay();
  }

  static load(dataDir: string): Store {
    return new Store(dataDir);
  }

  // ---- Nạp và ghi nhật ký ----

  private link(locationId: string, sku: string): void {
    const set = this.stockByLocation.get(locationId) ?? new Set<string>();
    set.add(sku);
    this.stockByLocation.set(locationId, set);
  }

  private indexMovement(m: Movement): void {
    this.movements.push(m);
    const byKey = this.movementsByKey.get(keyOf(m.locationId, m.sku)) ?? [];
    byKey.push(m);
    this.movementsByKey.set(keyOf(m.locationId, m.sku), byKey);
    const byLocation = this.movementsByLocation.get(m.locationId) ?? [];
    byLocation.push(m);
    this.movementsByLocation.set(m.locationId, byLocation);
  }

  private replay(): void {
    if (!fs.existsSync(this.logFile)) return;
    for (const line of fs.readFileSync(this.logFile, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      this.apply(JSON.parse(line) as MutationEvent);
    }
  }

  private apply(event: MutationEvent): void {
    if (event.t === 'movement') {
      const row = this.stock.get(keyOf(event.m.locationId, event.m.sku)) ?? { qty: 0, min: 2 };
      row.qty = event.m.qtyAfter;
      this.stock.set(keyOf(event.m.locationId, event.m.sku), row);
      this.link(event.m.locationId, event.m.sku);
      this.indexMovement(event.m);
      if (event.requestId) {
        const ids = this.requestIds.get(event.requestId) ?? [];
        ids.push(event.m.id);
        this.requestIds.set(event.requestId, ids);
      }
      this.seq += 1;
    } else if (event.t === 'transfer') {
      const index = this.transfers.findIndex((t) => t.id === event.tr.id);
      if (index === -1) this.transfers.push(event.tr);
      else this.transfers[index] = event.tr;
    } else {
      const row = this.stock.get(keyOf(event.locationId, event.sku));
      if (row) row.min = event.min;
    }
  }

  /** Áp dụng và ghi ra đĩa. Lỗi ghi không làm mất thao tác đang chạy nhưng được báo ra log. */
  private commit(events: MutationEvent[]): void {
    for (const event of events) this.apply(event);
    const text = events.map((event) => JSON.stringify(event)).join('\n') + '\n';
    this.writing = this.writing
      .then(() => fs.promises.appendFile(this.logFile, text))
      .catch((error: unknown) => {
        console.error('Không ghi được nhật ký thay đổi', error);
      });
  }

  flush(): Promise<void> {
    return this.writing;
  }

  private newMovementId(): string {
    this.seq += 1;
    return `U${Date.now().toString(36).toUpperCase()}${this.seq.toString(36).toUpperCase()}`;
  }

  // ---- Tra cứu ----

  location(locationId: string): Location {
    const found = this.locations.find((l) => l.locationId === locationId);
    if (!found) throw new ApiError(404, 'NOT_FOUND', 'Không có địa điểm này');
    return found;
  }

  product(sku: string): Product {
    const found = this.products.get(sku);
    if (!found) throw new ApiError(404, 'NOT_FOUND', `Không có mã hàng ${sku}`);
    return found;
  }

  findByBarcode(code: string): Product | undefined {
    return this.productList.find((p) => p.barcode === code || p.sku === code);
  }

  searchProducts(query: { q?: string; category?: string; brand?: string }, limit: number, offset: number) {
    const q = query.q?.trim().toLowerCase();
    const matches = this.productList.filter(
      (p) =>
        (!query.category || p.category === query.category) &&
        (!query.brand || p.brand === query.brand) &&
        (!q || p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q) || p.sku.toLowerCase() === q || p.barcode.includes(q)),
    );
    return { total: matches.length, items: matches.slice(offset, offset + limit) };
  }

  qtyAt(locationId: string, sku: string): number {
    return this.stock.get(keyOf(locationId, sku))?.qty ?? 0;
  }

  hasStockRow(locationId: string, sku: string): boolean {
    return this.stock.has(keyOf(locationId, sku));
  }

  minAt(locationId: string, sku: string): number {
    return this.stock.get(keyOf(locationId, sku))?.min ?? 0;
  }

  /** Trung bình bán mỗi ngày trong `days` ngày gần nhất */
  avgDaily(locationId: string, sku: string, days = 14): number {
    const list = this.movementsByKey.get(keyOf(locationId, sku));
    if (!list) return 0;
    const since = shiftDate(this.today, -(days - 1));
    let sold = 0;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const m = list[i] as Movement;
      if (m.ts.slice(0, 10) < since) break;
      if (m.type === 'SALE') sold -= m.qty;
    }
    return sold / days;
  }

  private itemOf(locationId: string, product: Product, row: StockRow): StockItem {
    const avgDaily = this.avgDaily(locationId, product.sku);
    return {
      sku: product.sku,
      barcode: product.barcode,
      name: product.name,
      brand: product.brand,
      category: product.category,
      unit: product.unit,
      pack: product.pack,
      packQty: product.packQty,
      imageId: product.imageId,
      price: product.price,
      cost: product.cost,
      qty: row.qty,
      min: row.min,
      status: statusOf(row.qty, row.min),
      value: row.qty * product.cost,
      avgDaily: Math.round(avgDaily * 10) / 10,
      daysCover: avgDaily > 0 ? Math.round((row.qty / avgDaily) * 10) / 10 : null,
    };
  }

  listStock(
    locationId: string,
    filter: { q?: string; category?: string; status?: StockStatus; sort?: 'name' | 'qty' | 'value' | 'cover' },
    limit: number,
    offset: number,
  ) {
    const q = filter.q?.trim().toLowerCase();
    const items: StockItem[] = [];
    const summary = { total: 0, out: 0, low: 0, ok: 0, value: 0 };
    for (const sku of this.stockByLocation.get(locationId) ?? []) {
      const product = this.products.get(sku);
      const row = this.stock.get(keyOf(locationId, sku));
      if (!product || !row) continue;
      const status = statusOf(row.qty, row.min);
      summary.total += 1;
      summary[status] += 1;
      summary.value += row.qty * product.cost;
      if (filter.category && product.category !== filter.category) continue;
      if (filter.status && status !== filter.status) continue;
      if (q && !(product.name.toLowerCase().includes(q) || product.barcode.includes(q) || product.sku.toLowerCase() === q)) continue;
      items.push(this.itemOf(locationId, product, row));
    }
    const sort = filter.sort ?? 'name';
    items.sort((a, b) => {
      if (sort === 'qty') return a.qty - b.qty;
      if (sort === 'value') return b.value - a.value;
      if (sort === 'cover') return (a.daysCover ?? 9999) - (b.daysCover ?? 9999);
      return a.name.localeCompare(b.name, 'vi');
    });
    return { summary, total: items.length, items: items.slice(offset, offset + limit) };
  }

  stockAcross(sku: string, locationIds: Iterable<string>) {
    const rows: { locationId: string; qty: number; min: number; status: StockStatus; avgDaily: number }[] = [];
    for (const locationId of locationIds) {
      const row = this.stock.get(keyOf(locationId, sku));
      if (!row) continue;
      rows.push({ locationId, qty: row.qty, min: row.min, status: statusOf(row.qty, row.min), avgDaily: Math.round(this.avgDaily(locationId, sku) * 10) / 10 });
    }
    return rows;
  }

  listMovements(
    locationIds: Set<string>,
    filter: { locationId?: string; sku?: string; type?: MovementType },
    limit: number,
    cursor?: number,
  ) {
    const source: Movement[] =
      filter.locationId && filter.sku
        ? (this.movementsByKey.get(keyOf(filter.locationId, filter.sku)) ?? [])
        : filter.locationId
          ? (this.movementsByLocation.get(filter.locationId) ?? [])
          : this.movements;
    const items: Movement[] = [];
    let index = cursor ?? source.length;
    while (index > 0 && items.length < limit) {
      index -= 1;
      const m = source[index] as Movement;
      if (!locationIds.has(m.locationId)) continue;
      if (filter.sku && m.sku !== filter.sku) continue;
      if (filter.type && m.type !== filter.type) continue;
      items.push(m);
    }
    return { items, nextCursor: index > 0 ? index : null };
  }

  // ---- Thay đổi tồn kho ----

  private movement(
    actor: Actor,
    locationId: string,
    sku: string,
    type: MovementType,
    qty: number,
    extra: { ref?: string; note?: string; requestId?: string },
  ): MutationEvent {
    const row = this.stock.get(keyOf(locationId, sku)) ?? { qty: 0, min: 2 };
    const m: Movement = {
      id: this.newMovementId(),
      ts: new Date().toISOString(),
      locationId,
      sku,
      type,
      qty,
      qtyAfter: row.qty + qty,
      ref: extra.ref,
      note: extra.note,
      by: actor.username,
    };
    return { t: 'movement', m, requestId: extra.requestId };
  }

  private replayOf(requestId: string | undefined): Movement[] | null {
    if (!requestId) return null;
    const ids = this.requestIds.get(requestId);
    if (!ids) return null;
    const found = this.movements.filter((m) => ids.includes(m.id));
    return found.length > 0 ? found : null;
  }

  receive(actor: Actor, locationId: string, lines: { sku: string; qty: number }[], note: string, requestId?: string): Movement[] {
    const previous = this.replayOf(requestId);
    if (previous) return previous;
    if (lines.length === 0 || lines.length > 100) throw new ApiError(400, 'VALIDATION_ERROR', 'Phiếu nhập cần từ 1 đến 100 dòng');
    const ref = `PNK-${this.today.replace(/-/g, '')}-${(this.seq + 1).toString(36).toUpperCase()}`;
    const events: MutationEvent[] = [];
    const seen = new Set<string>();
    for (const line of lines) {
      this.product(line.sku);
      if (seen.has(line.sku)) throw new ApiError(400, 'VALIDATION_ERROR', `Mã ${line.sku} bị lặp trong phiếu`);
      seen.add(line.sku);
      events.push(this.movement(actor, locationId, line.sku, 'RECEIPT', assertQty(line.qty), { ref, note: note || 'Nhập hàng', requestId }));
    }
    return this.commitMovements(events);
  }

  waste(actor: Actor, locationId: string, sku: string, qty: number, reason: string, requestId?: string): Movement {
    const previous = this.replayOf(requestId);
    if (previous?.[0]) return previous[0];
    this.product(sku);
    assertQty(qty);
    if (this.qtyAt(locationId, sku) < qty) throw new ApiError(409, 'INSUFFICIENT_STOCK', 'Số lượng hao hụt lớn hơn tồn hiện tại');
    const event = this.movement(actor, locationId, sku, 'WASTE', -qty, { note: reason, requestId });
    return this.commitMovements([event])[0] as Movement;
  }

  adjust(actor: Actor, locationId: string, sku: string, counted: number, expected: number, note: string, requestId?: string): Movement | null {
    const previous = this.replayOf(requestId);
    if (previous?.[0]) return previous[0];
    this.product(sku);
    if (!Number.isInteger(counted) || counted < 0 || counted > MAX_QTY) throw new ApiError(400, 'VALIDATION_ERROR', 'Số kiểm đếm không hợp lệ');
    const current = this.qtyAt(locationId, sku);
    if (current !== expected) {
      throw new ApiError(409, 'STALE_STOCK', `Tồn đã thay đổi thành ${current} từ lần bạn xem. Tải lại rồi kiểm đếm lại.`);
    }
    const delta = counted - current;
    if (delta === 0) return null;
    const event = this.movement(actor, locationId, sku, 'ADJUST', delta, { note: note || 'Kiểm kê', requestId });
    return this.commitMovements([event])[0] as Movement;
  }

  setMinimum(locationId: string, sku: string, min: number): void {
    if (!this.stock.has(keyOf(locationId, sku))) throw new ApiError(404, 'NOT_FOUND', 'Địa điểm này không bày bán mã hàng đó');
    if (!Number.isInteger(min) || min < 0 || min > MAX_QTY) throw new ApiError(400, 'VALIDATION_ERROR', 'Mức tồn tối thiểu không hợp lệ');
    this.commit([{ t: 'minimum', locationId, sku, min }]);
  }

  /** Các dòng trong một phiếu khác mã hàng nhau nên qtyAfter tính trước vẫn đúng khi áp cùng lúc. */
  private commitMovements(events: MutationEvent[]): Movement[] {
    this.commit(events);
    return events.flatMap((event) => (event.t === 'movement' ? [event.m] : []));
  }

  // ---- Chuyển kho ----

  listTransfers(scope: Set<string>, filter: { status?: TransferStatus; locationId?: string }): Transfer[] {
    return this.transfers
      .filter((t) => scope.has(t.fromLocationId) || scope.has(t.toLocationId))
      .filter((t) => !filter.status || t.status === filter.status)
      .filter((t) => !filter.locationId || t.fromLocationId === filter.locationId || t.toLocationId === filter.locationId)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  transfer(id: string): Transfer {
    const found = this.transfers.find((t) => t.id === id);
    if (!found) throw new ApiError(404, 'NOT_FOUND', 'Không có phiếu chuyển kho này');
    return found;
  }

  pendingTransfers(scope: Set<string>): number {
    return this.transfers.filter(
      (t) => ['REQUESTED', 'APPROVED', 'SHIPPED'].includes(t.status) && (scope.has(t.fromLocationId) || scope.has(t.toLocationId)),
    ).length;
  }

  createTransfer(actor: Actor, input: { fromLocationId: string; toLocationId: string; lines: { sku: string; qty: number }[]; note: string }): Transfer {
    const { fromLocationId, toLocationId, lines } = input;
    if (fromLocationId === toLocationId) throw new ApiError(400, 'VALIDATION_ERROR', 'Nơi gửi và nơi nhận phải khác nhau');
    this.location(fromLocationId);
    this.location(toLocationId);
    if (lines.length === 0 || lines.length > 100) throw new ApiError(400, 'VALIDATION_ERROR', 'Phiếu cần từ 1 đến 100 dòng');
    const seen = new Set<string>();
    for (const line of lines) {
      this.product(line.sku);
      assertQty(line.qty);
      if (seen.has(line.sku)) throw new ApiError(400, 'VALIDATION_ERROR', `Mã ${line.sku} bị lặp trong phiếu`);
      seen.add(line.sku);
    }
    const day = this.today.replace(/-/g, '');
    const count = this.transfers.filter((t) => t.id.startsWith(`CK-${day}`)).length + 1;
    const now = new Date().toISOString();
    const transfer: Transfer = {
      id: `CK-${day}-${String(count).padStart(3, '0')}`,
      fromLocationId,
      toLocationId,
      status: 'REQUESTED',
      lines: lines.map((l) => ({ sku: l.sku, qty: l.qty })),
      note: input.note,
      createdAt: now,
      createdBy: actor.username,
      updatedAt: now,
      events: [{ ts: now, status: 'REQUESTED', by: actor.username, note: input.note || undefined }],
    };
    this.commit([{ t: 'transfer', tr: transfer }]);
    return transfer;
  }

  transition(
    actor: Actor,
    id: string,
    to: TransferStatus,
    options: { note?: string; received?: { sku: string; qty: number }[] } = {},
  ): Transfer {
    const current = this.transfer(id);
    const allowed: Record<TransferStatus, TransferStatus[]> = {
      REQUESTED: ['APPROVED', 'REJECTED', 'CANCELLED'],
      APPROVED: ['SHIPPED', 'CANCELLED'],
      SHIPPED: ['RECEIVED'],
      RECEIVED: [],
      REJECTED: [],
      CANCELLED: [],
    };
    if (!allowed[current.status].includes(to)) {
      throw new ApiError(409, 'INVALID_STATE', `Phiếu đang ở trạng thái ${current.status}, không chuyển sang ${to} được`);
    }
    const next: Transfer = {
      ...current,
      lines: current.lines.map((l) => ({ ...l })),
      events: [...current.events],
    };
    const now = new Date().toISOString();
    const movementEvents: MutationEvent[] = [];
    if (to === 'SHIPPED') {
      const short = current.lines.filter((l) => this.qtyAt(current.fromLocationId, l.sku) < l.qty);
      if (short.length > 0) {
        const names = short.slice(0, 3).map((l) => this.product(l.sku).name).join(', ');
        throw new ApiError(409, 'INSUFFICIENT_STOCK', `Không đủ tồn để xuất: ${names}${short.length > 3 ? ` và ${short.length - 3} mã khác` : ''}`);
      }
      for (const line of current.lines) {
        movementEvents.push(this.movement(actor, current.fromLocationId, line.sku, 'TRANSFER_OUT', -line.qty, { ref: id, note: `Chuyển đến ${this.location(current.toLocationId).name}` }));
      }
    }
    if (to === 'RECEIVED') {
      const received = new Map((options.received ?? []).map((r) => [r.sku, r.qty]));
      for (const line of next.lines) {
        const qty = received.has(line.sku) ? (received.get(line.sku) as number) : line.qty;
        if (!Number.isInteger(qty) || qty < 0 || qty > line.qty) {
          throw new ApiError(400, 'VALIDATION_ERROR', `Số nhận của ${line.sku} phải từ 0 đến ${line.qty}`);
        }
        line.receivedQty = qty;
        if (qty > 0) {
          movementEvents.push(this.movement(actor, current.toLocationId, line.sku, 'TRANSFER_IN', qty, { ref: id, note: `Nhận từ ${this.location(current.fromLocationId).name}` }));
        }
      }
    }
    next.status = to;
    next.updatedAt = now;
    next.events.push({ ts: now, status: to, by: actor.username, note: options.note || undefined });
    // Một lần ghi cho cả phiếu: hoặc có đủ biến động tồn và trạng thái mới, hoặc không có gì
    this.commit([...movementEvents, { t: 'transfer', tr: next }]);
    return next;
  }

  // ---- Báo cáo ----

  dashboard(scope: Set<string>, locationId: string | null, days: number) {
    const ids = locationId ? [locationId] : [...scope];
    const salesIds = new Set(ids.filter((id) => this.location(id).kind === 'store'));
    const summary = { skus: 0, units: 0, retailValue: 0, costValue: 0, low: 0, out: 0 };
    for (const id of ids) {
      for (const sku of this.stockByLocation.get(id) ?? []) {
        const row = this.stock.get(keyOf(id, sku));
        const product = this.products.get(sku);
        if (!row || !product) continue;
        summary.skus += 1;
        summary.units += row.qty;
        summary.retailValue += row.qty * product.price;
        summary.costValue += row.qty * product.cost;
        const status = statusOf(row.qty, row.min);
        if (status === 'low') summary.low += 1;
        if (status === 'out') summary.out += 1;
      }
    }

    const from = shiftDate(this.today, -(days - 1));
    const prevFrom = shiftDate(this.today, -(2 * days - 1));
    const prevTo = shiftDate(this.today, -days);
    const trend = new Map<string, { date: string; revenue: number; orders: number }>();
    for (let i = days - 1; i >= 0; i -= 1) {
      const date = shiftDate(this.today, -i);
      trend.set(date, { date, revenue: 0, orders: 0 });
    }
    const byCategory = new Map<string, { category: string; revenue: number; units: number }>();
    let revenue = 0;
    let orders = 0;
    let prevRevenue = 0;
    for (const row of this.dailySales) {
      if (!salesIds.has(row.locationId)) continue;
      if (row.date >= from && row.date <= this.today) {
        revenue += row.revenue;
        orders += row.orders;
        const t = trend.get(row.date);
        if (t) {
          t.revenue += row.revenue;
          t.orders += row.orders;
        }
        const c = byCategory.get(row.category) ?? { category: row.category, revenue: 0, units: 0 };
        c.revenue += row.revenue;
        c.units += row.units;
        byCategory.set(row.category, c);
      } else if (row.date >= prevFrom && row.date <= prevTo) {
        prevRevenue += row.revenue;
      }
    }

    const topSince = shiftDate(this.today, -(Math.min(days, 30) - 1));
    const sold = new Map<string, number>();
    for (const id of salesIds) {
      const list = this.movementsByLocation.get(id) ?? [];
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const m = list[i] as Movement;
        if (m.ts.slice(0, 10) < topSince) break;
        if (m.type === 'SALE') sold.set(m.sku, (sold.get(m.sku) ?? 0) - m.qty);
      }
    }
    const top = [...sold.entries()]
      .map(([sku, units]) => ({ product: this.product(sku), units }))
      .sort((a, b) => b.units * b.product.price - a.units * a.product.price)
      .slice(0, 10)
      .map(({ product, units }) => ({ sku: product.sku, name: product.name, imageId: product.imageId, units, revenue: units * product.price }));

    const slow: { sku: string; name: string; imageId: string; qty: number; value: number }[] = [];
    for (const id of salesIds) {
      for (const sku of this.stockByLocation.get(id) ?? []) {
        const row = this.stock.get(keyOf(id, sku));
        const product = this.products.get(sku);
        if (!row || !product || row.qty <= 0 || sold.has(sku)) continue;
        slow.push({ sku, name: product.name, imageId: product.imageId, qty: row.qty, value: row.qty * product.cost });
      }
    }
    slow.sort((a, b) => b.value - a.value);

    return {
      days,
      stock: summary,
      sales: { revenue, orders, prevRevenue, aov: orders > 0 ? Math.round(revenue / orders) : 0 },
      trend: [...trend.values()],
      byCategory: [...byCategory.values()].sort((a, b) => b.revenue - a.revenue),
      top,
      slow: slow.slice(0, 10),
      pendingTransfers: this.pendingTransfers(scope),
    };
  }

  replenishment(locationId: string, leadDays = 10) {
    const out = [] as {
      sku: string;
      name: string;
      imageId: string;
      unit: string;
      qty: number;
      min: number;
      avgDaily: number;
      daysCover: number | null;
      suggest: number;
      warehouseQty: number;
    }[];
    const warehouse = this.locations.find((l) => l.kind === 'warehouse');
    for (const sku of this.stockByLocation.get(locationId) ?? []) {
      const row = this.stock.get(keyOf(locationId, sku));
      const product = this.products.get(sku);
      if (!row || !product || row.qty > row.min) continue;
      const avg = this.avgDaily(locationId, sku);
      const need = Math.ceil(avg * leadDays + row.min - row.qty);
      if (need <= 0) continue;
      const caseQty = product.packQty > 1 ? 1 : product.unit === 'Kg' ? 1 : 6;
      const suggest = Math.ceil(need / caseQty) * caseQty;
      out.push({
        sku,
        name: product.name,
        imageId: product.imageId,
        unit: product.unit,
        qty: row.qty,
        min: row.min,
        avgDaily: Math.round(avg * 10) / 10,
        daysCover: avg > 0 ? Math.round((row.qty / avg) * 10) / 10 : null,
        suggest,
        warehouseQty: warehouse ? this.qtyAt(warehouse.locationId, sku) : 0,
      });
    }
    out.sort((a, b) => (a.daysCover ?? 9999) - (b.daysCover ?? 9999));
    return out;
  }
}
