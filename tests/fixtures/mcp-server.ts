// A tiny stdio MCP server for tests: echo text back, and report whether Rocky's token
// reached its environment (it must not).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

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
