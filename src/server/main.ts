// Composition root: build every part, listen on 127.0.0.1 only, shut down with a deadline.
// Started through start.ts, which sets the telemetry opt-outs before any module loads.
import { serve } from '@hono/node-server';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { composeRocky } from './compose.ts';
import { loadOrCreateToken } from './http/token.ts';
import { openBrowser } from './platform/open-browser.ts';
import { dataDir } from './platform/paths.ts';
import { createShutdown } from './shutdown.ts';

const HOST = '127.0.0.1';
const port = Number(process.env['ROCKY_PORT'] ?? 4317);
const dir = dataDir();
const token = loadOrCreateToken(dir);
const webRoot = join(import.meta.dirname, '..', '..', 'dist', 'web');

const rocky = composeRocky({
  dataDir: dir,
  token,
  port,
  ...(existsSync(webRoot) ? { webRoot } : {}),
});
const { app, codes, db, threads, runner } = rocky;
rocky.egress.install();
const server = serve({ fetch: app.fetch, hostname: HOST, port }, (info) => {
  // Only now does this process own the port; before this, another Rocky may be running.
  const interrupted = rocky.recoverInterrupted();
  if (interrupted.runs + interrupted.actions + interrupted.jobs > 0) {
    console.log(
      `Interrupted last time: ${interrupted.runs} run(s), ${interrupted.actions} action(s), ${interrupted.jobs} job(s); they stay marked unknown and are not restarted.`,
    );
  }
  // A one-time code, valid for two minutes; the API token never leaves this process.
  const url = `http://${HOST}:${info.port}/?code=${codes.issue()}`;
  console.log(`Rocky is running. Open: ${url}`);
  if (process.env['ROCKY_OPEN_BROWSER'] !== '0') openBrowser(url);
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `Port ${port} is in use. If Rocky is already running, run the launcher again to open it; otherwise set ROCKY_PORT.`,
    );
    process.exit(1);
  }
  throw error;
});

const shutdown = createShutdown({
  steps: [
    {
      name: 'runs',
      run: async () => {
        for (const thread of threads.threads())
          await runner.stop({ threadId: thread.id });
      },
    },
    { name: 'mcp', run: () => rocky.mcp.close() },
    {
      name: 'http',
      run: () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    },
  ],
  exit: (code) => {
    db.close();
    process.exit(code);
  },
  report: (step, error) =>
    console.error(`shutdown step ${step} failed:`, error),
});
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
