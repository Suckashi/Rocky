// MCP servers the user configured: stdio child processes (only a minimal, safe environment
// plus what the user set; never Rocky's token) or HTTP endpoints. Connections are reused
// across runs. Every tool call still goes through the gate (gate-middleware.ts).
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

export type McpServerConfig =
  | {
      name: string;
      transport: 'stdio';
      command: string;
      args: string[];
      env: Record<string, string>;
      cwd?: string;
    }
  | {
      name: string;
      transport: 'http';
      url: string;
      headers: Record<string, string>;
    };

export type ToolPolicy = 'ask' | 'read-only' | 'deny';

export interface McpTool {
  server: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpStatus {
  name: string;
  connected: boolean;
  error: string | null;
  tools: McpTool[];
}

interface Connection {
  key: string;
  client: Client;
  tools: McpTool[];
}

const CONNECT_TIMEOUT_MS = 20_000;
const CALL_TIMEOUT_MS = 120_000;

const keyOf = (c: McpServerConfig) =>
  createHash('sha256').update(JSON.stringify(c)).digest('hex');

/** Agent tool names: letters, digits, _ and -; at most 64 characters. */
export function agentToolName(server: string, tool: string): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_');
  return `mcp__${clean(server)}__${clean(tool)}`.slice(0, 64);
}

export class McpManager {
  private readonly connections = new Map<string, Connection>();
  private readonly errors = new Map<string, string>();

  private async connect(config: McpServerConfig): Promise<Connection> {
    const key = keyOf(config);
    const existing = this.connections.get(config.name);
    if (existing?.key === key) return existing;
    if (existing) await existing.client.close().catch(() => undefined);
    const client = new Client({ name: 'rocky', version: '0.1.0' });
    const transport =
      config.transport === 'stdio'
        ? new StdioClientTransport({
            command: config.command,
            args: config.args,
            env: config.env,
            stderr: 'ignore',
            ...(config.cwd ? { cwd: config.cwd } : {}),
          })
        : new StreamableHTTPClientTransport(new URL(config.url), {
            requestInit: { headers: config.headers },
          });
    // Cast: the SDK's transports fail its own Transport type under exactOptionalPropertyTypes.
    await client.connect(transport as unknown as Transport, {
      timeout: CONNECT_TIMEOUT_MS,
    });
    const { tools } = await client.listTools(undefined, {
      timeout: CONNECT_TIMEOUT_MS,
    });
    const connection: Connection = {
      key,
      client,
      tools: tools.map((t) => ({
        server: config.name,
        name: t.name,
        description: t.description ?? '',
        inputSchema: t.inputSchema as Record<string, unknown>,
      })),
    };
    client.onclose = () => {
      if (this.connections.get(config.name) === connection)
        this.connections.delete(config.name);
    };
    this.connections.set(config.name, connection);
    return connection;
  }

  /** Connects to every configured server (in parallel); failures are reported, not thrown. */
  async refresh(configs: McpServerConfig[]): Promise<McpStatus[]> {
    const names = new Set(configs.map((c) => c.name));
    for (const [name, connection] of this.connections) {
      if (!names.has(name)) {
        this.connections.delete(name);
        await connection.client.close().catch(() => undefined);
      }
    }
    return Promise.all(
      configs.map(async (config) => {
        try {
          const { tools } = await this.connect(config);
          this.errors.delete(config.name);
          return { name: config.name, connected: true, error: null, tools };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.errors.set(config.name, message);
          return {
            name: config.name,
            connected: false,
            error: message,
            tools: [],
          };
        }
      }),
    );
  }

  async call(
    server: string,
    tool: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ text: string; isError: boolean }> {
    const connection = this.connections.get(server);
    if (!connection) throw new Error(`MCP server "${server}" is not connected`);
    const result = await connection.client.callTool(
      { name: tool, arguments: args },
      undefined,
      {
        timeout: CALL_TIMEOUT_MS,
        ...(signal ? { signal } : {}),
      },
    );
    const parts =
      (result.content as { type: string; text?: string }[] | undefined) ?? [];
    const text = parts
      .map((p) => (p.type === 'text' ? (p.text ?? '') : `[${p.type} content]`))
      .join('\n');
    return { text, isError: result.isError === true };
  }

  async close(): Promise<void> {
    for (const connection of this.connections.values())
      await connection.client.close().catch(() => undefined);
    this.connections.clear();
  }
}
