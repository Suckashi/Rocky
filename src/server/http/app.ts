// The HTTP app: security first, then the API, then the built web UI.
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { setCookie } from 'hono/cookie';
import {
  authGuard,
  originGuard,
  SESSION_COOKIE,
  type GuardOptions,
} from './security.ts';
import { COPILOT_BASE_PATH } from './copilot.ts';
import type { LoginCodes } from './login-codes.ts';

/** The largest chat turn Rocky accepts: the conversation so far plus the new message. */
export const CHAT_BODY_LIMIT = 32 * 1024 * 1024;

const bodyLimitError = (c: Context) => c.json({ error: 'too-large' }, 413);

export interface AppOptions extends GuardOptions {
  codes: LoginCodes;
  /** Directory of the built web UI; omitted in API-only tests. */
  webRoot?: string;
  /** Route groups mounted under /api. */
  api?: Hono[];
  /** Apps that bring their own /api/... base path (the CopilotKit runtime). */
  mounted?: Hono[];
}

export function createApp(options: AppOptions): Hono {
  const app = new Hono();
  app.use('*', originGuard(options));
  app.use('*', async (c, next) => {
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    await next();
  });

  // The launch URL carries a one-time code; trade it for an HttpOnly cookie and drop it from the URL.
  app.get('/', async (c, next) => {
    const supplied = c.req.query('code');
    if (supplied === undefined) return next();
    if (!options.codes.redeem(supplied)) return c.redirect('/', 302);
    setCookie(c, SESSION_COOKIE, options.token, {
      httpOnly: true,
      sameSite: 'Strict',
      path: '/',
    });
    return c.redirect('/', 302);
  });

  const tooLarge = bodyLimitError;
  const apiLimit = bodyLimit({ maxSize: 2_000_000, onError: tooLarge });
  // A chat turn carries the whole conversation (the model sees a summarized history), so
  // it gets more room than the other routes (ADR 0030).
  const chatLimit = bodyLimit({ maxSize: CHAT_BODY_LIMIT, onError: tooLarge });
  // The token is checked first, from headers only, so nobody else can make Rocky read a body.
  app.use('/api/*', authGuard(options));
  app.use('/api/*', (c, next) =>
    (c.req.path === COPILOT_BASE_PATH ||
      c.req.path.startsWith(`${COPILOT_BASE_PATH}/`)
      ? chatLimit
      : apiLimit)(c, next),
  );
  app.get('/api/health', (c) => c.json({ ok: true }));
  // The launcher (which can read the token file) asks a running Rocky for a fresh login URL.
  app.post('/api/login-code', (c) =>
    c.json({
      url: `http://127.0.0.1:${options.port}/?code=${options.codes.issue()}`,
    }),
  );
  for (const routes of options.api ?? []) app.route('/api', routes);
  for (const routes of options.mounted ?? []) app.route('/', routes);
  app.all('/api/*', (c) => c.json({ error: 'not-found' }, 404));

  if (options.webRoot) {
    app.use('/*', serveStatic({ root: options.webRoot }));
    app.get('*', serveStatic({ root: options.webRoot, path: 'index.html' }));
  }
  app.onError((error, c) => {
    console.error(
      `request failed: ${c.req.method} ${c.req.path}\n`,
      error.stack ?? `${error.name}: ${error.message}`,
    );
    return c.json({ error: 'internal' }, 500);
  });
  return app;
}
