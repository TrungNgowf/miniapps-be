/**
 * Sinh dữ liệu vận hành cho siêu thị Minh Phát: danh mục hàng, tồn kho, nhật ký nhập xuất,
 * doanh số theo ngày và phiếu chuyển kho.
 *
 * Cách sinh đi ngược thời gian từ tồn hiện tại, nên tồn sau mỗi dòng nhật ký khớp nhau
 * (tồn đầu + nhập - bán - hao hụt ± kiểm kê = tồn cuối) và không bao giờ âm.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DailySales, Location, Movement, PricePoint, Product, Transfer, TransferStatus } from '../src/types.js';
import { CATEGORIES, FAMILIES, type CatId } from './catalog-data.js';
import { createRng, hashString } from './rng.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dataDir = path.resolve(root, process.env.DATA_DIR ?? 'data');
const fePublic = path.resolve(root, process.env.FE_PUBLIC ?? '../../miniapp_samples/apps/kho-hang/public');

const DETAIL_DAYS = 30;
const AGG_DAYS = 365;
const rng = createRng(20261106);

function localDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
const today = process.env.GEN_TODAY ?? localDate(new Date());
const todayMs = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
function dayAgo(offset: number): string {
  return new Date(todayMs - offset * 86_400_000).toISOString().slice(0, 10);
}
function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}
function weekdayFactor(date: string): number {
  const wd = weekday(date);
  return wd === 0 ? 1.3 : wd === 6 ? 1.25 : wd === 5 ? 1.1 : 0.92;
}
const at = (date: string, time: string) => `${date}T${time}+07:00`;

// ---- Địa điểm ----
const locations: Location[] = [
  { locationId: 'mp-kho-tong', tenantId: 'minhphat', kind: 'warehouse', name: 'Kho tổng Minh Phát', address: 'Lô CN3, KCN Sài Đồng B', district: 'Long Biên', province: 'Hà Nội', openedAt: '2014-03-01' },
  { locationId: 'mp-hd-01', tenantId: 'minhphat-hadong', kind: 'store', name: 'Minh Phát Quang Trung', address: 'Số 12 Quang Trung', district: 'Hà Đông', province: 'Hà Nội', openedAt: '2016-08-20' },
  { locationId: 'mp-hd-02', tenantId: 'minhphat-hadong', kind: 'store', name: 'Minh Phát Văn Quán', address: 'Tòa CT3, KĐT Văn Quán', district: 'Hà Đông', province: 'Hà Nội', openedAt: '2019-11-02' },
  { locationId: 'mp-cg-01', tenantId: 'minhphat-caugiay', kind: 'store', name: 'Minh Phát Trần Thái Tông', address: 'Số 98 Trần Thái Tông', district: 'Cầu Giấy', province: 'Hà Nội', openedAt: '2015-05-10' },
  { locationId: 'mp-cg-02', tenantId: 'minhphat-caugiay', kind: 'store', name: 'Minh Phát Xuân Thủy', address: 'Số 144 Xuân Thủy', district: 'Cầu Giấy', province: 'Hà Nội', openedAt: '2020-09-15' },
  { locationId: 'mp-q7-01', tenantId: 'minhphat-mn', kind: 'store', name: 'Minh Phát Phú Mỹ Hưng', address: 'Số 105 Nguyễn Thị Thập', district: 'Quận 7', province: 'TP. Hồ Chí Minh', openedAt: '2018-01-12' },
  { locationId: 'mp-td-01', tenantId: 'minhphat-mn', kind: 'store', name: 'Minh Phát Thủ Đức', address: 'Số 88 Võ Văn Ngân', district: 'Thủ Đức', province: 'TP. Hồ Chí Minh', openedAt: '2021-04-03' },
];
const STORE_FACTOR: Record<string, number> = {
  'mp-hd-01': 1.0,
  'mp-hd-02': 0.7,
  'mp-cg-01': 1.3,
  'mp-cg-02': 0.9,
  'mp-q7-01': 1.4,
  'mp-td-01': 1.1,
};
const stores = locations.filter((l) => l.kind === 'store');
const warehouse = locations.find((l) => l.kind === 'warehouse') as Location;
const keeperOf = (locationId: string) => (locationId.startsWith('mp-cg') ? 'toan.mai' : 'quyen.hua');

// ---- Sản phẩm ----
function ean13(prefix12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(prefix12[i]) * (i % 2 === 0 ? 1 : 3);
  return prefix12 + String((10 - (sum % 10)) % 10);
}
const roundTo = (value: number, step: number) => Math.max(step, Math.round(value / step) * step);
const priceStep = (price: number) => (price < 20_000 ? 100 : price < 200_000 ? 500 : 1000);

interface Meta {
  pop: number;
  catId: CatId;
  sizeFactor: number;
  caseQty: number;
  isMulti: boolean;
}

const products: Product[] = [];
const meta = new Map<string, Meta>();
const categoryOf = new Map<CatId, (typeof CATEGORIES)[number]>(CATEGORIES.map((c) => [c.id, c]));
const unitByShape = { bottle: 'Chai', carton: 'Hộp', bag: 'Gói', can: 'Lon', box: 'Hộp', tube: 'Tuýp', cup: 'Ly', jar: 'Hũ', tray: 'Khay', pouch: 'Túi' } as const;
let skuSeq = 100_000;

function priceHistory(price: number): PricePoint[] {
  const points: PricePoint[] = [];
  let current = price;
  const step = priceStep(price);
  const monthly: number[] = [];
  for (let month = 0; month < 12; month += 1) {
    monthly.unshift(current);
    if (rng.chance(0.35)) current = roundTo(current * (1 - rng.next() * 0.04), step);
  }
  let previous = -1;
  monthly.forEach((value, index) => {
    if (value !== previous) points.push({ date: dayAgo((11 - index) * 30), price: value });
    previous = value;
  });
  return points;
}

FAMILIES.forEach((family, familyIndex) => {
  const category = categoryOf.get(family.c);
  if (!category) throw new Error(`Thiếu nhóm hàng ${family.c}`);
  const imageId = `f${String(familyIndex).padStart(3, '0')}`;
  const flavors = family.f && family.f.length > 0 ? family.f : [undefined];
  const baseUnit = unitByShape[family.s];
  const isFresh = family.c === 'rau' || (family.c === 'thit' && family.v[0]?.[0] === 'kg');
  for (const flavor of flavors) {
    const pop = Math.exp(rng.normal() * 0.8);
    family.v.forEach(([size, price], variantIndex) => {
      const make = (name: string, pack: string, packQty: number, unit: string, sellPrice: number, isMulti: boolean) => {
        skuSeq += 1;
        const sku = `MP${skuSeq}`;
        const barcode = ean13(`893${String(hashString(sku) % 1_000_000_000).padStart(9, '0')}`);
        const net = sellPrice / (1 + category.vat / 100);
        const cost = roundTo(net * (1 - category.margin * (0.7 + rng.next() * 0.6)), 100);
        products.push({
          sku,
          barcode,
          name,
          brand: family.b,
          category: family.c,
          unit,
          pack,
          packQty,
          price: sellPrice,
          cost,
          vat: category.vat,
          imageId,
          priceHistory: priceHistory(sellPrice),
        });
        meta.set(sku, {
          pop,
          catId: family.c,
          sizeFactor: (isMulti ? 0.25 : 1) * (variantIndex > 0 ? 0.6 : 1),
          caseQty: isFresh ? 1 : isMulti ? 1 : family.c === 'nuoc' || family.c === 'mi' || family.c === 'bia' ? 12 : 6,
          isMulti,
        });
      };
      const label = size === 'kg' ? '' : ` ${size}`;
      const baseName = `${family.n}${flavor ? ` ${flavor}` : ''} ${family.b}${label}`.trim();
      const unit = size === 'kg' ? 'Kg' : baseUnit;
      make(baseName, size, 1, unit, price, false);
      if (variantIndex === 0 && family.m) {
        for (const count of family.m) {
          const total = price * count * (1 - (0.03 + rng.next() * 0.04));
          const noun = count >= 12 ? 'Thùng' : 'Lốc';
          make(`${baseName} (${noun} ${count})`, `${noun} ${count}`, count, noun, roundTo(total, priceStep(total)), true);
        }
      }
    });
  }
});

// ---- Tồn kho và nhật ký (sinh ngược) ----
const CAT_BASE: Record<CatId, number> = {
  sua: 3, mi: 4, giavi: 1.4, dau: 1, gao: 0.7, nuoc: 5, bia: 2.5, banh: 2.5, caphe: 1.2,
  hop: 0.8, canhan: 0.9, nhacua: 0.7, mebe: 0.6, dongl: 0.9, rau: 3, thit: 2, giadung: 0.15,
};
const WASTE_CATS = new Set<CatId>(['rau', 'thit', 'sua', 'dongl', 'banh']);
const FRESH_ONLY_STORE = new Set<CatId>(['rau', 'thit']);

interface StockOut {
  locationId: string;
  sku: string;
  qty: number;
  min: number;
}
const stock: StockOut[] = [];
const movementsByKey = new Map<string, Movement[]>();
const keyOf = (locationId: string, sku: string) => `${locationId}|${sku}`;
let movementSeq = 0;
const nextId = () => `M${(++movementSeq).toString(36).toUpperCase().padStart(6, '0')}`;
const receiptRef = new Map<string, string>();

const salesAgg = new Map<string, DailySales>();
const baseDaily = new Map<string, { revenue: number; units: number }>();

for (const store of stores) {
  const factor = STORE_FACTOR[store.locationId] ?? 1;
  for (const product of products) {
    const m = meta.get(product.sku) as Meta;
    const carry = FRESH_ONLY_STORE.has(m.catId) ? 0.85 : 0.5 + 0.45 * Math.min(1, m.pop / 1.4);
    if (!rng.chance(carry)) continue;
    const avg = CAT_BASE[m.catId] * m.pop * factor * m.sizeFactor * (product.price > 400_000 ? 0.3 : 1);
    const min = Math.max(2, Math.ceil(avg * 4));
    const target = avg * 12 + min;
    const roll = rng.next();
    let q = roll < 0.03 ? 0 : roll < 0.11 ? rng.int(0, min - 1) : Math.round(avg * rng.int(3, 14)) + min;
    stock.push({ locationId: store.locationId, sku: product.sku, qty: 0, min });
    const row = stock[stock.length - 1] as StockOut;
    row.qty = q;

    const key = keyOf(store.locationId, product.sku);
    const list: Movement[] = [];
    const aggKey = (date: string) => `${date}|${store.locationId}|${m.catId}`;
    const base = baseDaily.get(`${store.locationId}|${m.catId}`) ?? { revenue: 0, units: 0 };
    base.revenue += avg * product.price;
    base.units += avg;
    baseDaily.set(`${store.locationId}|${m.catId}`, base);

    for (let d = 0; d < DETAIL_DAYS; d += 1) {
      const date = dayAgo(d);
      const sold = rng.poisson(avg * weekdayFactor(date));
      const waste = WASTE_CATS.has(m.catId) && rng.chance(0.02) ? rng.int(1, 3) : 0;
      let adjust = rng.chance(0.004) ? (rng.chance(0.5) ? -1 : 1) * rng.int(1, 3) : 0;
      let before = q + sold + waste - adjust;
      if (before < 0) {
        adjust = 0;
        before = q + sold + waste;
      }
      let received = 0;
      if (before > target) {
        received = m.caseQty * Math.ceil((before - target * 0.6) / m.caseQty);
        received = Math.min(received, before);
        before -= received;
      }
      let cur = before;
      const by = keeperOf(store.locationId);
      if (received > 0) {
        cur += received;
        const refKey = `${date}|${store.locationId}`;
        if (!receiptRef.has(refKey)) receiptRef.set(refKey, `PNK-${date.replace(/-/g, '')}-${store.locationId.slice(3).toUpperCase()}`);
        list.push({ id: nextId(), ts: at(date, '07:30:00'), locationId: store.locationId, sku: product.sku, type: 'RECEIPT', qty: received, qtyAfter: cur, ref: receiptRef.get(refKey), note: `Nhập từ NCC ${product.brand}`, by });
      }
      if (sold > 0) {
        cur -= sold;
        list.push({ id: nextId(), ts: at(date, '20:00:00'), locationId: store.locationId, sku: product.sku, type: 'SALE', qty: -sold, qtyAfter: cur, note: 'Bán lẻ tại quầy', by: 'pos' });
        const k = aggKey(date);
        const agg = salesAgg.get(k) ?? { date, locationId: store.locationId, category: m.catId, revenue: 0, units: 0, orders: 0 };
        agg.revenue += sold * product.price;
        agg.units += sold;
        salesAgg.set(k, agg);
      }
      if (waste > 0) {
        cur -= waste;
        list.push({ id: nextId(), ts: at(date, '21:30:00'), locationId: store.locationId, sku: product.sku, type: 'WASTE', qty: -waste, qtyAfter: cur, note: rng.pick(['Hết hạn sử dụng', 'Hư hỏng khi bày bán', 'Móp méo bao bì']), by });
      }
      if (adjust !== 0) {
        cur += adjust;
        list.push({ id: nextId(), ts: at(date, '22:00:00'), locationId: store.locationId, sku: product.sku, type: 'ADJUST', qty: adjust, qtyAfter: cur, note: 'Kiểm kê định kỳ', by });
      }
      if (cur !== q) throw new Error(`Lệch tồn ${key} ngày ${date}: ${cur} != ${q}`);
      q = before;
    }
    list.reverse();
    movementsByKey.set(key, list);
  }
}

// Kho tổng: giữ nhiều hàng khô, không có hàng tươi
for (const product of products) {
  const m = meta.get(product.sku) as Meta;
  if (FRESH_ONLY_STORE.has(m.catId) || m.catId === 'dongl') continue;
  const base = m.isMulti ? rng.int(40, 300) : rng.int(300, 3000);
  stock.push({ locationId: warehouse.locationId, sku: product.sku, qty: base, min: Math.round(base * 0.15) });
  movementsByKey.set(keyOf(warehouse.locationId, product.sku), []);
}

// ---- Phiếu chuyển kho ----
const TRANSFER_CATS = new Set<CatId>(['nuoc', 'mi', 'sua', 'banh', 'giavi', 'nhacua', 'dau', 'caphe', 'canhan', 'bia']);
const candidates = products.filter((p) => TRANSFER_CATS.has((meta.get(p.sku) as Meta).catId) && !(meta.get(p.sku) as Meta).isMulti);
const stockByKey = new Map(stock.map((s) => [keyOf(s.locationId, s.sku), s]));
const transfers: Transfer[] = [];
const plan: { status: TransferStatus; daysAgo: number; to: string }[] = [
  { status: 'RECEIVED', daysAgo: 27, to: 'mp-hd-01' },
  { status: 'RECEIVED', daysAgo: 24, to: 'mp-q7-01' },
  { status: 'RECEIVED', daysAgo: 21, to: 'mp-cg-01' },
  { status: 'RECEIVED', daysAgo: 18, to: 'mp-td-01' },
  { status: 'RECEIVED', daysAgo: 15, to: 'mp-hd-02' },
  { status: 'RECEIVED', daysAgo: 12, to: 'mp-cg-02' },
  { status: 'RECEIVED', daysAgo: 9, to: 'mp-q7-01' },
  { status: 'RECEIVED', daysAgo: 6, to: 'mp-hd-01' },
  { status: 'REJECTED', daysAgo: 8, to: 'mp-cg-01' },
  { status: 'CANCELLED', daysAgo: 5, to: 'mp-td-01' },
  { status: 'SHIPPED', daysAgo: 1, to: 'mp-cg-02' },
  { status: 'SHIPPED', daysAgo: 1, to: 'mp-hd-02' },
  { status: 'APPROVED', daysAgo: 1, to: 'mp-q7-01' },
  { status: 'REQUESTED', daysAgo: 0, to: 'mp-hd-01' },
  { status: 'REQUESTED', daysAgo: 0, to: 'mp-td-01' },
];

function pushMovement(m: Movement): void {
  const key = keyOf(m.locationId, m.sku);
  if (!stockByKey.has(key)) {
    // Cửa hàng nhận một mã chưa có trong danh mục bày bán: mở dòng tồn mới
    const created: StockOut = { locationId: m.locationId, sku: m.sku, qty: 0, min: 2 };
    stock.push(created);
    stockByKey.set(key, created);
  }
  const list = movementsByKey.get(key) ?? [];
  const index = list.findIndex((item) => item.ts > m.ts);
  const position = index === -1 ? list.length : index;
  const previous = list[position - 1];
  const stockRow = stockByKey.get(key);
  // Tồn đầu cửa sổ = tồn hiện tại trừ mọi biến động trong cửa sổ
  const opening = (stockRow?.qty ?? 0) - list.reduce((sum, item) => sum + item.qty, 0);
  const beforeQty = previous ? previous.qtyAfter : opening;
  const created: Movement = { ...m, qtyAfter: beforeQty + m.qty };
  for (let i = position; i < list.length; i += 1) {
    const later = list[i] as Movement;
    later.qtyAfter += m.qty;
  }
  list.splice(position, 0, created);
  movementsByKey.set(key, list);
  if (stockRow) stockRow.qty += m.qty;
}

plan.forEach((item, index) => {
  const id = `CK-${dayAgo(item.daysAgo).replace(/-/g, '')}-${String(index + 1).padStart(3, '0')}`;
  const picked = new Set<string>();
  const lines: Transfer['lines'] = [];
  const count = rng.int(5, 12);
  while (lines.length < count) {
    const product = rng.pick(candidates);
    if (picked.has(product.sku) || !stockByKey.has(keyOf(warehouse.locationId, product.sku))) continue;
    picked.add(product.sku);
    const m = meta.get(product.sku) as Meta;
    lines.push({ sku: product.sku, qty: m.caseQty * rng.int(1, 4) });
  }
  const requester = keeperOf(item.to);
  const created = at(dayAgo(item.daysAgo), '08:15:00');
  const events: Transfer['events'] = [{ ts: created, status: 'REQUESTED', by: requester, note: 'Bổ sung hàng bán chạy cuối tuần' }];
  const stamp = (time: string) => at(dayAgo(item.daysAgo), time);
  const step = (status: TransferStatus, by: string, time: string, note?: string) => events.push({ ts: stamp(time), status, by, note });
  if (item.status === 'REJECTED') step('REJECTED', 'thao.ha', '10:40:00', 'Kho tổng chưa đủ hàng, gửi lại sau 3 ngày');
  if (item.status === 'CANCELLED') step('CANCELLED', requester, '09:05:00', 'Đã nhập đủ từ nhà cung cấp');
  const approved = ['APPROVED', 'SHIPPED', 'RECEIVED'].includes(item.status);
  const shipped = ['SHIPPED', 'RECEIVED'].includes(item.status);
  if (approved) step('APPROVED', 'thao.ha', '09:30:00');
  if (shipped) {
    step('SHIPPED', 'thao.ha', '14:00:00');
    for (const line of lines) pushMovement({ id: nextId(), ts: stamp('14:00:00'), locationId: warehouse.locationId, sku: line.sku, type: 'TRANSFER_OUT', qty: -line.qty, qtyAfter: 0, ref: id, note: `Chuyển đến ${item.to}`, by: 'thao.ha' });
  }
  if (item.status === 'RECEIVED') {
    const receivedDay = item.daysAgo > 0 ? dayAgo(item.daysAgo - 1) : dayAgo(0);
    events.push({ ts: at(receivedDay, '09:10:00'), status: 'RECEIVED', by: requester });
    for (const line of lines) {
      line.receivedQty = line.qty;
      pushMovement({ id: nextId(), ts: at(receivedDay, '09:10:00'), locationId: item.to, sku: line.sku, type: 'TRANSFER_IN', qty: line.qty, qtyAfter: 0, ref: id, note: 'Nhận hàng từ Kho tổng', by: requester });
    }
  }
  transfers.push({
    id,
    fromLocationId: warehouse.locationId,
    toLocationId: item.to,
    status: item.status,
    lines,
    note: 'Bổ sung hàng bán chạy cuối tuần',
    createdAt: created,
    createdBy: requester,
    updatedAt: events[events.length - 1]?.ts ?? created,
    events,
  });
});

// ---- Doanh số theo ngày: 30 ngày chi tiết, các ngày trước đó theo mô hình kỳ vọng ----
const seasonal = (cat: CatId, date: string) => {
  const month = Number(date.slice(5, 7));
  if (month === 1 || month === 2 || month === 12) return cat === 'banh' || cat === 'bia' || cat === 'nuoc' ? 1.28 : 1.1;
  if (month >= 6 && month <= 8) return cat === 'nuoc' || cat === 'dongl' ? 1.15 : 1;
  return 1;
};
for (const store of stores) {
  for (const cat of CATEGORIES) {
    const base = baseDaily.get(`${store.locationId}|${cat.id}`);
    if (!base) continue;
    for (let d = DETAIL_DAYS; d < AGG_DAYS; d += 1) {
      const date = dayAgo(d);
      const trend = 1 - 0.0012 * d;
      const noise = 1 + rng.normal() * 0.06;
      const factor = weekdayFactor(date) * trend * seasonal(cat.id, date) * noise;
      const units = Math.max(0, Math.round(base.units * factor));
      salesAgg.set(`${date}|${store.locationId}|${cat.id}`, {
        date,
        locationId: store.locationId,
        category: cat.id,
        revenue: Math.round((base.revenue * factor) / 100) * 100,
        units,
        orders: 0,
      });
    }
  }
}
for (const agg of salesAgg.values()) agg.orders = Math.max(1, Math.round((agg.units / 3.1) * (0.92 + rng.next() * 0.16)));

// ---- Ghi file ----
const movements = [...movementsByKey.values()].flat().sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
const dailySales = [...salesAgg.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
const version = `${today.replace(/-/g, '')}.${products.length}`;

fs.mkdirSync(dataDir, { recursive: true });
const write = (name: string, value: unknown) => fs.writeFileSync(path.join(dataDir, name), JSON.stringify(value));
write('locations.json', locations);
write('products.json', products.map(({ priceHistory: _history, ...rest }) => rest));
write('price-history.json', Object.fromEntries(products.map((p) => [p.sku, p.priceHistory])));
write('stock.json', stock.map((s) => [s.locationId, s.sku, s.qty, s.min]));
write('movements.json', movements);
write('daily-sales.json', dailySales);
write('transfers.json', transfers);
write('meta.json', { version, generatedAt: new Date().toISOString(), anchorDate: today, products: products.length });
fs.rmSync(path.join(dataDir, 'mutations.jsonl'), { force: true });

// Gói danh mục dùng offline trong mini-app
fs.mkdirSync(path.join(fePublic, 'data'), { recursive: true });
fs.writeFileSync(
  path.join(fePublic, 'data', 'catalog.json'),
  JSON.stringify({
    version,
    categories: CATEGORIES.map((c) => ({ id: c.id, name: c.name })),
    items: products.map((p) => [p.sku, p.barcode, p.name, p.brand, CATEGORIES.findIndex((c) => c.id === p.category), p.unit, p.pack, p.packQty, p.price, p.vat, p.imageId]),
  }),
);
fs.writeFileSync(
  path.join(fePublic, 'data', 'price-history.json'),
  JSON.stringify(Object.fromEntries(products.map((p) => [p.sku, p.priceHistory.map((h) => [h.date, h.price])]))),
);

const mb = (file: string) => (fs.statSync(file).size / 1_048_576).toFixed(1);
console.log(`Phiên bản dữ liệu ${version}, ngày gốc ${today}`);
console.log(`${products.length} SKU, ${stock.length} dòng tồn, ${movements.length} biến động, ${dailySales.length} dòng doanh số, ${transfers.length} phiếu chuyển`);
for (const file of fs.readdirSync(dataDir)) console.log(`  ${file}  ${mb(path.join(dataDir, file))} MB`);
console.log(`Gói offline: ${path.join(fePublic, 'data')}`);
