import { createHash } from "node:crypto";
import { Store } from "./store.js";
import { idSchema, RockyError } from "../../../packages/contracts/src/index.js";
import {
  modelConnectionSchema,
  modelProbeSchema,
  saveModelSchema,
  probeModelSchema,
  type ModelConnection,
  type ModelProbe,
} from "../../../packages/contracts/src/models.js";
import { runModelProbe } from "../../../packages/agent-runtime/src/model-probe.js";

export class ModelRegistry {
  private active = new Map<
    string,
    { abort: AbortController; promise: Promise<ModelProbe> }
  >();
  private closed = false;
  constructor(
    private readonly store: Store,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    // A persisted running probe has an uncertain remote outcome after restart. Never replay it.
    for (const row of store.db
      .prepare("SELECT data FROM model_probes")
      .all() as { data: string }[]) {
      const probe = modelProbeSchema.parse(JSON.parse(row.data));
      if (probe.status === "running") {
        probe.status = "interrupted";
        probe.error = "daemon_restarted";
        this.record(probe);
      }
    }
  }
  private get(id: string): ModelConnection {
    const row = this.store.db
      .prepare("SELECT data FROM model_connections WHERE id=?")
      .get(idSchema.parse(id)) as { data: string } | undefined;
    if (!row)
      throw new RockyError("not_found", "Model connection not found", 404);
    return modelConnectionSchema.parse(JSON.parse(row.data));
  }
  private public(connection: ModelConnection) {
    const { credentialRef, caRef, ...config } = connection.config;
    return {
      ...connection,
      config,
      credential: {
        configured: !!credentialRef,
        available: !!(credentialRef && this.env[credentialRef]),
      },
      caConfigured: !!caRef,
    };
  }
  list() {
    return (
      this.store.db
        .prepare("SELECT data FROM model_connections ORDER BY rowid")
        .all() as { data: string }[]
    ).map((row) => {
      const connection = modelConnectionSchema.parse(JSON.parse(row.data));
      const probes = (
        this.store.db
          .prepare(
            "SELECT data FROM model_probes WHERE connection_id=? ORDER BY rowid DESC LIMIT 1",
          )
          .all(connection.id) as { data: string }[]
      ).map((row) => modelProbeSchema.parse(JSON.parse(row.data)));
      return {
        ...this.public(connection),
        probe: probes[0]?.revision === connection.revision ? probes[0] : null,
      };
    });
  }
  save(input: unknown) {
    if (this.closed)
      throw new RockyError("shutting_down", "Daemon is shutting down", 503);
    const command = saveModelSchema.parse(input);
    const intent = createHash("sha256")
      .update(JSON.stringify(command))
      .digest("hex");
    const saved = this.store.transaction(() => {
      const receipt = this.store.db
        .prepare("SELECT intent,data FROM model_receipts WHERE request_id=?")
        .get(command.requestId) as { intent: string; data: string } | undefined;
      if (receipt) {
        if (receipt.intent !== intent)
          throw new RockyError(
            "idempotency_conflict",
            "Request ID was used with different settings",
            409,
          );
        return modelConnectionSchema.parse(JSON.parse(receipt.data));
      }
      const previous = this.store.db
        .prepare("SELECT revision FROM model_connections WHERE id=?")
        .get(command.id) as { revision: number } | undefined;
      if ((previous?.revision ?? 0) !== command.expectedRevision)
        throw new RockyError(
          "revision_conflict",
          "Model settings changed; reload before saving",
          409,
        );
      const connection = modelConnectionSchema.parse({
        id: command.id,
        revision: command.expectedRevision + 1,
        config: command.config,
      });
      // Full replacement: omitted refs become null, including when the endpoint changes.
      this.store.db
        .prepare(
          "INSERT INTO model_connections VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data",
        )
        .run(connection.id, connection.revision, JSON.stringify(connection));
      this.store.db
        .prepare("INSERT INTO model_receipts VALUES(?,?,?)")
        .run(command.requestId, intent, JSON.stringify(connection));
      return connection;
    });
    for (const row of this.store.db
      .prepare("SELECT id,data FROM model_probes WHERE connection_id=?")
      .all(command.id) as { id: string; data: string }[]) {
      const probe = modelProbeSchema.parse(JSON.parse(row.data));
      if (probe.revision !== this.get(command.id).revision)
        this.active.get(row.id)?.abort.abort();
    }
    return this.public(saved);
  }
  private record(probe: ModelProbe) {
    this.store.db
      .prepare(
        "INSERT INTO model_probes VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(
        probe.id,
        probe.connectionId,
        JSON.stringify(modelProbeSchema.parse(probe)),
      );
  }
  async probe(id: string, input: unknown): Promise<ModelProbe> {
    if (this.closed)
      throw new RockyError("shutting_down", "Daemon is shutting down", 503);
    const command = probeModelSchema.parse(input);
    idSchema.parse(id);
    const row = this.store.db
      .prepare("SELECT data FROM model_probes WHERE id=?")
      .get(command.requestId) as { data: string } | undefined;
    if (row) {
      const previous = modelProbeSchema.parse(JSON.parse(row.data));
      if (
        previous.connectionId !== id ||
        previous.revision !== command.expectedRevision
      )
        throw new RockyError(
          "idempotency_conflict",
          "Probe request ID has different settings",
          409,
        );
      return previous;
    }
    const connection = this.get(id);
    if (connection.revision !== command.expectedRevision)
      throw new RockyError(
        "revision_conflict",
        "Model settings changed; reload before testing",
        409,
      );
    if (
      this.active.size >= 2 ||
      this.list().some((c) => c.id === id && c.probe?.status === "running")
    )
      throw new RockyError(
        "probe_busy",
        "A connection probe is already running",
        409,
      );
    const result: ModelProbe = {
      id: command.requestId,
      connectionId: id,
      revision: connection.revision,
      status: "running",
      checks: {
        text: "not_run",
        stream: "not_run",
        tools: "not_run",
        cancellation: "not_run",
      },
      requests: 0,
      outputTokenLimitPerRequest: Math.min(
        128,
        connection.config.maxOutputTokens,
      ),
      error: null,
      createdAt: new Date().toISOString(),
    };
    this.record(result);
    const abort = new AbortController();
    const promise = runModelProbe(
      connection.config,
      result,
      () => this.record(result),
      AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
      this.env,
    )
      .catch(() => {
        result.status = "failed";
        result.error = "connection_configuration_failed";
        this.record(result);
      })
      .then(() => result)
      .finally(() => this.active.delete(command.requestId));
    this.active.set(command.requestId, { abort, promise });
    return promise;
  }
  async close() {
    this.closed = true;
    const running = [...this.active.values()];
    for (const entry of running) entry.abort.abort();
    await Promise.allSettled(running.map((entry) => entry.promise));
  }
}
