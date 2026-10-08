// One guard in front of the local API. Adapted from OpenDots' API guard (MIT), with
// authentication always on: Rocky has no unauthenticated mode.
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { sameToken } from './token.ts';

export const SESSION_COOKIE = 'rocky_session';

export interface GuardOptions {
  token: string;
  port: number;
}

export function allowedHosts(port: number): Set<string> {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
}

/** Host and Origin checks for every request, so another site cannot reach Rocky via DNS rebinding. */
export function originGuard({ port }: GuardOptions): MiddlewareHandler {
  const hosts = allowedHosts(port);
  const origins = new Set([...hosts].map((host) => `http://${host}`));
  return async (c, next) => {
    if (!hosts.has(c.req.header('host') ?? '')) {
      return c.json({ error: 'unrecognized-host' }, 403);
    }
    const origin = c.req.header('origin');
    if (origin && !origins.has(origin)) {
      return c.json({ error: 'cross-origin' }, 403);
    }
    if (c.req.header('sec-fetch-site') === 'cross-site') {
      return c.json({ error: 'cross-site' }, 403);
    }
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    await next();
  };
}

/** Every /api call carries the session cookie or the token as a bearer header. */
export function authGuard({ token }: GuardOptions): MiddlewareHandler {
  return async (c, next) => {
    const bearer = c.req.header('authorization')?.replace(/^Bearer /, '');
    if (!sameToken(token, getCookie(c, SESSION_COOKIE) ?? bearer)) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    c.header('Cache-Control', 'no-store');
    const method = c.req.method;
    if (
      !['GET', 'HEAD'].includes(method) &&
      !c.req.header('content-type')?.includes('application/json')
    ) {
      return c.json({ error: 'json-required' }, 415);
    }
    await next();
  };
}
