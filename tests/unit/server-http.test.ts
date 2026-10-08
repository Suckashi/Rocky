import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/http/app.ts';
import { LoginCodes } from '../../src/server/http/login-codes.ts';
import { loadOrCreateToken } from '../../src/server/http/token.ts';
import { createShutdown } from '../../src/server/shutdown.ts';

const PORT = 4317;
const HOST = `127.0.0.1:${PORT}`;
const token = 'x'.repeat(43);

function setup() {
  const codes = new LoginCodes();
  const app = createApp({ token, codes, port: PORT });
  const call = (
    path: string,
    init: RequestInit & { headers?: Record<string, string> } = {},
  ) =>
    app.request(`http://${HOST}${path}`, {
      ...init,
      headers: { host: HOST, ...init.headers },
    });
  return { app, codes, call };
}

describe('local API security', () => {
  it('rejects API calls without the token', async () => {
    const { call } = setup();
    expect((await call('/api/health')).status).toBe(401);
    expect(
      (
        await call('/api/health', {
          headers: { authorization: 'Bearer wrong' },
        })
      ).status,
    ).toBe(401);
  });

  it('accepts the token as a bearer header', async () => {
    const { call } = setup();
    const res = await call('/api/health', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects other Host headers, so DNS rebinding cannot reach the API', async () => {
    const { call } = setup();
    const auth = { authorization: `Bearer ${token}` };
    for (const host of [
      'evil.example:4317',
      '127.0.0.1:9999',
      '192.168.1.5:4317',
    ]) {
      expect(
        (await call('/api/health', { headers: { ...auth, host } })).status,
      ).toBe(403);
    }
    expect(
      (await call('/', { headers: { host: 'evil.example' } })).status,
    ).toBe(403);
    expect(
      (
        await call('/api/health', {
          headers: { ...auth, host: `localhost:${PORT}` },
        })
      ).status,
    ).toBe(200);
  });

  it('rejects cross-origin and cross-site requests even with the token', async () => {
    const { call } = setup();
    const auth = { authorization: `Bearer ${token}` };
    const cases = [
      { origin: 'http://evil.example' },
      { origin: `http://127.0.0.1:${PORT + 1}` },
      { 'sec-fetch-site': 'cross-site' },
    ];
    for (const headers of cases) {
      expect(
        (await call('/api/health', { headers: { ...auth, ...headers } }))
          .status,
      ).toBe(403);
    }
    expect(
      (
        await call('/api/health', {
          headers: { ...auth, origin: `http://${HOST}` },
        })
      ).status,
    ).toBe(200);
  });

  it('requires JSON for writes and limits the body size', async () => {
    const { call } = setup();
    const auth = { authorization: `Bearer ${token}` };
    const form = await call('/api/health', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'text/plain' },
      body: 'x',
    });
    expect(form.status).toBe(415);
    const big = await call('/api/anything', {
      method: 'POST',
      headers: {
        ...auth,
        'content-type': 'application/json',
        'content-length': '3000000',
      },
      body: 'x'.repeat(3_000_000),
    });
    expect(big.status).toBe(413);
  });

  it('trades a one-time login code for an HttpOnly session cookie', async () => {
    const { call, codes } = setup();
    const code = codes.issue();
    const first = await call(`/?code=${code}`);
    expect(first.status).toBe(302);
    expect(first.headers.get('location')).toBe('/');
    const cookie = first.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/rocky_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    const session = cookie.split(';')[0]!;
    expect(
      (await call('/api/health', { headers: { cookie: session } })).status,
    ).toBe(200);
    // The code works once.
    const again = await call(`/?code=${code}`);
    expect(again.headers.get('set-cookie')).toBeNull();
  });

  it('gives an authenticated caller a fresh login URL', async () => {
    const { call, codes } = setup();
    const denied = await call('/api/login-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(denied.status).toBe(401);
    const res = await call('/api/login-code', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    const { url } = (await res.json()) as { url: string };
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:4317\/\?code=/);
    expect(codes.redeem(new URL(url).searchParams.get('code')!)).toBe(true);
  });

  it('expires login codes', () => {
    let now = 0;
    const codes = new LoginCodes(1000, () => now);
    const code = codes.issue();
    now = 1001;
    expect(codes.redeem(code)).toBe(false);
  });

  it('sets a strict content security policy', async () => {
    const { call } = setup();
    const res = await call('/api/health', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.headers.get('content-security-policy')).toContain(
      "connect-src 'self'",
    );
    expect(res.headers.get('content-security-policy')).toContain(
      "frame-ancestors 'none'",
    );
  });
});

describe('API token file', () => {
  it('creates a long random token once and reuses it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rocky-token-'));
    const first = loadOrCreateToken(dir);
    expect(first.length).toBeGreaterThanOrEqual(43);
    expect(loadOrCreateToken(dir)).toBe(first);
    expect(readFileSync(join(dir, 'api-token'), 'utf8').trim()).toBe(first);
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, 'api-token')).mode & 0o077).toBe(0);
    }
  });
});

describe('shutdown', () => {
  it('exits 1 when a step hangs past the deadline', async () => {
    const codes: number[] = [];
    const shutdown = createShutdown({
      steps: [{ name: 'hang', run: () => new Promise(() => {}) }],
      exit: (code) => codes.push(code),
      report: () => {},
      timeoutMs: 20,
    });
    await shutdown();
    await shutdown(); // idempotent
    expect(codes).toEqual([1]);
  });

  it('exits 0 when every step finishes', async () => {
    const codes: number[] = [];
    await createShutdown({
      steps: [{ name: 'ok', run: () => {} }],
      exit: (code) => codes.push(code),
      report: () => {},
    })();
    expect(codes).toEqual([0]);
  });
});
