import { buildApp } from './app.js';
import { createPortalAuthenticator } from './auth.js';
import { loadConfig } from './config.js';
import { Store } from './store.js';

const config = loadConfig();
const store = Store.load(config.dataDir);
const app = buildApp(store, createPortalAuthenticator(config.portalApi, config.authCacheMs));

async function shutdown(): Promise<void> {
  await app.close();
  await store.flush();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

app
  .listen({ port: config.port, host: config.host })
  .then(() => app.log.info(`Kho hàng API: dữ liệu ${store.meta.version}, xác thực qua ${config.portalApi}`))
  .catch((error: unknown) => {
    app.log.error(error);
    process.exit(1);
  });
