// Composition root: build every part, listen on 127.0.0.1 only, shut down with a deadline.
import { serve } from '@hono/node-server';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from './http/app.ts';
import { LoginCodes } from './http/login-codes.ts';
import { loadOrCreateToken } from './http/token.ts';
import { openBrowser } from './platform/open-browser.ts';
import { dataDir } from './platform/paths.ts';
import { createShutdown } from './shutdown.ts';

const HOST = '127.0.0.1';
const port = Number(process.env['ROCKY_PORT'] ?? 4317);
const dir = dataDir();
const token = loadOrCreateToken(dir);
const webRoot = join(import.meta.dirname, '..', '..', 'dist', 'web');

const codes = new LoginCodes();

const app = createApp({
  token,
  codes,
  port,
  ...(existsSync(webRoot) ? { webRoot } : {}),
});

const server = serve({ fetch: app.fetch, hostname: HOST, port }, (info) => {
  // A one-time code, valid for two minutes; the API token never leaves this process.
  const url = `http://${HOST}:${info.port}/?code=${codes.issue()}`;
  console.log(`Rocky is running. Open: ${url}`);
  if (process.env['ROCKY_OPEN_BROWSER'] !== '0') openBrowser(url);
});

const shutdown = createShutdown({
  steps: [
    {
      name: 'http',
      run: () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    },
  ],
  exit: (code) => process.exit(code),
  report: (step, error) =>
    console.error(`shutdown step ${step} failed:`, error),
});
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
