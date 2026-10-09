import { describe, expect, it } from 'vitest';
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';
import {
  openCodeConfig,
  openCodeEnv,
  readPermission,
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

  /** OpenCode 1.18's own matching: `\\` becomes `/`, `*` matches anything, case-sensitive,
   * and of the matching patterns the longest wins. */
  function opencodeDecides(rules: Record<string, string>, file: string) {
    const path = file.replaceAll('\\', '/');
    return Object.entries(rules)
      .sort(([a], [b]) => a.length - b.length || a.localeCompare(b))
      .filter(([pattern]) =>
        new RegExp(
          `^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
          's',
        ).test(path),
      )
      .at(-1)?.[1];
  }

  it('the config uses these rules', () => {
    const config = openCodeConfig(model) as {
      permission: { read: Record<string, string> };
    };
    expect(config.permission.read).toEqual(readPermission());
  });

  it('asks before reading the secret files Rocky knows', () => {
    const decide = (file: string) =>
      opencodeDecides(readPermission('linux'), file);
    expect(decide('/w/app.js')).toBe('allow');
    expect(decide('/w/.env')).toBe('ask');
    expect(decide('/w/.env.local')).toBe('ask');
    expect(decide('/w/.env.example')).toBe('allow');
    expect(decide('/w/certs/server.key')).toBe('ask');
    expect(decide('/home/u/.ssh/config')).toBe('ask');
    expect(decide('/w/credentials.json')).toBe('ask');
  });

  it('on Windows also asks for the usual upper- and mixed-case spellings', () => {
    const decide = (file: string) =>
      opencodeDecides(readPermission('win32'), file);
    expect(decide('C:\\w\\app.js')).toBe('allow');
    expect(decide('C:\\w\\.env')).toBe('ask');
    expect(decide('C:\\w\\.ENV')).toBe('ask');
    expect(decide('C:\\w\\.Env.Local')).toBe('ask');
    expect(decide('C:\\w\\certs\\Server.KEY')).toBe('ask');
    expect(decide('C:\\w\\certs\\server.Key')).toBe('ask');
    expect(decide('C:\\Users\\u\\.SSH\\config')).toBe('ask');
    expect(decide('C:\\Users\\u\\.aws\\Credentials')).toBe('ask');
    expect(decide('C:\\w\\.ENV.EXAMPLE')).toBe('allow');
    // An unusual mix fails safe when it is an example file (asks)...
    expect(decide('C:\\w\\.ENV.example')).toBe('ask');
    // ...but not when it is a secret: OpenCode patterns cannot ignore case (ADR 0020).
    expect(decide('C:\\w\\.eNv')).toBe('allow');
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
