import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  agentToolName,
  mask,
  McpManager,
  type McpServerConfig,
} from '../../src/server/mcp/manager.ts';
import { addMcpTools } from '../../src/server/agent/mcp.ts';
import { ToolRegistry } from '../../src/server/agent/registry.ts';

const fixture = join(import.meta.dirname, '../fixtures/mcp-server.ts');

/** A test server that logs each start (with its pid) to the returned file. */
function server(mode?: string, env: Record<string, string> = {}) {
  const log = join(mkdtempSync(join(tmpdir(), 'rocky-mcp-')), 'starts.log');
  const config: McpServerConfig = {
    name: 'notes',
    transport: 'stdio',
    command: process.execPath,
    args: [fixture],
    env: { MCP_START_LOG: log, ...(mode ? { MCP_MODE: mode } : {}), ...env },
  };
  const starts = () =>
    existsSync(log)
      ? readFileSync(log, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => Number(l.split(' ')[1]))
      : [];
  return { config, starts };
}

const running = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('MCP manager', () => {
  it('starts one server process when two refreshes overlap', async () => {
    const log = join(mkdtempSync(join(tmpdir(), 'rocky-mcp-')), 'starts.log');
    const config: McpServerConfig = {
      name: 'notes',
      transport: 'stdio',
      command: process.execPath,
      args: [join(import.meta.dirname, '../fixtures/mcp-server.ts')],
      env: { MCP_START_LOG: log },
    };
    const manager = new McpManager();
    try {
      const [a, b] = await Promise.all([
        manager.refresh([config]),
        manager.refresh([config]),
      ]);
      expect(a[0]?.connected).toBe(true);
      expect(b[0]?.connected).toBe(true);
      expect(existsSync(log)).toBe(true);
      expect(
        readFileSync(log, 'utf8').split('\n').filter(Boolean),
      ).toHaveLength(1);
      // A later refresh with the same settings reuses the connection.
      await manager.refresh([config]);
      expect(
        readFileSync(log, 'utf8').split('\n').filter(Boolean),
      ).toHaveLength(1);
    } finally {
      await manager.close();
    }
  }, 30_000);

  it('a server that fails says why, with its secrets masked', async () => {
    const { config } = server('crash', { NOTE_TOKEN: 'sk-very-secret' });
    const manager = new McpManager();
    const [status] = await manager.refresh([config]);
    expect(status?.connected).toBe(false);
    expect(status?.error).toContain('boom: bad token');
    expect(status?.error).not.toContain('sk-very-secret');
  }, 30_000);

  it('a server that fails after starting is not left running', async () => {
    const { config, starts } = server('hang-list');
    const manager = new McpManager({ connectTimeoutMs: 1000 });
    const [status] = await manager.refresh([config]);
    expect(status?.connected).toBe(false);
    const [pid] = starts();
    await new Promise((r) => setTimeout(r, 300));
    expect(running(pid!)).toBe(false);
  }, 30_000);

  it('a failed server is not started again on every turn, but is when asked', async () => {
    const { config, starts } = server('crash');
    const manager = new McpManager();
    await manager.refresh([config]);
    await manager.refresh([config]);
    expect(starts()).toHaveLength(1);
    // Opening Settings asks for a fresh try.
    await manager.refresh([config], { retry: true });
    expect(starts()).toHaveLength(2);
  }, 30_000);

  it('a failure counts even when the turn stopped waiting for it', async () => {
    const { config, starts } = server('crash');
    const manager = new McpManager();
    const controller = new AbortController();
    controller.abort();
    await manager.refresh([config], { signal: controller.signal });
    await new Promise((r) => setTimeout(r, 1500));
    await manager.refresh([config]);
    expect(starts()).toHaveLength(1);
  }, 30_000);

  it('a server still starting when Rocky shuts down is not left running', async () => {
    const { config, starts } = server();
    const manager = new McpManager();
    const pending = manager.refresh([config]);
    while (starts().length === 0) await new Promise((r) => setTimeout(r, 20));
    await manager.close();
    await pending;
    await new Promise((r) => setTimeout(r, 300));
    expect(running(starts()[0]!)).toBe(false);
  }, 30_000);

  it('a stopped turn does not wait for a slow server', async () => {
    const { config } = server('hang-list');
    const manager = new McpManager({ connectTimeoutMs: 20_000 });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const started = Date.now();
    const [status] = await manager.refresh([config], {
      signal: controller.signal,
    });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(status?.connected).toBe(false);
    await manager.close();
  }, 30_000);
});

