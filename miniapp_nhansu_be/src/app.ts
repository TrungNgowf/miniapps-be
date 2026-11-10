import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import { capabilitiesOf, requireCap } from './access.js';
import { bearerToken, type Authenticator } from './auth.js';
import { ApiError } from './errors.js';
import type { Store } from './store.js';
import type { Employee, Leave, Principal } from './types.js';

const who = new WeakMap<FastifyRequest, Principal>();
const me = (r: FastifyRequest): Principal => {
  const p = who.get(r);
  if (!p) throw new ApiError(401, 'UNAUTHORIZED', 'Cần đăng nhập');
  return p;
};

const page = z.object({
  q: z.string().trim().max(60).default(''),
  dept: z.string().max(40).default(''),
  status: z.enum(['', 'active', 'leave', 'probation']).default(''),
  sort: z.enum(['name', 'hired', 'level']).default('name'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const leaveBody = z.object({
  employeeId: z.number().int().positive(),
  type: z.enum(['Phép năm', 'Nghỉ ốm', 'Việc riêng', 'Thai sản']),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().max(200).default(''),
  requestId: z.string().min(8).max(64).optional(),
});

function strip(e: Employee, salary: boolean): Omit<Employee, 'salary'> & { salary?: number } {
  if (salary) return e;
  const { salary: _s, ...rest } = e;
  return rest;
}

export function buildApp(store: Store, auth: Authenticator): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, bodyLimit: 256 * 1024 });
  void app.register(cors, { origin: true, allowedHeaders: ['authorization', 'content-type'], methods: ['GET', 'POST', 'OPTIONS'] });

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ApiError) return reply.status(error.status).send({ error: { code: error.code, message: error.message } });
    if (error instanceof ZodError) return reply.status(400).send({ error: { code: 'INVALID_REQUEST', message: error.issues[0]?.message ?? 'Dữ liệu không hợp lệ' } });
    app.log.error(error);
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Lỗi máy chủ' } });
  });

  app.get('/health', async () => ({ ok: true, version: store.meta.version, employees: store.employees.length }));

  app.addHook('preHandler', async (request) => {
    if (!request.url.startsWith('/api/')) return;
    who.set(request, await auth.authenticate(bearerToken(request.headers.authorization)));
  });

  app.get('/api/me', async (request) => {
    const p = me(request);
    return { user: p, capabilities: capabilitiesOf(p) };
  });

  app.get('/api/catalog/version', async () => store.meta);

  app.get('/api/employees', async (request) => {
    const p = me(request);
    const q = page.parse(request.query);
    const needle = q.q.toLowerCase();
    let rows = store.employees.filter(
      (e) => (!q.dept || e.dept === q.dept) && (!q.status || e.status === q.status) && (!needle || e.name.toLowerCase().includes(needle) || e.code.toLowerCase().includes(needle) || e.email.includes(needle)),
    );
    if (q.sort === 'hired') rows = [...rows].sort((a, b) => b.hired.localeCompare(a.hired));
    else if (q.sort === 'level') rows = [...rows].sort((a, b) => b.level - a.level || a.id - b.id);
    else rows = [...rows].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    const salary = capabilitiesOf(p).includes('salary.read');
    return { total: rows.length, rows: rows.slice(q.offset, q.offset + q.limit).map((e) => strip(e, salary)) };
  });

  app.get('/api/employees/:id', async (request) => {
    const p = me(request);
    const id = Number((request.params as { id: string }).id);
    const e = store.byId.get(id);
    if (!e) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy nhân viên');
    const att = store.attendance(e);
    return {
      employee: strip(e, capabilitiesOf(p).includes('salary.read')),
      attendance: att,
      leaves: store.leaves.filter((l) => l.employeeId === id).slice(0, 20),
    };
  });

  app.get('/api/stats', async (request) => {
    const p = me(request);
    requireCap(p, 'stats.read');
    return store.stats(capabilitiesOf(p).includes('salary.read'));
  });

  app.get('/api/leaves', async (request) => {
    const p = me(request);
    const query = z.object({ status: z.enum(['', 'pending', 'approved', 'rejected']).default(''), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }).parse(request.query);
    const canSee = capabilitiesOf(p).includes('leave.approve');
    const rows = store.leaves.filter((l) => (canSee || l.createdBy === p.userId) && (!query.status || l.status === query.status));
    return {
      total: rows.length,
      rows: rows.slice(query.offset, query.offset + query.limit).map((l) => ({ ...l, employeeName: store.byId.get(l.employeeId)?.name ?? '' })),
    };
  });

  app.post('/api/leaves', async (request, reply) => {
    const p = me(request);
    const body = leaveBody.parse(request.body);
    if (body.requestId) {
      const dup = store.leaves.find((l) => l.requestId === body.requestId);
      if (dup) return dup;
    }
    if (body.to < body.from) throw new ApiError(400, 'INVALID_RANGE', 'Ngày kết thúc phải sau ngày bắt đầu');
    const employeeId = body.employeeId;
    if (!store.byId.has(employeeId)) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy nhân viên');
    const days = Math.round((Date.parse(body.to) - Date.parse(body.from)) / 86_400_000) + 1;
    const leave: Leave = {
      id: `L${randomUUID().slice(0, 8).toUpperCase()}`,
      employeeId,
      type: body.type,
      from: body.from,
      to: body.to,
      days,
      reason: body.reason,
      status: 'pending',
      createdBy: p.userId,
      createdAt: new Date().toISOString(),
      ...(body.requestId ? { requestId: body.requestId } : {}),
    };
    store.addLeave(leave);
    return reply.status(201).send(leave);
  });

  app.post('/api/leaves/:id/:action', async (request) => {
    const p = me(request);
    requireCap(p, 'leave.approve');
    const { id, action } = request.params as { id: string; action: string };
    if (action !== 'approve' && action !== 'reject') throw new ApiError(404, 'NOT_FOUND', 'Thao tác không tồn tại');
    const leave = store.leaves.find((l) => l.id === id);
    if (!leave) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy đơn');
    if (leave.status !== 'pending') throw new ApiError(409, 'ALREADY_DECIDED', 'Đơn đã được xử lý');
    leave.status = action === 'approve' ? 'approved' : 'rejected';
    leave.decidedBy = p.userId;
    store.touch();
    return leave;
  });

  /** Dùng cho phép đo độ trễ và băng thông trong màn Hiệu năng của mini-app. */
  app.get('/api/bench', async (request) => {
    me(request);
    const kb = z.coerce.number().int().min(0).max(4096).default(0).parse((request.query as { kb?: string }).kb);
    return { t: Date.now(), pad: 'x'.repeat(kb * 1024) };
  });

  return app;
}
