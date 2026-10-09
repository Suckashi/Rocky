// A Rocky instance for tests: composed with a test token, and an authenticated call() that
// sends requests through the app without opening a port.
import { composeRocky } from '../../src/server/compose.ts';
import { EgressGuard } from '../../src/server/platform/egress.ts';

export interface TestRockyOptions {
  dataDir: string;
  /** Only names the Host header the app expects; nothing listens on it. */
  port: number;
  token?: string;
  listModels?: () => Promise<string[]>;
}

export type Call = (
  path: string,
  init?: { method?: string; body?: unknown },
) => Promise<Response>;

export function testRocky(options: TestRockyOptions) {
  const token = options.token ?? 't'.repeat(43);
  const host = `127.0.0.1:${options.port}`;
  const rocky = composeRocky({
    dataDir: options.dataDir,
    token,
    port: options.port,
    egress: new EgressGuard(() => {}),
    listModels: options.listModels ?? (async () => []),
  });
  const call: Call = (path, init = {}) =>
    Promise.resolve(
      rocky.app.request(`http://${host}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          host,
          authorization: `Bearer ${token}`,
          ...(init.body !== undefined
            ? { 'content-type': 'application/json' }
            : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      }),
    );
  return { rocky, call, token, host };
}
