import path from 'node:path';

export interface Config {
  port: number;
  host: string;
  portalApi: string;
  dataDir: string;
  authCacheMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? '4200');
  if (!Number.isInteger(port) || port <= 0) throw new Error('PORT phải là số nguyên dương');
  return {
    port,
    host: env.HOST ?? '0.0.0.0',
    portalApi: (env.PORTAL_API ?? 'https://miniapp-portal-be.onrender.com').replace(/\/$/, ''),
    dataDir: path.resolve(env.DATA_DIR ?? 'data'),
    authCacheMs: Number(env.AUTH_CACHE_MS ?? '60000'),
  };
}
