import cors from '@fastify/cors';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import { buildAccess, requireCap, requireScope, type Access } from './access.js';
import { bearerToken, type Authenticator } from './auth.js';
import { ApiError } from './errors.js';
import type { Store } from './store.js';
import type { MovementType, TransferStatus } from './types.js';

const accessOf = new WeakMap<FastifyRequest, Access>();

function access(request: FastifyRequest): Access {
  const found = accessOf.get(request);
  if (!found) throw new ApiError(401, 'UNAUTHORIZED', 'Cần đăng nhập');
  return found;
}

/** Giá vốn và giá trị tồn tính theo giá vốn chỉ dành cho quản lý trở lên. */
function seesCost(a: Access): boolean {
  return a.caps.has('stock.minimum');
}

function withoutCost<T extends { cost?: number; value?: number }>(row: T, a: Access): T {
  if (seesCost(a)) return row;
  const { cost: _cost, value: _value, ...rest } = row;
  return rest as T;
}

const limitSchema = z.coerce.number().int().min(1).max(200).default(50);
const offsetSchema = z.coerce.number().int().min(0).default(0);
const sku = z.string().regex(/^MP\d{6}$/, 'Mã hàng không hợp lệ');
const requestId = z.string().min(8).max(64).optional();
const qty = z.number().int().positive().max(100_000);

const receiptBody = z.object({
  locationId: z.string().min(1),
  lines: z.array(z.object({ sku, qty })).min(1).max(100),
  note: z.string().max(200).default(''),
  requestId,
});
const wasteBody = z.object({
  locationId: z.string().min(1),
  sku,
  qty,
  reason: z.enum(['Hết hạn sử dụng', 'Hư hỏng', 'Thất thoát', 'Dùng nội bộ']),
  requestId,
});
const adjustBody = z.object({
  locationId: z.string().min(1),
  sku,
  countedQty: z.number().int().min(0).max(100_000),
  expectedQty: z.number().int().min(0).max(100_000),
  note: z.string().max(200).default(''),
  requestId,
});
const transferBody = z.object({
  fromLocationId: z.string().min(1),
  toLocationId: z.string().min(1),
  lines: z.array(z.object({ sku, qty })).min(1).max(100),
  note: z.string().max(200).default(''),
});
const receiveBody = z
  .object({
    note: z.string().max(200).optional(),
    received: z.array(z.object({ sku, qty: z.number().int().min(0).max(100_000) })).optional(),
  })
  .default({});
const noteBody = z.object({ note: z.string().max(200).optional() }).default({});

const MOVEMENT_TYPES = ['RECEIPT', 'SALE', 'ADJUST', 'TRANSFER_OUT', 'TRANSFER_IN', 'WASTE'] as const;
const TRANSFER_STATUSES = ['REQUESTED', 'APPROVED', 'SHIPPED', 'RECEIVED', 'REJECTED', 'CANCELLED'] as const;

