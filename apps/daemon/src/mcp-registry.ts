import { resolve, join } from "node:path";
import { mkdirSync } from "node:fs";
import {
  mcpConfigSnapshotSchema,
  saveMcpConfigSchema,
  emptyMcpConfig,
  type McpConfig,
} from "../../../packages/contracts/src/mcp-config.js";
import { RockyError } from "../../../packages/contracts/src/index.js";
import type { Store } from "./store.js";
import { intentHash } from "./intent.js";
import { redactEvidence } from "./redaction.js";
export class McpRegistry {
  readonly configDirectory: string;
  private closed = false;
  private observedSecrets = new Set<string>();
  constructor(
    private readonly store: Store,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    this.configDirectory = join(store.root, "connections", "mcp");
    mkdirSync(this.configDirectory, { recursive: true });
    const config = emptyMcpConfig();
    store.db
      .prepare("INSERT OR IGNORE INTO mcp_config VALUES(1,0,?,?)")
      .run(intentHash(config), JSON.stringify(config));
    this.rememberSecrets(this.snapshot().config);
  }
  snapshot() {
    const row = this.store.db
      .prepare("SELECT revision,hash,data FROM mcp_config WHERE id=1")
      .get() as { revision: number; hash: string; data: string };
    const result = mcpConfigSnapshotSchema.parse({
      revision: row.revision,
      hash: row.hash,
      config: JSON.parse(row.data),
    });
    if (intentHash(result.config) !== result.hash)
      throw new RockyError(
        "mcp_config_corrupt",
        "MCP configuration hash mismatch",
        500,
      );
    return result;
  }
  save(input: unknown) {
    if (this.closed)
      throw new RockyError("shutting_down", "Daemon is shutting down", 503);
    const command = saveMcpConfigSchema.parse(input),
      intent = intentHash(command);
    this.rememberSecrets(this.snapshot().config);
    this.rememberSecrets(command.config);
    if (
      [...this.observedSecrets].some((secret) =>
        JSON.stringify(command.config).includes(secret),
      )
    )
      throw new RockyError(
        "plaintext_credential",
        "Use MCP credential references instead of plaintext secrets",
        400,
      );
    return this.store.transaction(() => {
      const prior = this.store.db
        .prepare(
          "SELECT intent,data FROM mcp_config_receipts WHERE request_id=?",
        )
        .get(command.requestId) as { intent: string; data: string } | undefined;
      if (prior) {
        if (prior.intent !== intent)
          throw new RockyError(
            "idempotency_conflict",
            "MCP settings request changed",
            409,
          );
        return mcpConfigSnapshotSchema.parse(JSON.parse(prior.data));
      }
      const current = this.snapshot();
      if (current.revision !== command.expectedRevision)
        throw new RockyError(
          "revision_conflict",
          "MCP settings changed; reload before saving",
          409,
        );
      const result = mcpConfigSnapshotSchema.parse({
        revision: current.revision + 1,
        hash: intentHash(command.config),
        config: command.config,
      });
      this.store.db
        .prepare("UPDATE mcp_config SET revision=?,hash=?,data=? WHERE id=1")
        .run(result.revision, result.hash, JSON.stringify(result.config));
      this.store.db
        .prepare("INSERT INTO mcp_config_receipts VALUES(?,?,?)")
        .run(command.requestId, intent, JSON.stringify(result));
      return result;
    });
  }
  server(id: string, revision: number) {
    const snapshot = this.snapshot();
    if (snapshot.revision !== revision)
      throw new RockyError(
        "revision_conflict",
        "MCP configuration changed",
        409,
      );
    const server = snapshot.config.mcpServers[id],
      options = snapshot.config["x-rocky"].servers[id];
    if (!server || !options)
      throw new RockyError("not_found", "MCP server not found", 404);
    return { server, options, revision };
  }
  launchSpec(id: string, revision: number) {
    const { server, options } = this.server(id, revision);
    if (!server.enabled)
      throw new RockyError("mcp_disabled", "MCP server is disabled", 409);
    const reference = (name: string) => {
      const value = this.env[name];
      if (!value)
        throw new RockyError(
          "credential_unavailable",
          "Configured MCP environment reference is unavailable",
          503,
        );
      return value;
    };
    if ("command" in server && options.transport === "stdio") {
      const env = {
        ...Object.fromEntries(
          options.envAllowlist.flatMap((name) =>
            this.env[name] ? [[name, this.env[name]!]] : [],
          ),
        ),
        ...server.env,
        ...Object.fromEntries(
          Object.entries(options.envRefs).map(([name, ref]) => [
            name,
            reference(ref),
          ]),
        ),
      };
      return {
        transport: "stdio" as const,
        command:
          server.command.includes("/") || server.command.includes("\\")
            ? resolve(this.configDirectory, server.command)
            : server.command,
        args: server.args,
        cwd: resolve(this.configDirectory, server.cwd ?? "."),
        env,
        startupTimeoutMs: options.startupTimeoutMs,
        toolTimeoutMs: options.toolTimeoutMs,
      };
    }
    if ("url" in server && options.transport === "streamable-http")
      return {
        transport: "streamable-http" as const,
        url: server.url,
        networkPolicyId: options.networkPolicyId,
        headers: {
          ...Object.fromEntries(
            Object.entries(options.headerRefs).map(([name, ref]) => [
              name,
              reference(ref),
            ]),
          ),
          ...(options.bearerTokenEnvVar
            ? {
                Authorization: "Bearer " + reference(options.bearerTokenEnvVar),
              }
            : {}),
        },
        startupTimeoutMs: options.startupTimeoutMs,
        toolTimeoutMs: options.toolTimeoutMs,
      };
    throw new RockyError("mcp_config_corrupt", "MCP transport mismatch", 500);
  }
  private rememberSecrets(config: McpConfig) {
    const options = Object.values(config["x-rocky"].servers);
    const refs = options.flatMap((option) =>
      option.transport === "stdio"
        ? Object.values(option.envRefs)
        : [
            ...Object.values(option.headerRefs),
            ...(option.bearerTokenEnvVar ? [option.bearerTokenEnvVar] : []),
          ],
    );
    for (const ref of refs)
      if (this.env[ref]) this.observedSecrets.add(this.env[ref]!);
  }
  redact(value: unknown) {
    this.rememberSecrets(this.snapshot().config);
    return redactEvidence(value, [...this.observedSecrets]);
  }
  close() {
    this.closed = true;
  }
}
