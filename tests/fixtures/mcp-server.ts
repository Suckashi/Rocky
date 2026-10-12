// A tiny stdio MCP server for tests: echo text back, and report whether Rocky's token
// reached its environment (it must not).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { appendFileSync } from 'node:fs';
import { z } from 'zod';

// Tests count how many server processes Rocky starts, and which are still running.
if (process.env['MCP_START_LOG'])
  appendFileSync(process.env['MCP_START_LOG'], `start ${process.pid}\n`);

// Ways to fail: print an error (with a secret from its settings) and exit, or never answer
// the tool list.
const mode = process.env['MCP_MODE'];
if (mode === 'crash') {
  process.stderr.write(
    `boom: bad token ${process.env['NOTE_TOKEN']}${'B'.repeat(Number(process.env['MCP_PAD'] ?? 0))}\n`,
  );
  process.exit(1);
}

const server = new McpServer({ name: 'notes', version: '1.0.0' });
server.registerTool(
  'echo',
  { description: 'Echo the text back', inputSchema: { text: z.string() } },
  async ({ text }) => ({ content: [{ type: 'text', text: `echo: ${text}` }] }),
);
server.registerTool(
  'env',
  { description: 'Report environment variables', inputSchema: {} },
  async () => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          rockyKeys: Object.keys(process.env).filter((k) =>
            k.startsWith('ROCKY_'),
          ),
          note: process.env['NOTE_TOKEN'] ?? null,
        }),
      },
    ],
  }),
);
if (mode === 'hang-list')
  server.server.setRequestHandler(
    ListToolsRequestSchema,
    () => new Promise<never>(() => {}),
  );
await server.connect(new StdioServerTransport());
