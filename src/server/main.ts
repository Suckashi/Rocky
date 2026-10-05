// Composition root: build every part, listen on 127.0.0.1 only, shut down with a deadline.
// Started through start.ts, which sets the telemetry opt-outs before any module loads.
import { serve } from '@hono/node-server';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { RockyAgent } from './agent/rocky-agent.ts';
import { RockyAgentRunner } from './agent/runner.ts';
import { createApp } from './http/app.ts';
import { copilotRoutes } from './http/copilot.ts';
import { settingsRoutes } from './http/routes/settings.ts';
import { threadRoutes } from './http/routes/threads.ts';
import { LoginCodes } from './http/login-codes.ts';
import { loadOrCreateToken } from './http/token.ts';
import { EgressGuard } from './platform/egress.ts';
import { openBrowser } from './platform/open-browser.ts';
import { dataDir } from './platform/paths.ts';
import { createShutdown } from './shutdown.ts';
import { openDatabase } from './store/db.ts';
import { SettingsStore } from './store/settings.ts';
import { ThreadStore } from './store/threads.ts';

const HOST = '127.0.0.1';
const port = Number(process.env['ROCKY_PORT'] ?? 4317);
const dir = dataDir();
const token = loadOrCreateToken(dir);
const webRoot = join(import.meta.dirname, '..', '..', 'dist', 'web');

const codes = new LoginCodes();
const db = openDatabase(join(dir, 'rocky.sqlite'));
const threads = new ThreadStore(db);
const settings = new SettingsStore(db, dir);
const egress = new EgressGuard();
const savedModel = settings.model();
if (savedModel) egress.allow(savedModel.baseURL);
egress.install();
const runner = new RockyAgentRunner(threads);
const agent = new RockyAgent({ settings });
const interrupted = threads.interruptedRuns();
if (interrupted.length > 0) {
  console.log(
    `${interrupted.length} run(s) were interrupted last time; they stay marked unknown.`,
  );
}

const app = createApp({
  token,
  codes,
  port,
  api: [settingsRoutes(settings, egress), threadRoutes(threads, runner)],
  mounted: [copilotRoutes(agent, runner)],
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
      name: 'runs',
      run: async () => {
        for (const thread of threads.threads())
          await runner.stop({ threadId: thread.id });
      },
    },
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
