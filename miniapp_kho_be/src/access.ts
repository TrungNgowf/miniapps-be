import { ApiError } from './errors.js';
import type { Capability, Location, Principal } from './types.js';

/**
 * Cây tenant của Siêu thị Minh Phát, khớp bảng `tenants` của portal.
 * Quyền ở tenant cha kế thừa xuống tenant con.
 */
const PARENT: Record<string, string | null> = {
  minhphat: null,
  'minhphat-mb': 'minhphat',
  'minhphat-hadong': 'minhphat-mb',
  'minhphat-caugiay': 'minhphat-mb',
  'minhphat-mn': 'minhphat',
};

export const ROOT_TENANT = 'minhphat';

const ROLE_CAPS: Record<string, Capability[]> = {
  CASHIER: ['stock.read'],
  STORE_KEEPER: ['stock.read', 'stock.write', 'transfer.request', 'transfer.receive'],
  MANAGER: ['stock.read', 'stock.write', 'stock.minimum', 'transfer.request', 'transfer.receive', 'transfer.approve'],
  REGION_LEAD: ['stock.read', 'stock.write', 'stock.minimum', 'transfer.request', 'transfer.receive', 'transfer.approve'],
  DIRECTOR: ['stock.read', 'stock.write', 'stock.minimum', 'transfer.request', 'transfer.receive', 'transfer.approve'],
  ADMIN: ['stock.read', 'stock.write', 'stock.minimum', 'transfer.request', 'transfer.receive', 'transfer.approve'],
};

export function capabilitiesOf(roles: readonly string[]): Capability[] {
  const caps = new Set<Capability>();
  for (const role of roles) for (const cap of ROLE_CAPS[role] ?? []) caps.add(cap);
  return [...caps];
}

export function inTenantTree(tenantId: string): boolean {
  return tenantId in PARENT;
}

/** `tenantId` có nằm trong nhánh của `ancestorId` (kể cả chính nó) không. */
export function isWithin(tenantId: string, ancestorId: string): boolean {
  let current: string | null | undefined = tenantId;
  while (current) {
    if (current === ancestorId) return true;
    current = PARENT[current];
  }
  return false;
}

export interface Access {
  principal: Principal;
  caps: Set<Capability>;
  /** Địa điểm người dùng được xem và thao tác */
  scope: Set<string>;
  /** Kho tổng, mọi người trong Minh Phát được xem số tồn để đặt hàng */
  readable: Set<string>;
}

export function buildAccess(principal: Principal, locations: readonly Location[]): Access {
  if (!inTenantTree(principal.tenantId)) {
    throw new ApiError(403, 'FORBIDDEN', 'Tài khoản không thuộc Siêu thị Minh Phát');
  }
  const caps = new Set(capabilitiesOf(principal.roles));
  if (!caps.has('stock.read')) {
    throw new ApiError(403, 'FORBIDDEN', 'Vai trò của bạn chưa được dùng ứng dụng Kho hàng');
  }
  const scope = new Set(
    locations.filter((location) => isWithin(location.tenantId, principal.tenantId)).map((l) => l.locationId),
  );
  const readable = new Set(scope);
  for (const location of locations) if (location.kind === 'warehouse') readable.add(location.locationId);
  return { principal, caps, scope, readable };
}

export function requireCap(access: Access, cap: Capability): void {
  if (!access.caps.has(cap)) throw new ApiError(403, 'FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này');
}

export function requireScope(access: Access, locationId: string, mode: 'read' | 'write'): void {
  const allowed = mode === 'read' ? access.readable : access.scope;
  if (!allowed.has(locationId)) {
    throw new ApiError(403, 'FORBIDDEN', 'Bạn không được truy cập địa điểm này');
  }
}