describe('MCP tool names', () => {
  it('keep their plain form when it is already unique', () => {
    expect(agentToolName('notes', 'echo')).toBe('mcp__notes__echo');
    expect(agentToolName('my-notes', 'read_file')).toBe(
      'mcp__my-notes__read_file',
    );
  });

  it('never give two tools the same name', () => {
    const pairs: [string, string][] = [
      ['a.b', 'x'],
      ['a_b', 'x'],
      ['a b', 'x'],
      ['a__b', 'c'],
      ['a', 'b__c'],
      ['a_', 'b'],
      ['a', '_b'],
      ['s', 'x'.repeat(80) + '1'],
      ['s', 'x'.repeat(80) + '2'],
      ['筆記', 'x'],
      ['備忘', 'x'],
    ];
    const names = pairs.map(([s, t]) => agentToolName(s, t));
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it('the hashed form cannot be reached by a plain name', () => {
    const hashed = agentToolName('s', 'a.b');
    const tool = hashed.slice('mcp__s__'.length);
    expect(agentToolName('s', tool)).not.toBe(hashed);
    const other = agentToolName('a__b', 'x');
    expect(agentToolName('a', other.slice('mcp__a__'.length))).not.toBe(other);
  });

  it('a server that lists one tool twice gives the agent one tool, and the turn goes on', () => {
    const tools = new ToolRegistry(() => ({ none: true }));
    const echo = {
      server: 's',
      name: 'echo',
      description: '',
      inputSchema: { type: 'object' },
    };
    expect(() =>
      addMcpTools(
        tools,
        new McpManager(),
        [{ name: 's', connected: true, error: null, tools: [echo, echo] }],
        {},
        new AbortController().signal,
      ),
    ).not.toThrow();
    expect(tools.tools()).toHaveLength(1);
  });
});

describe('MCP error masking', () => {
  const stdio = (env: Record<string, string>): McpServerConfig => ({
    name: 's',
    transport: 'stdio',
    command: 'x',
    args: [],
    env,
  });

  it('masks longer values first, JSON-escaped values, and bearer tokens', () => {
    expect(
      mask('tok=abcdSECRETtail', stdio({ A: 'abcd', B: 'abcdSECRETtail' })),
    ).toBe('tok=***');
    expect(mask('{"p":"pa\\"ss"}', stdio({ P: 'pa"ss' }))).toBe('{"p":"***"}');
    const http: McpServerConfig = {
      name: 'h',
      transport: 'http',
      url: 'https://example.com/mcp?api_key=k-12345',
      headers: { Authorization: 'Bearer sk-abcdef' },
    };
    expect(mask('bad sk-abcdef and k-12345', http)).toBe('bad *** and ***');
  });

  it('a secret across the cut-off point of the server output is still masked', async () => {
    const { config } = server('crash', { NOTE_TOKEN: 'sk-ABCDEFGHIJKL' });
    // The fixture prints "boom: bad token <secret>"; pad the output so the secret sits
    // where a 2000-character tail would begin.
    const padded = { ...config, env: { ...config.env, MCP_PAD: '1985' } };
    const [status] = await new McpManager().refresh([padded]);
    expect(status?.error).not.toMatch(/CDEFGHIJKL/);
  }, 30_000);
});
