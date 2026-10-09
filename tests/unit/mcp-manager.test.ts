import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  McpManager,
  type McpServerConfig,
} from '../../src/server/mcp/manager.ts';

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
      expect(readFileSync(log, 'utf8')).toBe('start\n');
      // A later refresh with the same settings reuses the connection.
      await manager.refresh([config]);
      expect(readFileSync(log, 'utf8')).toBe('start\n');
    } finally {
      await manager.close();
    }
  }, 30_000);
});
