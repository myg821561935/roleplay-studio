import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { migrateData } from './data/migrations.js';
import { APP_VERSION } from './releaseInfo.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootDir = process.env.APP_ROOT ? path.resolve(process.env.APP_ROOT) : projectRoot;
const port = Number(process.env.PORT || 5178);
const host = String(process.env.BIND_HOST || '127.0.0.1');
const migration = await migrateData({ rootDir });
const app = createApp({ rootDir });
const server = createServer(app);

server.on('error', (error) => {
  console.error('[local-roleplay-agent] Server failed to start', error);
  process.exitCode = 1;
});

process.on('unhandledRejection', (reason) => {
  console.error('[local-roleplay-agent] Unhandled rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[local-roleplay-agent] Uncaught exception:', error);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`Local roleplay agent v${APP_VERSION} running at http://${host}:${port}`);
  console.log(`Data schema v${migration.currentVersion}; applied migrations: ${migration.applied.join(', ') || 'none'}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      app.close?.();
      process.exit(0);
    });
  });
}
