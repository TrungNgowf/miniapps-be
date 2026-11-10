import type { Capability, Principal } from './types.js';
import { ApiError } from './errors.js';

const MANAGERS = ['MANAGER', 'ADMIN', 'DIRECTOR', 'HR', 'REGION_LEAD', 'TEAM_LEAD'];

/** Mọi người dùng xem được danh bạ. Lương và duyệt phép chỉ dành cho quản lý, nhân sự, quản trị. */
export function capabilitiesOf(p: Principal): Capability[] {
  const caps: Capability[] = ['directory.read'];
  if (p.roles.some((r) => MANAGERS.includes(r))) caps.push('stats.read', 'leave.approve');
  if (p.roles.some((r) => ['ADMIN', 'DIRECTOR', 'HR'].includes(r))) caps.push('salary.read');
  return caps;
}

export function requireCap(p: Principal, cap: Capability): void {
  if (!capabilitiesOf(p).includes(cap)) throw new ApiError(403, 'FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này');
}
