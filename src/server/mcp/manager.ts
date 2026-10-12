// MCP servers the user configured: stdio child processes (only a minimal, safe environment
// plus what the user set; never Rocky's token) or HTTP endpoints. Connections are reused
// across runs. Every tool call still goes through the gate (gate-middleware.ts).
import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
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
/** A server that failed is tried again after this long, or when Settings asks. */
const RETRY_AFTER_MS = 60_000;
const STDERR_TAIL = 2000;
/** Read and masked before the tail is cut, so a secret across the cut is still found. */
const STDERR_KEEP = 16_000;

/** The settings' own values (tokens in env, headers, URL query) are replaced in an error:
 * whole, JSON-escaped, and the token after a scheme such as `Bearer`. Values shorter than
 * 4 characters are left (they would hide ordinary words). */
export function mask(text: string, config: McpServerConfig): string {
  const raw =
    config.transport === 'stdio'
      ? Object.values(config.env)
      : [
          ...Object.values(config.headers),
          ...(() => {
            try {
              return [...new URL(config.url).searchParams.values()];
            } catch {
              return [];
            }
          })(),
        ];
  const values = new Set<string>();
  for (const v of raw) {
    values.add(v);
    values.add(JSON.stringify(v).slice(1, -1));
    const token = v.split(/\s+/).at(-1);
    if (token) values.add(token);
  }
  return [...values]
    .filter((v) => v.length >= 4)
    .sort((a, b) => b.length - a.length)
    .reduce((t, v) => t.split(v).join('***'), text);
}

const keyOf = (c: McpServerConfig) =>
  createHash('sha256').update(JSON.stringify(c)).digest('hex');

const WORD = /^[A-Za-z0-9_-]+$/;

/**
 * Agent tool names: letters, digits, _ and -; at most 64 characters. The plain
 * `mcp__server__tool` is kept when it can be read back unambiguously; otherwise (other
 * characters, `__` or a trailing `_` in the server name, too long) a short hash of the real
 * names is added. A plain tool name that looks like a hash suffix is hashed too, so the two
 * forms cannot meet. A server can still list one tool twice: addMcpTools skips the repeat.
 */
export function agentToolName(server: string, tool: string): string {
  const plain = `mcp__${server}__${tool}`;
  if (
    WORD.test(server) &&
    WORD.test(tool) &&
    !server.includes('__') &&
    !server.endsWith('_') &&
    !tool.startsWith('_') &&
    !/_[0-9a-f]{10}$/.test(tool) &&
    plain.length <= 64
  )
    return plain;
  const hash = createHash('sha256')
    .update(`${server}\0${tool}`)
    .digest('hex')
    .slice(0, 10);
  const clean = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_');
  return `${`mcp__${clean(server)}__${clean(tool)}`.slice(0, 53)}_${hash}`;
}

export class McpManager {
  private readonly connections = new Map<string, Connection>();
  /** The last failure per server, so a broken server is not started on every turn. */
  private readonly failures = new Map<
    string,
    { key: string; at: number; error: string }
  >();
  private readonly connectTimeoutMs: number;

  constructor(options: { connectTimeoutMs?: number } = {}) {
    this.connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
  }
  /** Connections being opened, so overlapping refreshes share one server process. */
  private readonly opening = new Map<
    string,
    { key: string; connection: Promise<Connection> }
  >();

