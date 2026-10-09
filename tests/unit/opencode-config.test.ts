import { describe, expect, it } from 'vitest';
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';
import {
  openCodeConfig,
  openCodeEnv,
} from '../../src/server/external/opencode.ts';
import { permissionEffect } from '../../src/server/external/permission.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const model = { baseURL: 'http://127.0.0.1:1/v1', model: 'm' };

describe('OpenCode launch', () => {
  it('gives every start its own server password', () => {
    const home = mkdtempSync(join(tmpdir(), 'rocky-oc-'));
    const a = openCodeEnv(home, model)['OPENCODE_SERVER_PASSWORD'];
    const b = openCodeEnv(home, model)['OPENCODE_SERVER_PASSWORD'];
    expect(a).toMatch(/^[\w-]{32}$/);
    expect(b).not.toBe(a);
  });

  it('asks before reading the secret files Rocky knows; the last match wins', () => {
    const read = (
      openCodeConfig(model) as {
        permission: { read: Record<string, string> };
      }
    ).permission.read;
    const entries = Object.entries(read);
    // OpenCode's wildcard: `*` matches anything, including path separators.
    const decide = (file: string) =>
      entries.findLast(([pattern]) =>
        new RegExp(
          `^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
        ).test(file),
      )?.[1];
    expect(decide('/w/app.js')).toBe('allow');
    expect(decide('/w/.env')).toBe('ask');
    expect(decide('/w/.env.local')).toBe('ask');
    expect(decide('/w/.env.example')).toBe('allow');
    expect(decide('/w/certs/server.key')).toBe('ask');
    expect(decide('/home/u/.ssh/config')).toBe('ask');
    expect(decide('C:\\w\\.aws\\credentials')).toBe('ask');
    expect(decide('/w/credentials.json')).toBe('ask');
  });
});

describe('OpenCode permission requests', () => {
  const request = (toolCall: object) =>
    ({
      sessionId: 's',
      toolCall,
      options: [],
    }) as unknown as RequestPermissionRequest;

  it('a read question without a path is judged as a secret read in the worktree', () => {
    expect(
      permissionEffect(
        request({ toolCallId: 't', kind: 'read', rawInput: {}, locations: [] }),
        '/wt',
      ).effect,
    ).toEqual({ kind: 'read', path: '/wt', secret: true });
  });

  it('a read question with a path is judged on that path', () => {
    expect(
      permissionEffect(
        request({
          toolCallId: 't',
          kind: 'read',
          rawInput: { filePath: 'config/.env' },
        }),
        '/wt',
      ).effect,
    ).toEqual({ kind: 'read', path: resolve('/wt', 'config/.env') });
  });
});