export function buildApp(store: Store, auth: Authenticator): FastifyInstance {
  const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 });

  app.register(cors, {
    // WebView mở bằng file:// gửi Origin: null. Xác thực dùng Bearer, không dùng cookie.
    origin: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT'],
    allowedHeaders: ['content-type', 'authorization'],
    maxAge: 600,
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') },
      });
    }
    const status = typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (status >= 400 && status < 500) {
      return reply.code(status).send({ error: { code: 'BAD_REQUEST', message: 'Yêu cầu không hợp lệ' } });
    }
    request.log.error(error);
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Lỗi hệ thống' } });
  });

  app.get('/health', async () => ({ ok: true, dataVersion: store.meta.version }));

  // Mọi route /api còn lại cần Bearer hợp lệ và một vai trò được dùng ứng dụng
  app.addHook('preHandler', async (request) => {
    if (!request.url.startsWith('/api/')) return;
    const principal = await auth.authenticate(bearerToken(request.headers.authorization));
    accessOf.set(request, buildAccess(principal, store.locations));
  });

  const placeOf = (id: string) => store.location(id);

  app.get('/api/me', async (request, reply) => {
    const a = access(request);
    reply.header('cache-control', 'no-store');
    return {
      user: a.principal,
      capabilities: [...a.caps],
      locations: store.locations.filter((l) => a.readable.has(l.locationId)).map((l) => ({ ...l, writable: a.scope.has(l.locationId) })),
      today: store.today,
    };
  });

  app.get('/api/catalog/version', async () => ({
    version: store.meta.version,
    products: store.meta.products,
    generatedAt: store.meta.generatedAt,
  }));

  app.get('/api/products', async (request) => {
    const a = access(request);
    const query = z
      .object({ q: z.string().max(100).optional(), category: z.string().optional(), brand: z.string().optional(), limit: limitSchema, offset: offsetSchema })
      .parse(request.query);
    const result = store.searchProducts(query, query.limit, query.offset);
    return { total: result.total, items: result.items.map((p) => withoutCost(p, a)) };
  });

  app.get('/api/products/barcode/:code', async (request) => {
    const a = access(request);
    const { code } = z.object({ code: z.string().min(4).max(32) }).parse(request.params);
    const product = store.findByBarcode(code);
    if (!product) throw new ApiError(404, 'NOT_FOUND', 'Không có sản phẩm với mã vạch này');
    return withoutCost(product, a);
  });

  app.get('/api/products/:sku', async (request) => {
    const a = access(request);
    const params = z.object({ sku }).parse(request.params);
    const product = store.product(params.sku);
    const stock = store.stockAcross(product.sku, a.readable).map((row) => ({ ...row, name: placeOf(row.locationId).name, kind: placeOf(row.locationId).kind }));
    const recent = store.listMovements(a.scope, { sku: product.sku }, 20);
    return { product: withoutCost(product, a), priceHistory: store.priceHistory[product.sku] ?? [], stock, movements: recent.items };
  });

  app.get('/api/stock', async (request) => {
    const a = access(request);
    const query = z
      .object({
        location: z.string().min(1),
        q: z.string().max(100).optional(),
        category: z.string().optional(),
        status: z.enum(['out', 'low', 'ok']).optional(),
        sort: z.enum(['name', 'qty', 'value', 'cover']).optional(),
        limit: limitSchema,
        offset: offsetSchema,
      })
      .parse(request.query);
    requireScope(a, query.location, 'read');
    const result = store.listStock(query.location, query, query.limit, query.offset);
    if (seesCost(a)) return result;
    const { value: _value, ...summary } = result.summary;
    return { ...result, summary, items: result.items.map((item) => withoutCost(item, a)) };
  });

  app.post('/api/stock/receipts', async (request, reply) => {
    const a = access(request);
    requireCap(a, 'stock.write');
    const body = receiptBody.parse(request.body);
    requireScope(a, body.locationId, 'write');
    const movements = store.receive(a.principal, body.locationId, body.lines, body.note, body.requestId);
    return reply.code(201).send({ movements });
  });

  app.post('/api/stock/waste', async (request, reply) => {
    const a = access(request);
    requireCap(a, 'stock.write');
    const body = wasteBody.parse(request.body);
    requireScope(a, body.locationId, 'write');
    return reply.code(201).send({ movement: store.waste(a.principal, body.locationId, body.sku, body.qty, body.reason, body.requestId) });
  });

  app.post('/api/stock/adjustments', async (request, reply) => {
    const a = access(request);
    requireCap(a, 'stock.write');
    const body = adjustBody.parse(request.body);
    requireScope(a, body.locationId, 'write');
    const movement = store.adjust(a.principal, body.locationId, body.sku, body.countedQty, body.expectedQty, body.note, body.requestId);
    return reply.code(movement ? 201 : 200).send({ movement, unchanged: movement === null });
  });

  app.put('/api/stock/:locationId/:sku/minimum', async (request) => {
    const a = access(request);
    requireCap(a, 'stock.minimum');
    const params = z.object({ locationId: z.string(), sku }).parse(request.params);
    const body = z.object({ min: z.number().int().min(0).max(100_000) }).parse(request.body);
    requireScope(a, params.locationId, 'write');
    store.setMinimum(params.locationId, params.sku, body.min);
    return { locationId: params.locationId, sku: params.sku, min: body.min };
  });

  app.get('/api/movements', async (request) => {
    const a = access(request);
    const query = z
      .object({
        location: z.string().optional(),
        sku: sku.optional(),
        type: z.enum(MOVEMENT_TYPES).optional(),
        limit: limitSchema,
        cursor: z.coerce.number().int().min(0).optional(),
      })
      .parse(request.query);
    if (query.location) requireScope(a, query.location, 'read');
    const scope = query.location ? new Set([query.location]) : a.scope;
    return store.listMovements(scope, { locationId: query.location, sku: query.sku, type: query.type as MovementType | undefined }, query.limit, query.cursor);
  });

  const transferView = (t: ReturnType<Store['transfer']>) => ({
    ...t,
    from: placeOf(t.fromLocationId).name,
    to: placeOf(t.toLocationId).name,
    lines: t.lines.map((l) => {
      const p = store.product(l.sku);
      return { ...l, name: p.name, unit: p.unit, imageId: p.imageId };
    }),
  });

  const visibleTransfer = (a: Access, id: string) => {
    const t = store.transfer(id);
    if (!a.scope.has(t.fromLocationId) && !a.scope.has(t.toLocationId)) throw new ApiError(404, 'NOT_FOUND', 'Không có phiếu chuyển kho này');
    return t;
  };

  app.get('/api/transfers', async (request) => {
    const a = access(request);
    const query = z.object({ status: z.enum(TRANSFER_STATUSES).optional(), location: z.string().optional() }).parse(request.query);
    const items = store.listTransfers(a.scope, { status: query.status as TransferStatus | undefined, locationId: query.location });
    return { items: items.map(transferView) };
  });

  app.get('/api/transfers/:id', async (request) => {
    const a = access(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    return transferView(visibleTransfer(a, id));
  });

  app.post('/api/transfers', async (request, reply) => {
    const a = access(request);
    requireCap(a, 'transfer.request');
    const body = transferBody.parse(request.body);
    requireScope(a, body.toLocationId, 'write');
    requireScope(a, body.fromLocationId, 'read');
    return reply.code(201).send(transferView(store.createTransfer(a.principal, body)));
  });

  app.post('/api/transfers/:id/:action', async (request) => {
    const a = access(request);
    const params = z.object({ id: z.string(), action: z.enum(['approve', 'reject', 'ship', 'receive', 'cancel']) }).parse(request.params);
    const transfer = visibleTransfer(a, params.id);
    switch (params.action) {
      case 'approve':
      case 'reject': {
        requireCap(a, 'transfer.approve');
        requireScope(a, transfer.fromLocationId, 'write');
        const body = noteBody.parse(request.body);
        return transferView(store.transition(a.principal, transfer.id, params.action === 'approve' ? 'APPROVED' : 'REJECTED', body));
      }
      case 'ship': {
        requireCap(a, 'stock.write');
        requireScope(a, transfer.fromLocationId, 'write');
        return transferView(store.transition(a.principal, transfer.id, 'SHIPPED', noteBody.parse(request.body)));
      }
      case 'receive': {
        requireCap(a, 'transfer.receive');
        requireScope(a, transfer.toLocationId, 'write');
        return transferView(store.transition(a.principal, transfer.id, 'RECEIVED', receiveBody.parse(request.body)));
      }
      case 'cancel': {
        const mine = transfer.createdBy === a.principal.username;
        if (!mine) requireCap(a, 'transfer.approve');
        return transferView(store.transition(a.principal, transfer.id, 'CANCELLED', noteBody.parse(request.body)));
      }
    }
  });

  app.get('/api/dashboard', async (request, reply) => {
    const a = access(request);
    const query = z.object({ location: z.string().optional(), days: z.coerce.number().int().min(7).max(180).default(30) }).parse(request.query);
    if (query.location) requireScope(a, query.location, 'read');
    reply.header('cache-control', 'no-store');
    const result = store.dashboard(a.scope, query.location ?? null, query.days);
    if (seesCost(a)) return result;
    const { costValue: _cost, ...stock } = result.stock;
    return { ...result, stock, slow: result.slow.map((row) => withoutCost(row, a)) };
  });

  app.get('/api/replenishment', async (request) => {
    const a = access(request);
    const query = z.object({ location: z.string().min(1) }).parse(request.query);
    requireScope(a, query.location, 'read');
    const items = store.replenishment(query.location);
    return { total: items.length, items: items.slice(0, 100) };
  });

  return app;
}
