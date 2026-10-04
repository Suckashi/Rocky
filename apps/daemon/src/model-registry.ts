import { createHash } from "node:crypto";
import { Store } from "./store.js";
import { redactEvidence, createTextStreamRedactor } from "./redaction.js";
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
import {
  ConfiguredModel,
  type ModelAccounting,
} from "../../../packages/agent-runtime/src/configured-model.js";
import { ModelDnsPolicy } from "../../../packages/agent-runtime/src/model-dns.js";

export class ModelRegistry {
  private readonly dnsPolicies = new Map<string, ModelDnsPolicy>();
  private secrets() {
    const rows = this.store.db
      .prepare("SELECT data FROM model_connections")
      .all() as { data: string }[];
    return rows.flatMap((row) => {
      const config = modelConnectionSchema.parse(JSON.parse(row.data)).config;
      const secret = config.credentialRef
        ? this.env[config.credentialRef]
        : undefined;
      return secret ? [secret] : [];
    });
  }
  redact(value: unknown) {
    return redactEvidence(value, this.secrets());
  }
  streamRedactor() {
    return createTextStreamRedactor(this.secrets());
  }
  private active = new Map<
    string,
    { abort: AbortController; promise: Promise<ModelProbe> }
  >();
  private closed = false;
  private leases = new Set<{
    connectionId: string;
    revision: number;
    abort: AbortController;
    model: ConfiguredModel;
  }>();
  assertRunnable(id: string, revision: number) {
    if (this.closed)
      throw new RockyError("shutting_down", "Daemon is shutting down", 503);
    const connection = this.get(id);
    if (connection.revision !== revision)
      throw new RockyError(
        "revision_conflict",
        "Model connection changed",
        409,
      );
    if (
      connection.config.contextWindowTokens === null ||
      connection.config.contextWindowTokens <= connection.config.maxOutputTokens
    )
      throw new RockyError(
        "context_required",
        "Configure a context window with room for input before running an Agent",
        422,
      );
    return connection;
  }
  acquireModel(
    id: string,
    revision: number,
    accounting: ModelAccounting,
    signal: AbortSignal,
  ) {
    const connection = this.assertRunnable(id, revision);
    const dnsKey = `${id}:${revision}`;
    let dnsPolicy = this.dnsPolicies.get(dnsKey);
    if (!dnsPolicy) {
      dnsPolicy = new ModelDnsPolicy();
      this.dnsPolicies.set(dnsKey, dnsPolicy);
    }
    const abort = new AbortController();
    const model = new ConfiguredModel(
      connection.config,
      {
        ...accounting,
        // Reserve the entire configured input capacity, not a guessed token count.
        // Actual usage settles the reservation; unknown usage keeps the full hold.
        inputTokenBound:
          accounting.inputTokenBound ??
          (() =>
            connection.config.contextWindowTokens! -
            connection.config.maxOutputTokens),
        reserve: (...args) => {
          if (this.closed || this.get(id).revision !== revision)
            throw new RockyError(
              "model_revoked",
              "Model connection revision is no longer active",
              409,
            );
          accounting.reserve(...args);
        },
      },
      AbortSignal.any([abort.signal, signal]),
      this.env,
      dnsPolicy,
    );
    const lease = { connectionId: id, revision, abort, model };
    this.leases.add(lease);
    return {
      model,
      release: async () => {
        abort.abort();
        this.leases.delete(lease);
        await model.close();
      },
    };
  }
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
    for (const lease of this.leases)
      if (
        lease.connectionId === command.id &&
        lease.revision !== this.get(command.id).revision
      )
        lease.abort.abort();
    for (const key of this.dnsPolicies.keys())
      if (
        key.startsWith(command.id + ":") &&
        key !== `${command.id}:${saved.revision}`
      )
        this.dnsPolicies.delete(key);
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
      this.connectionDns(connection.id, connection.revision),
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
    this.dnsPolicies.clear();
    const leases = [...this.leases];
    this.leases.clear();
    for (const lease of leases) lease.abort.abort();
    await Promise.allSettled(leases.map((lease) => lease.model.close()));
    const running = [...this.active.values()];
    for (const entry of running) entry.abort.abort();
    await Promise.allSettled(running.map((entry) => entry.promise));
  }
  private connectionDns(id: string, revision: number) {
    const key = `${id}:${revision}`;
    let policy = this.dnsPolicies.get(key);
    if (!policy) {
      policy = new ModelDnsPolicy();
      this.dnsPolicies.set(key, policy);
    }
    return policy;
  }
}
