import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  DEFAULT_INHERITED_ENV_VARS,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  ToolListChangedNotificationSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import {
  mcpLifecycleCommandSchema,
  mcpStateSchema,
  type McpState,
} from "../../../packages/contracts/src/mcp-runtime.js";
import { RockyError } from "../../../packages/contracts/src/index.js";
import { ExplicitNetwork } from "../../../packages/agent-runtime/src/network.js";
import type { Store } from "./store.js";
import type { McpRegistry } from "./mcp-registry.js";
import { intentHash } from "./intent.js";
import { StringDecoder } from "node:string_decoder";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { McpSchemaValidator, mcpToolIdentity } from "./mcp-schema.js";
type Connection = {
  client: Client;
  transport: Transport;
  abort: AbortController;
  state: McpState;
  stderrBytes: number;
  stderrRedact?: (text: string, final?: boolean) => string;
  stderrDecoder?: StringDecoder;
  promise?: Promise<McpState>;
  closing?: Promise<void>;
};
export class McpManager {
  private failureMessage(error: unknown) {
    return error instanceof RockyError &&
      error.code === "mcp_schema_unsupported"
      ? error.message
      : error instanceof UnauthorizedError
        ? "MCP authorization unavailable; interactive OAuth is unsupported"
        : error instanceof Error &&
            /^MCP (discovery|duplicate)/.test(error.message)
          ? error.message
          : "MCP protocol/transport connection failed";
  }
  private active = new Map<string, Connection>();
  private closed = false;
  private unsubscribe: () => void;
  constructor(
    private readonly store: Store,
    private readonly registry: McpRegistry,
  ) {
    store.db
      .prepare(
        "UPDATE mcp_lifecycle_receipts SET status='interrupted' WHERE status='accepted'",
      )
      .run();
    for (const state of this.listStored())
      if (["ready", "starting", "stopping"].includes(state.status))
        this.saveState({
          ...state,
          status: "configured",
          pid: null,
          toolsCount: 0,
          error: "Daemon restarted; reconnect explicitly",
        });
    this.unsubscribe = registry.onChanged(() => {
      for (const [id, connection] of this.active)
        if (connection.state.configRevision !== registry.snapshot().revision)
          void this.closeConnection(
            id,
            connection,
            "configured",
            "MCP configuration changed",
          );
    });
  }
  private listStored() {
    return (
      this.store.db.prepare("SELECT data FROM mcp_states").all() as {
        data: string;
      }[]
    ).map((row) => mcpStateSchema.parse(JSON.parse(row.data)));
  }
  private saveState(state: McpState) {
    state.updatedAt = new Date().toISOString();
    const parsed = mcpStateSchema.parse(state);
    this.store.db
      .prepare(
        "INSERT INTO mcp_states VALUES(?,?) ON CONFLICT(server_id) DO UPDATE SET data=excluded.data",
      )
      .run(state.serverId, JSON.stringify(parsed));
    return parsed;
  }
  list() {
    const snapshot = this.registry.snapshot();
    return Object.entries(snapshot.config.mcpServers).map(([id, server]) => {
      const previous = this.listStored().find((state) => state.serverId === id);
      if (previous?.configRevision === snapshot.revision) return previous;
      return mcpStateSchema.parse({
        serverId: id,
        configRevision: snapshot.revision,
        status: server.enabled ? "configured" : "disabled",
        pid: null,
        registryRevision: previous?.registryRevision ?? 0,
        toolsCount: 0,
        updatedAt: new Date().toISOString(),
        error: null,
        diagnostics: [],
      });
    });
  }
  private assertCurrent(id: string, connection: Connection) {
    if (
      this.closed ||
      connection.abort.signal.aborted ||
      this.active.get(id) !== connection
    )
      throw new RockyError(
        "mcp_revoked",
        "MCP connection is no longer active",
        409,
      );
    this.registry.server(id, connection.state.configRevision);
  }
  private receipt(id: string, input: unknown, action: "connect" | "stop") {
    const command = mcpLifecycleCommandSchema.parse(input),
      intent = intentHash({ id, action, ...command });
    const prior = this.store.db
      .prepare("SELECT intent FROM mcp_lifecycle_receipts WHERE request_id=?")
      .get(command.requestId) as { intent: string } | undefined;
    if (prior) {
      if (prior.intent !== intent)
        throw new RockyError(
          "idempotency_conflict",
          "MCP lifecycle request changed",
          409,
        );
      return { command, prior: true };
    }
    this.registry.server(id, command.expectedRevision);
    this.store.db
      .prepare("INSERT INTO mcp_lifecycle_receipts VALUES(?,?, 'accepted')")
      .run(command.requestId, intent);
    return { command, prior: false };
  }
  async connect(id: string, input: unknown) {
    if (this.closed)
      throw new RockyError("shutting_down", "MCP manager is closed", 503);
    const { command, prior } = this.receipt(id, input, "connect");
    if (prior)
      return (
        this.active.get(id)?.promise ??
        this.list().find((state) => state.serverId === id)
      );
    const existing = this.active.get(id);
    if (existing && !existing.closing) {
      this.store.db
        .prepare(
          "UPDATE mcp_lifecycle_receipts SET status='completed' WHERE request_id=?",
        )
        .run(command.requestId);
      return existing.promise ?? existing.state;
    }
    if (existing?.closing) await existing.closing;
    let spec;
    try {
      spec = this.registry.launchSpec(id, command.expectedRevision);
    } catch (error) {
      this.store.db
        .prepare(
          "UPDATE mcp_lifecycle_receipts SET status='failed' WHERE request_id=?",
        )
        .run(command.requestId);
      throw error;
    }
    const client = new Client(
        { name: "rocky-mcp-client", version: "1.0.0" },
        { capabilities: {}, jsonSchemaValidator: new McpSchemaValidator() },
      ),
      abort = new AbortController();
    const state = mcpStateSchema.parse({
      serverId: id,
      configRevision: command.expectedRevision,
      status: "starting",
      pid: null,
      registryRevision:
        this.listStored().find((s) => s.serverId === id)?.registryRevision ?? 0,
      toolsCount: 0,
      updatedAt: new Date().toISOString(),
      error: null,
      diagnostics: [],
    });
    let transport: Transport;
    if (spec.transport === "stdio") {
      const env = Object.fromEntries(
        [
          ...DEFAULT_INHERITED_ENV_VARS.map((name) => [name, ""]),
          ...Object.entries(spec.env),
        ].map(([name, value]) => [
          process.platform === "win32" ? name!.toUpperCase() : name!,
          value!,
        ]),
      );
      transport = new StdioClientTransport({
        command: spec.command,
        args: spec.args,
        cwd: spec.cwd,
        env,
        stderr: "pipe",
        maxBufferSize: 2097152,
      });
    } else {
      const network = new ExplicitNetwork(new Map([["mcp:" + id, spec.url]]));
      transport = new StreamableHTTPClientTransport(new URL(spec.url), {
        requestInit: { headers: spec.headers, redirect: "manual" },
        reconnectionOptions: {
          maxRetries: 0,
          maxReconnectionDelay: 1000,
          initialReconnectionDelay: 1000,
          reconnectionDelayGrowFactor: 1,
        },
        fetch: async (url, init) => {
          const connection = this.active.get(id);
          if (!connection || connection.abort !== abort)
            throw Error("MCP connection is not active");
          this.assertCurrent(id, connection);
          const response = await network.request(String(url), "mcp:" + id, {
            ...init,
            signal: AbortSignal.any([
              abort.signal,
              ...(init?.signal ? [init.signal] : []),
            ]),
          });
          if (!response.body) return response;
          const reader = response.body.getReader();
          let bytes = 0;
          const body = new ReadableStream<Uint8Array>({
            async pull(controller) {
              try {
                const { done, value } = await reader.read();
                if (done) {
                  controller.close();
                  return;
                }
                bytes += value.byteLength;
                if (bytes > 2097152) {
                  await reader.cancel();
                  controller.error(
                    new Error("MCP HTTP response limit exceeded"),
                  );
                  return;
                }
                controller.enqueue(value);
              } catch (error) {
                controller.error(error);
              }
            },
            cancel: (reason) => reader.cancel(reason),
          });
          return new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        },
      });
    }
    const connection: Connection = {
      client,
      transport,
      abort,
      state,
      stderrBytes: 0,
    };
    this.active.set(id, connection);
    this.saveState(state);
    client.onerror = (error) => {
      if (!connection.closing)
        void this.closeConnection(
          id,
          connection,
          "failed",
          this.failureMessage(error),
        );
    };
    client.onclose = () => {
      if (!connection.closing)
        void this.closeConnection(
          id,
          connection,
          "failed",
          "MCP connection closed unexpectedly",
        );
    };
    if (transport instanceof StdioClientTransport) {
      connection.stderrRedact = this.registry.streamRedactor();
      connection.stderrDecoder = new StringDecoder("utf8");
      transport.stderr?.on("data", (chunk: Buffer) => {
        if (this.active.get(id) !== connection) return;
        connection.stderrBytes += chunk.byteLength;
        if (connection.stderrBytes > 65536) {
          void this.closeConnection(
            id,
            connection,
            "failed",
            "MCP stderr limit exceeded",
          );
          return;
        }
        const safe = connection.stderrRedact!(
          connection.stderrDecoder!.write(chunk),
        );
        if (safe) state.diagnostics.push(safe.slice(-8192));
        state.diagnostics = state.diagnostics.slice(-16);
        if (!connection.closing) this.saveState(state);
      });
    }
    client.setNotificationHandler(
      ToolListChangedNotificationSchema,
      async () => {
        if (!connection.closing)
          void this.closeConnection(
            id,
            connection,
            "configured",
            "Tool list changed; reconnect to refresh schemas",
          );
      },
    );
    const signal = AbortSignal.any([
      abort.signal,
      AbortSignal.timeout(spec.startupTimeoutMs),
    ]);
    connection.promise = (async () => {
      try {
        await client.connect(transport, {
          signal,
          timeout: spec.startupTimeoutMs,
        });
        this.assertCurrent(id, connection);
        state.pid =
          transport instanceof StdioClientTransport ? transport.pid : null;
        this.saveState(state);
        const tools: Tool[] = [],
          cursors = new Set<string>();
        let cursor: string | undefined,
          totalBytes = 0;
        for (let page = 0; page < 100; page++) {
          const result = await client.listTools(
            cursor ? { cursor } : undefined,
            { signal, timeout: spec.startupTimeoutMs },
          );
          this.assertCurrent(id, connection);
          totalBytes += Buffer.byteLength(JSON.stringify(result));
          if (this.registry.containsSecret(result))
            throw Error("MCP discovery contains a credential");
          tools.push(...result.tools);
          if (tools.length > 1000 || totalBytes > 2097152)
            throw Error("MCP discovery limit exceeded");
          if (!result.nextCursor) {
            cursor = undefined;
            break;
          }
          if (cursors.has(result.nextCursor))
            throw Error("MCP discovery cursor repeated");
          cursors.add(result.nextCursor);
          cursor = result.nextCursor;
        }
        if (cursor) throw Error("MCP discovery page limit exceeded");
        if (new Set(tools.map((tool) => tool.name)).size !== tools.length)
          throw Error("MCP duplicate tool names");
        for (const tool of tools) {
          new McpSchemaValidator().getValidator(tool.inputSchema);
          if (tool.outputSchema)
            new McpSchemaValidator().getValidator(tool.outputSchema);
          mcpToolIdentity(
            id,
            state.configRevision,
            state.registryRevision + 1,
            tool,
          );
        }
        this.assertCurrent(id, connection);
        state.registryRevision++;
        state.toolsCount = tools.length;
        state.status = "ready";
        this.store.transaction(() => {
          this.store.db
            .prepare(
              "INSERT INTO mcp_catalog VALUES(?,?,?,?) ON CONFLICT(server_id) DO UPDATE SET config_revision=excluded.config_revision,registry_revision=excluded.registry_revision,data=excluded.data",
            )
            .run(
              id,
              state.configRevision,
              state.registryRevision,
              JSON.stringify(tools),
            );
          this.saveState(state);
          this.store.db
            .prepare(
              "UPDATE mcp_lifecycle_receipts SET status='completed' WHERE request_id=?",
            )
            .run(command.requestId);
        });
        return state;
      } catch (error) {
        await this.closeConnection(
          id,
          connection,
          "failed",
          this.failureMessage(error),
        );
        this.store.db
          .prepare(
            "UPDATE mcp_lifecycle_receipts SET status='failed' WHERE request_id=?",
          )
          .run(command.requestId);
        return connection.state;
      }
    })();
    return connection.promise;
  }
  private closeConnection(
    id: string,
    connection: Connection,
    status: "configured" | "failed",
    error: string | null,
  ) {
    if (connection.closing) return connection.closing;
    connection.abort.abort();
    connection.state.status = "stopping";
    this.saveState(connection.state);
    connection.closing = Promise.resolve().then(async () => {
      await connection.client.close().catch(() => {});
      const tail = connection.stderrRedact?.(
        connection.stderrDecoder?.end() ?? "",
        true,
      );
      if (tail) {
        connection.state.diagnostics.push(
          this.registry.redactDiagnosticTail(tail).slice(-8192),
        );
        connection.state.diagnostics = connection.state.diagnostics.slice(-16);
      }
      connection.state.status = status;
      connection.state.pid = null;
      connection.state.toolsCount = 0;
      connection.state.error = error
        ? String(this.registry.redact(error)).slice(0, 8192)
        : null;
      this.saveState(connection.state);
      if (this.active.get(id) === connection) this.active.delete(id);
    });
    return connection.closing;
  }
  async stop(id: string, input: unknown) {
    const { command, prior } = this.receipt(id, input, "stop");
    if (!prior) {
      const connection = this.active.get(id);
      if (connection)
        await this.closeConnection(id, connection, "configured", null);
      this.store.db
        .prepare(
          "UPDATE mcp_lifecycle_receipts SET status='completed' WHERE request_id=?",
        )
        .run(command.requestId);
    }
    return this.list().find((state) => state.serverId === id);
  }
  catalog(id: string, revision: number) {
    const connection = this.active.get(id);
    if (!connection || connection.state.status !== "ready")
      throw new RockyError("mcp_unavailable", "MCP server is not ready", 503);
    this.assertCurrent(id, connection);
    if (connection.state.registryRevision !== revision)
      throw new RockyError(
        "mcp_schema_changed",
        "MCP tool registry changed",
        409,
      );
    const row = this.store.db
      .prepare("SELECT data FROM mcp_catalog WHERE server_id=?")
      .get(id) as { data: string };
    return JSON.parse(row.data) as Tool[];
  }
  /** Validate before preparing any operation; this method never dispatches a tool. */
  prepareTool(id: string, revision: number, name: string, args: unknown) {
    const tool = this.catalog(id, revision).find((tool) => tool.name === name);
    if (!tool)
      throw new RockyError(
        "mcp_tool_not_found",
        "MCP tool is not in the current registry",
        404,
      );
    const validated = new McpSchemaValidator().getValidator(tool.inputSchema)(
      args,
    );
    if (!validated.valid)
      throw new RockyError(
        "mcp_arguments_invalid",
        "MCP arguments do not match the original schema",
        400,
      );
    return {
      identity: mcpToolIdentity(
        id,
        this.registry.snapshot().revision,
        revision,
        tool,
      ),
      tool,
      args: validated.data,
    };
  }
  /** Internal daemon adapter; caller must persist authorization/dispatch before invoking. */
  async dispatchTool(
    prepared: ReturnType<McpManager["prepareTool"]>,
    operation: { operationId: string; intentHash: string },
    signal: AbortSignal,
  ) {
    const { serverId, registryRevision, toolName } = prepared.identity;
    const current = this.prepareTool(
      serverId,
      registryRevision,
      toolName,
      prepared.args,
    );
    if (intentHash(current.identity) !== intentHash(prepared.identity))
      throw new RockyError(
        "mcp_schema_changed",
        "MCP tool identity changed",
        409,
      );
    signal.throwIfAborted();
    const connection = this.active.get(serverId)!;
    this.assertCurrent(serverId, connection);
    const spec = this.registry.launchSpec(
      serverId,
      current.identity.configRevision,
    );
    const result = await connection.client.callTool(
      {
        name: toolName,
        arguments: current.args as Record<string, unknown>,
        _meta: { "rocky/operation": operation },
      },
      undefined,
      {
        signal: AbortSignal.any([signal, connection.abort.signal]),
        timeout: spec.toolTimeoutMs,
      },
    );
    if (Buffer.byteLength(JSON.stringify(result)) > 2097152)
      throw new RockyError(
        "mcp_result_limit",
        "MCP result exceeds the delivery limit",
        422,
      );
    return result;
  }
  async close() {
    this.closed = true;
    this.unsubscribe();
    const connections = [...this.active];
    await Promise.all(
      connections.map(([id, connection]) =>
        this.closeConnection(id, connection, "configured", null),
      ),
    );
    await Promise.all(connections.map(([, connection]) => connection.promise));
  }
}
