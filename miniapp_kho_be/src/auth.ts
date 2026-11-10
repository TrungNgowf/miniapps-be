import { createHash } from 'node:crypto';
import { ApiError } from './errors.js';
import type { Principal } from './types.js';

export interface Authenticator {
  authenticate(token: string): Promise<Principal>;
}

interface PortalUser {
  userId?: unknown;
  username?: unknown;
  fullName?: unknown;
  tenantId?: unknown;
  tenantName?: unknown;
  roles?: unknown;
}

function toPrincipal(body: unknown): Principal | null {
  if (!body || typeof body !== 'object' || !('user' in body)) return null;
  const user = (body as { user: PortalUser }).user;
  if (!user || typeof user.userId !== 'string' || typeof user.username !== 'string' || typeof user.tenantId !== 'string') {
    return null;
  }
  return {
    userId: user.userId,
    username: user.username,
    fullName: typeof user.fullName === 'string' && user.fullName ? user.fullName : user.username,
    tenantId: user.tenantId,
    tenantName: typeof user.tenantName === 'string' ? user.tenantName : user.tenantId,
    roles: Array.isArray(user.roles) ? user.roles.filter((role): role is string => typeof role === 'string') : [],
  };
}

export function bearerToken(header: unknown): string {
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
}

/**
 * Kiểm tra token bằng cách hỏi portal (`GET /api/auth/me`). Portal là nơi duy nhất biết token có
 * còn hiệu lực không và vai trò hiện tại của người dùng. Kết quả được nhớ ngắn hạn để không
 * gọi portal ở mỗi request.
 */
export function createPortalAuthenticator(portalApi: string, cacheMs: number): Authenticator {
  const cache = new Map<string, { principal: Principal; expires: number }>();
  return {
    async authenticate(token) {
      if (!token) throw new ApiError(401, 'UNAUTHORIZED', 'Cần đăng nhập');
      const key = createHash('sha256').update(token).digest('hex');
      const hit = cache.get(key);
      const now = Date.now();
      if (hit && hit.expires > now) return hit.principal;
      let response: Response;
      try {
        // Portal trên Render có thể ngủ, lần gọi đầu mất tới ~1 phút
        response = await fetch(`${portalApi}/api/auth/me`, {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(65_000),
        });
      } catch {
        throw new ApiError(503, 'AUTH_UNAVAILABLE', 'Không kết nối được máy chủ xác thực');
      }
      if (response.status === 401) {
        cache.delete(key);
        throw new ApiError(401, 'UNAUTHORIZED', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn');
      }
      if (!response.ok) throw new ApiError(503, 'AUTH_UNAVAILABLE', 'Máy chủ xác thực đang lỗi');
      const principal = toPrincipal(await response.json().catch(() => null));
      if (!principal) throw new ApiError(503, 'AUTH_UNAVAILABLE', 'Phản hồi xác thực không đọc được');
      cache.set(key, { principal, expires: now + cacheMs });
      if (cache.size > 2000) {
        for (const [k, v] of cache) if (v.expires <= now) cache.delete(k);
      }
      return principal;
    },
  };
}
