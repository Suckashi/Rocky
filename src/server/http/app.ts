// The HTTP app: security first, then the API, then the built web UI.
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { setCookie } from 'hono/cookie';
import {
  authGuard,
  originGuard,
  SESSION_COOKIE,
  type GuardOptions,
} from './security.ts';
import type { LoginCodes } from './login-codes.ts';

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

  app.use(
    '/api/*',
    bodyLimit({
      maxSize: 2_000_000,
      onError: (c) => c.json({ error: 'too-large' }, 413),
    }),
  );
  app.use('/api/*', authGuard(options));
  app.get('/api/health', (c) => c.json({ ok: true }));
  for (const routes of options.api ?? []) app.route('/api', routes);
  for (const routes of options.mounted ?? []) app.route('/', routes);
  app.all('/api/*', (c) => c.json({ error: 'not-found' }, 404));

  if (options.webRoot) {
    app.use('/*', serveStatic({ root: options.webRoot }));
    app.get('*', serveStatic({ root: options.webRoot, path: 'index.html' }));
  }
  app.onError((error, c) => {
    console.error('request failed:', error.name, error.message);
    return c.json({ error: 'internal' }, 500);
  });
  return app;
}
