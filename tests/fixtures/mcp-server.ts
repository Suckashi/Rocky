// A tiny stdio MCP server for tests: echo text back, and report whether Rocky's token
// reached its environment (it must not).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { appendFileSync } from 'node:fs';
import { z } from 'zod';

// Tests count how many server processes Rocky starts.
if (process.env['MCP_START_LOG'])
  appendFileSync(process.env['MCP_START_LOG'], 'start\n');

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
await server.connect(new StdioServerTransport());