  private connect(config: McpServerConfig): Promise<Connection> {
    const key = keyOf(config);
    const existing = this.connections.get(config.name);
    if (existing?.key === key) return Promise.resolve(existing);
    const inFlight = this.opening.get(config.name);
    if (inFlight?.key === key) return inFlight.connection;
    // The outcome is recorded here, so it counts even when the turn that started it has
    // stopped waiting.
    const connection = this.open(config, key)
      .then(
        (c) => {
          this.failures.delete(config.name);
          return c;
        },
        (error: unknown) => {
          this.failures.set(config.name, {
            key,
            at: Date.now(),
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        },
      )
      .finally(() => {
        if (this.opening.get(config.name)?.connection === connection)
          this.opening.delete(config.name);
      });
    this.opening.set(config.name, { key, connection });
    return connection;
  }

  private async open(
    config: McpServerConfig,
    key: string,
  ): Promise<Connection> {
    const existing = this.connections.get(config.name);
    if (existing) await existing.client.close().catch(() => undefined);
    const client = new Client({ name: 'rocky', version: '0.1.0' });
    let stderr = '';
    const transport =
      config.transport === 'stdio'
        ? new StdioClientTransport({
            command: config.command,
            args: config.args,
            env: config.env,
            // Read (and kept short) so a failure can say what the server printed.
            stderr: 'pipe',
            ...(config.cwd ? { cwd: config.cwd } : {}),
          })
        : new StreamableHTTPClientTransport(new URL(config.url), {
            requestInit: { headers: config.headers },
          });
    if (transport instanceof StdioClientTransport) {
      // Decoded across chunks, so a character split between two reads stays whole.
      const decoder = new StringDecoder('utf8');
      transport.stderr?.on('data', (chunk: Buffer) => {
        stderr = (stderr + decoder.write(chunk)).slice(-STDERR_KEEP);
      });
    }
    let tools: Awaited<ReturnType<Client['listTools']>>['tools'];
    try {
      // Cast: the SDK's transports fail its own Transport type under exactOptionalPropertyTypes.
      await client.connect(transport as unknown as Transport, {
        timeout: this.connectTimeoutMs,
      });
      ({ tools } = await client.listTools(undefined, {
        timeout: this.connectTimeoutMs,
      }));
    } catch (error) {
      // Whatever was started is ended: a server that failed is never left running.
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      const said = mask(stderr, config).trim().slice(-STDERR_TAIL);
      throw new Error(mask(said ? `${message}\n${said}` : message, config), {
        cause: error,
      });
    }
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

  /**
   * Connects to every configured server (in parallel); failures are reported, not thrown. A
   * server that failed in the last minute is not started again unless `retry` (Settings).
   * `signal`: a stopped turn stops waiting (a connection under way is kept for later).
   */
  async refresh(
    configs: McpServerConfig[],
    options: { retry?: boolean; signal?: AbortSignal } = {},
  ): Promise<McpStatus[]> {
    const names = new Set(configs.map((c) => c.name));
    for (const name of this.failures.keys())
      if (!names.has(name)) this.failures.delete(name);
    for (const [name, connection] of this.connections) {
      if (!names.has(name)) {
        this.connections.delete(name);
        await connection.client.close().catch(() => undefined);
      }
    }
    let stop = () => {};
    const aborted = new Promise<never>((_, reject) => {
      stop = () => reject(new Error('stopped'));
      if (options.signal?.aborted) stop();
      options.signal?.addEventListener('abort', stop, { once: true });
    });
    aborted.catch(() => undefined);
    try {
      return await this.statuses(configs, options.retry === true, aborted);
    } finally {
      options.signal?.removeEventListener('abort', stop);
    }
  }

  private statuses(
    configs: McpServerConfig[],
    retry: boolean,
    aborted: Promise<never>,
  ): Promise<McpStatus[]> {
    return Promise.all(
      configs.map(async (config) => {
        const failed = (error: string) => ({
          name: config.name,
          connected: false,
          error,
          tools: [],
        });
        const key = keyOf(config);
        const last = this.failures.get(config.name);
        if (
          !retry &&
          last?.key === key &&
          Date.now() - last.at < RETRY_AFTER_MS
        )
          return failed(last.error);
        try {
          const { tools } = await Promise.race([this.connect(config), aborted]);
          return { name: config.name, connected: true, error: null, tools };
        } catch (error) {
          return failed(error instanceof Error ? error.message : String(error));
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
    // A server still starting is waited for, then closed with the others.
    await Promise.allSettled(
      [...this.opening.values()].map((o) => o.connection),
    );
    for (const connection of this.connections.values())
      await connection.client.close().catch(() => undefined);
    this.connections.clear();
  }
}
