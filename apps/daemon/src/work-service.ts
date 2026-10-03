import "../../../packages/agent-runtime/src/environment.js";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { RuntimeHooks } from "../../../packages/agent-runtime/src/factory.js";
import { fromModelWire } from "../../../packages/agent-runtime/src/model-wire.js";
import { WorkerChannel } from "./worker-channel.js";
import { fileURLToPath } from "node:url";
import type { AIMessage } from "@langchain/core/messages";
import type { BindToolsInput } from "@langchain/core/language_models/chat_models";
import { connectFixture } from "../../../packages/agent-runtime/src/mcp.js";
import {
  submissionSchema,
  decisionSchema,
  stopSchema,
  retrySchema,
  RockyError,
  type Work,
} from "../../../packages/contracts/src/index.js";
import { Store } from "./store.js";
import { ConversationStore } from "./conversation-store.js";
import { ContextLedger } from "./context-ledger.js";
import { SteeringStore } from "./steering.js";
import { ModelRegistry } from "./model-registry.js";
import { McpRegistry } from "./mcp-registry.js";
import { McpManager } from "./mcp-manager.js";
import {
  mcpDeliverySchema,
  mcpDataResultSchema,
} from "../../../packages/contracts/src/mcp-result.js";
import { mapMcpDelivery } from "../../../packages/agent-runtime/src/mcp-result.js";
import {
  mcpCallSchema,
  mcpDiscoverSchema,
} from "../../../packages/contracts/src/mcp-runtime.js";
import { ModelBudgetLedger } from "./model-budget.js";
import { intentHash } from "./intent.js";
import { OperationLedger } from "./operation-ledger.js";
import { authorizeOperation } from "./policy.js";
import { OperationReconciler } from "./operation-reconciler.js";
import { observeFixtureOperation } from "./fixture-reconciliation.js";
import { GrantRegistry } from "./grants.js";
import { DocumentStore } from "./documents.js";
import { MemoryRegistry } from "./memory.js";
import { ArtifactStore } from "./artifacts.js";
import { artifactPublishToolSchema } from "../../../packages/contracts/src/artifacts.js";
import { WorkspaceWorktrees } from "./workspace-worktrees.js";
import { WorkspaceWriter, WorkspaceWriteError } from "./workspace-writes.js";
import { WorkspaceRegistry, workspaceRootsOverlap } from "./workspaces.js";
import {
  writePreviewRequestSchema,
  writePreviewSchema,
  workspaceToolSchema,
  workspaceReadToolSchema,
} from "../../../packages/contracts/src/workspaces.js";
import { replacementDiff } from "./write-diff.js";
import { WorkerJobs } from "./worker-jobs.js";
import { ModelSlots } from "./model-slots.js";
import {
  admissionConfigSchema,
  admissionConfigFromEnv,
} from "./admission-config.js";
import { startModelFixture } from "../../../fixtures/models/server.js";
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
type Active = {
  worker: WorkerChannel;
  connection?: Awaited<ReturnType<typeof connectFixture>>;
  model: { close: () => Promise<void> };
  abort: AbortController;
  promise?: Promise<void>;
  closing?: Promise<void>;
  wallElapsedMs: number;
  wallTimer?: ReturnType<typeof setTimeout>;
};
export class WorkService {
  readonly store: Store;
  readonly models: ModelRegistry;
  readonly mcp: McpRegistry;
  readonly mcpManager: McpManager;
  readonly modelBudgets: ModelBudgetLedger;
  readonly operations: OperationLedger;
  readonly grants: GrantRegistry;
  readonly workspaces: WorkspaceRegistry;
  readonly artifacts: ArtifactStore;
  readonly memories: MemoryRegistry;
  readonly documents: DocumentStore;
  readonly modelSlots: ModelSlots;
  readonly admissionConfig: ReturnType<typeof admissionConfigSchema.parse>;
  readonly events = new EventEmitter();
  private workspaceWriteErrors = new Map<string, string>();
  private workspaceWorktrees = new Map<
    string,
    Awaited<ReturnType<WorkspaceWorktrees["prepare"]>>
  >();
  private workspaceWrites = new Map<
    string,
    Awaited<ReturnType<WorkspaceWriter["prepare"]>>
  >();
  private active = new Map<string, Active>();
  private stopping = false;
  private readonly reconciliationAbort = new AbortController();
  private readonly reconciliations = new Set<Promise<unknown>>();
  private deliveryTimer: ReturnType<typeof setInterval>;
  deliveryError: string | null = null;
  constructor(
    root: string,
    config?: unknown,
    private readonly testFixtureTools = false,
  ) {
    this.admissionConfig = Object.freeze(
      config === undefined
        ? admissionConfigFromEnv()
        : admissionConfigSchema.parse(config),
    );
    this.modelSlots = new ModelSlots(this.admissionConfig.modelSlots);
    this.store = new Store(root);
    try {
      this.models = new ModelRegistry(this.store);
      this.mcp = new McpRegistry(this.store);
      this.mcpManager = new McpManager(this.store, this.mcp);
      this.store.publicEvidence = (value) =>
        this.models.redact(this.mcp.redact(value));
      this.modelBudgets = new ModelBudgetLedger(this.store);
      this.operations = new OperationLedger(this.store);
      this.grants = new GrantRegistry(this.store);
      this.workspaces = new WorkspaceRegistry(this.store);
      this.artifacts = new ArtifactStore(
        this.store,
        this.workspaces,
        this.operations,
      );
      this.documents = new DocumentStore(this.store, this.artifacts);
      this.memories = new MemoryRegistry(
        this.store,
        this.workspaces,
        this.documents,
        this.grants,
      );
      new WorkerJobs(this.store).recover();
      // Never auto-replay an interrupted external action.
      for (const work of this.store.list())
        if (["running", "waiting_approval"].includes(work.status)) {
          work.status = "blocked";
          work.error =
            "Daemon restarted; review prior effects before starting a new work.";
          if (work.approval?.status === "pending")
            work.approval.status = "expired";
          work.revision++;
          this.operations.finishUndispatched(work, "restarted", () => {
            this.store.save(work, work.revision - 1);
            new SteeringStore(this.store).finish(work);
            this.store.event(work, "rocky.work.updated", { work });
          });
        }
      this.flushOutbox();
      this.deliveryTimer = setInterval(() => this.flushOutbox(), 500);
      this.deliveryTimer.unref();
      // A queued Work has no dispatched Agent or tool to replay. Re-admit only
      // that durable command; interrupted executions remain blocked above.
      this.pump();
    } catch (error) {
      this.store.close();
      throw error;
    }
  }
  async reconcileOperation(
    workId: string,
    input: unknown,
    signal: AbortSignal,
  ) {
    if (this.stopping)
      throw new RockyError("stopping", "Daemon is stopping", 503);
    const work = this.store.get(workId);
    const pending = new OperationReconciler(this.store).reconcile(
      workId,
      input,
      async (id, querySignal) => {
        const operation = this.operations.get(id)!;
        const context = JSON.parse(operation.context!);
        if (context.name !== "write_sample")
          throw new RockyError(
            "reconciliation_unsupported",
            "No status adapter for this operation",
            409,
          );
        const connection = await connectFixture(
          work.transport,
          join(this.store.root, "synthetic-receipts", work.runId),
        );
        try {
          return await observeFixtureOperation(
            connection,
            operation,
            querySignal,
          );
        } finally {
          await connection.close();
        }
      },
      AbortSignal.any([
        signal,
        this.reconciliationAbort.signal,
        AbortSignal.timeout(15000),
      ]),
    );
    this.reconciliations.add(pending);
    try {
      const receipt = await pending;
      this.flushOutbox();
      return receipt;
    } finally {
      this.reconciliations.delete(pending);
    }
  }
  private flushOutbox() {
    try {
      this.store.dispatchOutbox((event) => {
        this.events.emit("event", event);
      }, 1000);
      this.deliveryError = null;
    } catch {
      this.deliveryError = "Pending event delivery will be retried";
    }
  }
  emit(work: Work, name: string, data: Record<string, unknown>) {
    const event = this.store.event(work, name, data);
    this.flushOutbox();
    return event;
  }
  update(work: Work) {
    if (work.status !== "queued") delete work.waitingFor;
    work.revision++;
    this.store.transaction(() => {
      this.store.save(work, work.revision - 1);
      if (!["queued", "running", "waiting_approval"].includes(work.status))
        new SteeringStore(this.store).finish(work);
      this.store.event(work, "rocky.work.updated", { work });
    });
    this.flushOutbox();
  }
  submit(input: unknown, runMode: "normal" | "evaluation" = "normal") {
    if (this.stopping)
      throw new RockyError("stopping", "Daemon is stopping", 503);
    const parsed = submissionSchema.parse(input),
      intent = hash({ ...parsed, runMode });
    const prior = this.store.receipt(parsed.requestId);
    if (prior) {
      if (prior.intent !== intent)
        throw new RockyError(
          "idempotency_conflict",
          "Request ID has different content",
          409,
        );
      return this.store.get(prior.id);
    }
    return this.admit(parsed, intent, runMode);
  }
  retry(id: string, input: unknown) {
    if (this.stopping)
      throw new RockyError("stopping", "Daemon is stopping", 503);
    const command = retrySchema.parse(input),
      intent = intentHash({ retryOf: id, ...command });
    const prior = this.store.receipt(command.requestId);
    if (prior) {
      if (prior.intent !== intent)
        throw new RockyError(
          "idempotency_conflict",
          "Retry request changed",
          409,
        );
      return this.store.get(prior.id);
    }
    const source = this.store.get(id);
    if (
      source.runId !== command.runId ||
      source.executionSessionId !== command.executionSessionId ||
      source.revision !== command.expectedRevision
    )
      throw new RockyError("stale_target", "Retry source changed", 409);
    if (
      ["queued", "running", "waiting_approval"].includes(source.status) ||
      source.runMode !== "normal"
    )
      throw new RockyError(
        "retry_source",
        "Retry requires an inactive normal Work",
        409,
      );
    this.operations.validateRetry(source, command.effectRefs);
    if (command.modelSelection && source.mode !== "configured")
      throw new RockyError(
        "retry_model",
        "Fixture retry cannot select a configured model",
        422,
      );
    const parsed = submissionSchema.parse({
      requestId: command.requestId,
      text: source.text,
      transport: source.transport,
      mode: source.mode,
      kind: source.kind ?? "main",
      workspaceId: source.workspaceId,
      workspaceRevision: source.workspaceRevision,
      modelSelection: command.modelSelection ?? source.modelSelection,
      modelBudget: source.modelBudget,
    });
    return this.admit(parsed, intent, "normal", source.id, command.effectRefs);
  }
  private admit(
    parsed: ReturnType<typeof submissionSchema.parse>,
    intent: string,
    runMode: "normal" | "evaluation",
    retryOf?: string,
    retryEffectRefs?: ReturnType<typeof retrySchema.parse>["effectRefs"],
  ) {
    if (
      this.store.list().filter((w) => w.status === "queued").length >=
      this.admissionConfig.maxQueued
    )
      throw new RockyError("capacity", "Work admission queue is full", 429);
    if (parsed.modelSelection)
      this.models.assertRunnable(
        parsed.modelSelection.connectionId,
        parsed.modelSelection.revision,
      );
    if (parsed.workspaceRevision) {
      if (runMode !== "normal")
        throw new RockyError(
          "workspace_scope",
          "Host workspace access is unavailable for evaluation",
          403,
        );
      if (
        this.workspaces.get(parsed.workspaceId!).revision !==
        parsed.workspaceRevision
      )
        throw new RockyError(
          "stale_workspace",
          "Workspace revision changed",
          409,
        );
    }
    const work: Work = {
      id: randomUUID(),
      runId: randomUUID(),
      executionSessionId: randomUUID(),
      requestId: parsed.requestId,
      text: parsed.text,
      ...(retryOf ? { retryOf, retryEffectRefs } : {}),
      transport: parsed.transport,
      mode: parsed.mode,
      kind: parsed.kind,
      ...(parsed.workspaceId ? { workspaceId: parsed.workspaceId } : {}),
      ...(parsed.workspaceRevision
        ? {
            workspaceRevision: parsed.workspaceRevision,
            workspaceRead: parsed.workspaceRead === true,
          }
        : {}),
      wallBudgetMs:
        runMode === "evaluation"
          ? this.admissionConfig.evaluationWallBudgetMs
          : parsed.kind === "background"
            ? this.admissionConfig.backgroundWallBudgetMs
            : this.admissionConfig.mainWallBudgetMs,
      ...(parsed.modelBudget ? { modelBudget: parsed.modelBudget } : {}),
      ...(parsed.modelSelection
        ? { modelSelection: parsed.modelSelection }
        : {}),
      runMode,
      status: "queued",
      revision: 1,
      answer: "",
      createdAt: new Date().toISOString(),
    };
    this.store.transaction(() => {
      this.store.add(work, intent);
      this.modelBudgets.open(work.runId, work.modelBudget);
      this.store.event(work, "rocky.work.updated", { work });
      for (const selection of parsed.memoryRead ?? [])
        this.memories.grantRead(work.id, {
          requestId: randomUUID(),
          ...selection,
        });
      if (parsed.workspaceRead)
        this.grants.issue({
          requestId: randomUUID(),
          workId: work.id,
          targetHash: this.workspaceScope(work),
          effect: "known_read",
          policyRevision: 1,
          expiresAt: null,
        });
    });
    this.flushOutbox();
    if (work.mode === "fixture" || this.testFixtureTools)
      this.grants.issue({
        requestId: randomUUID(),
        workId: work.id,
        targetHash: intentHash({
          fixture: work.runId,
          transport: work.transport,
        }),
        effect: "known_read",
        policyRevision: 1,
        expiresAt: null,
      });
    this.pump();
    return work;
  }
  private starting = new Map<
    string,
    { abort: AbortController; promise: Promise<void> }
  >();
  private admissionClass(work: Work) {
    return work.runMode === "evaluation" ? "evaluation" : (work.kind ?? "main");
  }
  private resourcesOverlap(a: Work, b: Work) {
    if ((a.workspaceId ?? a.id) === (b.workspaceId ?? b.id)) return true;
    if (!a.workspaceRevision || !b.workspaceRevision) return false;
    // Registered roots stay pinned while their Work is unfinished. Native
    // children use the root Work's capability, never a second root lease.
    return workspaceRootsOverlap(
      this.workspaces.get(a.workspaceId!).root,
      this.workspaces.get(b.workspaceId!).root,
    );
  }
  private pump() {
    if (this.stopping) return;
    const occupied = new Set([...this.active.keys(), ...this.starting.keys()]);
    const classCount = (kind: "main" | "background" | "evaluation") =>
      [...occupied].filter((id) => {
        const work = this.store.get(id);
        return (
          this.admissionClass(work) === kind &&
          ["queued", "running", "waiting_approval"].includes(work.status)
        );
      }).length;
    for (const [kind, limit] of [
      ["main", this.admissionConfig.mainSlots],
      ["background", this.admissionConfig.backgroundSlots],
      ["evaluation", this.admissionConfig.evaluationSlots],
    ] as const) {
      let count = classCount(kind);
      for (const work of this.store.list()) {
        if (
          work.status !== "queued" ||
          occupied.has(work.id) ||
          this.admissionClass(work) !== kind
        )
          continue;
        const workspaceBusy = this.store
          .list()
          .some(
            (other) =>
              other.id !== work.id &&
              this.resourcesOverlap(other, work) &&
              (["blocked"].includes(other.status) ||
                (occupied.has(other.id) &&
                  ["queued", "running", "waiting_approval"].includes(
                    other.status,
                  ))),
          );
        const waitingFor = workspaceBusy
          ? "workspace"
          : count >= limit
            ? "capacity"
            : undefined;
        if (work.waitingFor !== waitingFor) {
          if (waitingFor) work.waitingFor = waitingFor;
          else delete work.waitingFor;
          this.update(work);
        }
        if (waitingFor) continue;
        const abort = new AbortController();
        // Reserve synchronously before any asynchronous connection or callback.
        const promise = this.start(work, abort);
        this.starting.set(work.id, { abort, promise });
        occupied.add(work.id);
        count++;
        void promise.finally(() => {
          this.starting.delete(work.id);
          this.pump();
        });
      }
    }
  }
  private async start(work: Work, abort: AbortController) {
    const cleanup: Array<() => Promise<void>> = [];
    let handedOff = false;
    try {
      const connection =
        work.mode === "fixture" || this.testFixtureTools
          ? await connectFixture(
              work.transport,
              join(this.store.root, "synthetic-receipts", work.runId),
            )
          : undefined;
      if (connection) cleanup.push(() => connection.close());
      if (abort.signal.aborted) {
        return;
      }
      const modelCleanup: Array<() => Promise<void>> = [];
      const fixtureModel =
        work.mode === "fixture" ? await startModelFixture() : undefined;
      if (fixtureModel) modelCleanup.push(() => fixtureModel.close());
      let streamRequestId = "",
        pendingText = "";
      let streamTimer: NodeJS.Timeout | undefined;
      let streamProjectionError: unknown;
      let redactStream = this.models.streamRedactor();
      const flushStream = (final = false) => {
        clearTimeout(streamTimer);
        streamTimer = undefined;
        const text = redactStream(pendingText, final);
        pendingText = "";
        const current = this.store.get(work.id);
        if (abort.signal.aborted || current.status !== "running") return;
        for (let offset = 0; offset < text.length; offset += 8192)
          this.emit(current, "rocky.model.stream", {
            requestId: streamRequestId,
            phase: "delta",
            delta: text.slice(offset, offset + 8192),
          });
      };
      const model = {
        close: async () => {
          clearTimeout(streamTimer);
          pendingText = "";
          await Promise.all(modelCleanup.map((close) => close()));
        },
      };
      cleanup.push(model.close);
      if (abort.signal.aborted) {
        return;
      }
      this.modelBudgets.open(work.runId, work.modelBudget);
      const selection = work.modelSelection;
      const configuredModels = selection
        ? (() => {
            const acquire = (child: boolean, summary = false) => {
              const lease = this.models.acquireModel(
                selection.connectionId,
                selection.revision,
                {
                  ...(!child && !summary
                    ? {
                        onStream: (
                          requestId: string,
                          phase: "start" | "delta" | "end",
                          delta?: string,
                        ) => {
                          if (streamProjectionError)
                            throw streamProjectionError;
                          const current = this.store.get(work.id);
                          if (
                            abort.signal.aborted ||
                            current.status !== "running"
                          )
                            return;
                          if (phase === "delta" && delta) {
                            if (requestId !== streamRequestId)
                              throw Error("Stream request identity changed");
                            pendingText += delta;
                            if (pendingText.length >= 1024) flushStream();
                            else if (!streamTimer) {
                              streamTimer = setTimeout(() => {
                                try {
                                  flushStream();
                                } catch (error) {
                                  streamProjectionError = error;
                                }
                              }, 50);
                              streamTimer.unref();
                            }
                          } else {
                            if (phase === "end") flushStream(true);
                            if (phase === "start") {
                              streamRequestId = requestId;
                              pendingText = "";
                              redactStream = this.models.streamRedactor();
                            }
                            this.emit(current, "rocky.model.stream", {
                              requestId,
                              phase,
                            });
                          }
                        },
                      }
                    : {}),
                  reserve: (requestId, inputTokenBound, outputTokenBound) => {
                    this.modelBudgets.reserve(work.runId, {
                      requestId,
                      purpose: summary
                        ? "summary"
                        : child
                          ? "subagent"
                          : "target",
                      inputTokenBound,
                      outputTokenBound,
                    });
                  },
                  settle: (requestId, usage) => {
                    this.modelBudgets.settle(work.runId, requestId, usage);
                    this.emit(
                      this.store.get(work.id),
                      "rocky.model.completed",
                      {
                        requestId,
                        connectionId: selection.connectionId,
                        connectionRevision: selection.revision,
                        purpose: summary
                          ? "summary"
                          : child
                            ? "subagent"
                            : "target",
                        child,
                        usage,
                      },
                    );
                  },
                },
                abort.signal,
              );
              modelCleanup.push(lease.release);
              return lease.model;
            };
            return {
              root: acquire(false),
              child: acquire(true),
              summary: acquire(false, true),
            };
          })()
        : undefined;
      this.emit(work, "rocky.model.configured", {
        ...(fixtureModel
          ? { endpoint: fixtureModel.endpoint }
          : { modelSelection: selection }),
        purpose: "target",
        mode: work.mode,
        toolScope:
          work.mode === "configured"
            ? this.testFixtureTools
              ? "TEST HARNESS: configured MCP plus synthetic samples"
              : "configured MCP via exact approval"
            : "synthetic",
      });
      const hooks: RuntimeHooks = {
        modelRequest: fixtureModel
          ? async (messages, child) => {
              abort.signal.throwIfAborted();
              const requestId = randomUUID();
              this.modelBudgets.reserve(work.runId, {
                requestId,
                purpose: child ? "subagent" : "target",
                inputTokenBound: null,
                outputTokenBound: null,
              });
              const result = await fixtureModel.request(messages, child);
              // The deterministic fixture does not report model token usage. Never invent zero usage.
              this.modelBudgets.settle(work.runId, requestId, null);
              this.emit(this.store.get(work.id), "rocky.model.completed", {
                destination: fixtureModel.endpoint,
                purpose: "target",
                child,
              });
              return result;
            }
          : undefined,
        event: (name, data) => this.emit(this.store.get(work.id), name, data),
        call: async (name, args, callId) => {
          abort.signal.throwIfAborted();
          const current = this.store.get(work.id);
          if (name === "memory_search") {
            if (
              current.runId !== work.runId ||
              current.executionSessionId !== work.executionSessionId
            )
              throw new RockyError(
                "memory_scope",
                "Work execution changed",
                403,
              );
            if (current.modelSelection)
              this.models.assertRunnable(
                current.modelSelection.connectionId,
                current.modelSelection.revision,
              );
            return this.memories.readForWork(current, args).context;
          }
          if (name === "artifact_publish") {
            const command = artifactPublishToolSchema.parse(args);
            if (!callId || callId.length > 256)
              throw new RockyError(
                "artifact_identity",
                "Tool identity required",
                400,
              );
            const assertActive = () => {
              abort.signal.throwIfAborted();
              const latest = this.store.get(current.id);
              if (
                latest.mode !== "configured" ||
                latest.runMode !== "normal" ||
                latest.status !== "running" ||
                latest.runId !== current.runId ||
                latest.executionSessionId !== current.executionSessionId
              )
                throw new RockyError(
                  "artifact_scope",
                  "Artifact publication requires this active normal Work",
                  403,
                );
            };
            const digest = hash(["artifact_publish", current.runId, callId]);
            const requestId =
              digest.slice(0, 8) +
              "-" +
              digest.slice(8, 12) +
              "-4" +
              digest.slice(13, 16) +
              "-8" +
              digest.slice(17, 20) +
              "-" +
              digest.slice(20, 32);
            const artifact = await this.artifacts.publish(
              current.id,
              {
                requestId,
                operationId: current.runId + ":" + command.writeCallId,
                title: command.title,
              },
              assertActive,
            );
            this.flushOutbox();
            return JSON.stringify({
              artifact,
              download:
                "/api/v1/artifacts/" + artifact.id + "/files/" + artifact.entry,
            });
          }
          if (name === "workspace_write" || name === "workspace_worktree") {
            try {
              return await this.callWorkspaceWrite(
                current,
                args,
                callId,
                abort.signal,
                name,
              );
            } catch (error) {
              const reason =
                error instanceof WorkspaceWriteError
                  ? error.message
                  : error instanceof RockyError &&
                      [
                        "target_changed",
                        "stale_approval",
                        "stale_workspace",
                        "git_changed",
                      ].includes(error.code)
                    ? "File state changed; this proposal is no longer valid. Start a new Work with a fresh proposal."
                    : name === "workspace_worktree"
                      ? "Worktree creation was denied or unavailable. Review the operation receipt before retrying."
                      : "Workspace write was denied or unavailable. Review the operation receipt before retrying.";
              this.workspaceWriteErrors.set(current.id, reason);
              throw error;
            }
          }
          if (
            ["workspace_info", "workspace_files", "workspace_read"].includes(
              name,
            )
          )
            return this.callWorkspace(
              current,
              name,
              args,
              callId,
              abort.signal,
            );
          if (
            (name === "inspect_sample" || name === "write_sample") &&
            !connection
          )
            throw new RockyError(
              "synthetic_scope",
              "Synthetic tools are unavailable in configured production",
              403,
            );
          if (name === "mcp_discover") {
            if (current.mode !== "configured" || current.runMode !== "normal")
              throw new RockyError(
                "mcp_scope",
                "Configured MCP discovery is unavailable in this mode",
                403,
              );
            const query = mcpDiscoverSchema.parse(args);
            if (!query.serverId)
              return JSON.stringify({
                servers: this.mcpManager
                  .list()
                  .filter((s) => s.status === "ready")
                  .map((s) => ({
                    serverId: s.serverId,
                    registryRevision: s.registryRevision,
                    toolsCount: s.toolsCount,
                  })),
              });
            if (!query.registryRevision)
              throw new RockyError(
                "mcp_revision_required",
                "Select the exact discovered registry revision",
                400,
              );
            if (query.kind !== "tools") {
              const data = await this.mcpManager.dataCatalog(
                query.serverId,
                query.registryRevision,
                abort.signal,
              );
              const items =
                query.kind === "resources"
                  ? [
                      ...data.resources.map((resource) => ({
                        ...resource,
                        kind: "resource",
                      })),
                      ...data.resourceTemplates.map((template) => ({
                        ...template,
                        kind: "resource_template",
                      })),
                    ]
                  : data.prompts;
              return JSON.stringify(
                this.models.redact(
                  this.mcp.redact({
                    serverId: query.serverId,
                    registryRevision: query.registryRevision,
                    kind: query.kind,
                    items: items.slice(query.offset, query.offset + 5),
                    nextOffset:
                      query.offset + 5 < items.length ? query.offset + 5 : null,
                    untrustedData: true,
                    metadataOnly: true,
                  }),
                ),
              );
            }
            const tools = this.mcpManager.catalog(
              query.serverId,
              query.registryRevision,
            );
            return JSON.stringify({
              serverId: query.serverId,
              registryRevision: query.registryRevision,
              tools: tools.slice(query.offset, query.offset + 5),
              nextOffset:
                query.offset + 5 < tools.length ? query.offset + 5 : null,
              untrustedData: true,
            });
          }
          const configuredTool =
            name === "mcp_call" || name === "mcp_data"
              ? this.configuredTool(current, args, name)
              : undefined;
          if (current.modelSelection)
            this.models.assertRunnable(
              current.modelSelection.connectionId,
              current.modelSelection.revision,
            );
          let operation = this.operations.prepare(
            current,
            callId,
            name,
            args,
            this.fingerprint(current, name, args),
            ...(configuredTool ? [intentHash(configuredTool.identity)] : []),
          );
          if (operation.outcome === "succeeded")
            return configuredTool
              ? this.deliverMcp(configuredTool, JSON.parse(operation.result!))
              : operation.result!;
          if (operation.phase !== "prepared")
            throw new RockyError(
              "unknown_effect",
              "Prior operation outcome requires reconciliation",
              409,
            );
          const owner = {
            workId: current.id,
            runId: current.runId,
            executionSessionId: current.executionSessionId,
          };
          const targetHash = configuredTool
            ? intentHash(configuredTool.identity)
            : intentHash({
                fixture: current.runId,
                transport: current.transport,
              });
          authorizeOperation({
            owner: {
              workId: work.id,
              runId: work.runId,
              executionSessionId: work.executionSessionId,
            },
            resolvedOwner: owner,
            mode: current.runMode,
            effect:
              name === "inspect_sample"
                ? "known_read"
                : name === "write_sample"
                  ? "critical"
                  : configuredTool
                    ? "unknown"
                    : "denied",
            configurationAllowed: true,
            resourceAllowed:
              name !== "inspect_sample" ||
              this.grants.allows(current, targetHash, "known_read", 1),
            revoked: false,
            preparedTargetHash: configuredTool
              ? targetHash
              : intentHash({
                  fixture: work.runId,
                  transport: work.transport,
                }),
            currentTargetHash: targetHash,
            policyRevision: 1,
            preparedPolicyRevision: 1,
            operationId: operation.id,
            intentFingerprint: this.fingerprint(current, name, args),
            synthetic: !configuredTool,
            allowLocalNew: false,
            targetExists: true,
            approval: current.approval
              ? {
                  status: current.approval.status,
                  operationId: current.approval.operationId,
                  intentFingerprint: current.approval.intentFingerprint,
                }
              : null,
          });
          operation = this.operations.transition(
            current,
            operation,
            "authorized",
            "not_executed",
          );
          abort.signal.throwIfAborted();
          operation = this.operations.transition(
            current,
            operation,
            "dispatched",
            "unknown",
            null,
            {
              destination: configuredTool
                ? "mcp:" + configuredTool.identity.serverId
                : connection!.destination,
            },
          );
          this.flushOutbox();
          try {
            const result = configuredTool
              ? "request" in configuredTool
                ? await this.mcpManager.dispatchData(
                    configuredTool,
                    {
                      operationId: operation.id,
                      intentHash: operation.args_hash,
                    },
                    abort.signal,
                  )
                : await this.mcpManager.dispatchTool(
                    configuredTool,
                    {
                      operationId: operation.id,
                      intentHash: operation.args_hash,
                    },
                    abort.signal,
                  )
              : await connection!.client.callTool(
                  {
                    name,
                    arguments: args,
                    _meta: {
                      "rocky/operation": {
                        operationId: operation.id,
                        intentHash: operation.args_hash,
                      },
                    },
                  },
                  undefined,
                  { signal: abort.signal, timeout: 10000 },
                );
            if ("isError" in result && result.isError)
              throw Error(
                "MCP tool returned an error; effects are unconfirmed",
              );
            const serialized = JSON.stringify(result);
            const delivery = configuredTool
              ? this.deliverMcp(configuredTool, result)
              : undefined;
            operation = this.operations.transition(
              current,
              operation,
              "settled",
              "succeeded",
              serialized,
              { result },
            );
            this.flushOutbox();
            return delivery ?? serialized;
          } catch (error) {
            if (operation.phase === "dispatched")
              this.operations.transition(
                current,
                operation,
                "settled",
                "unknown",
              );
            this.flushOutbox();
            throw error;
          }
        },
      };
      let worker: WorkerChannel;
      {
        const current = this.store.get(work.id);
        current.status = "running";
        this.update(current);
        const contextBatch =
          current.runMode === "normal" &&
          ((current.kind ?? "main") === "main" || current.retryOf)
            ? new ContextLedger(this.store).prepare(current)
            : undefined;
        const source = import.meta.url.endsWith(".ts");
        const entry = fileURLToPath(
          new URL(
            "../../agent-worker/src/main." + (source ? "ts" : "js"),
            import.meta.url,
          ),
        );
        worker = new WorkerChannel(
          this.store,
          work.id,
          entry,
          async (_owned, payload, requestSignal) => {
            if (payload.kind === "context_read")
              return new ContextLedger(this.store).read(
                _owned,
                payload.batchId,
                payload.index,
                payload.offset,
              );
            if (payload.kind === "steer_read")
              return new SteeringStore(this.store).read(_owned);
            if (payload.kind === "steer_ack") {
              const result = await new SteeringStore(this.store).acknowledge(
                _owned,
                payload.id,
                payload.checkpointId,
              );
              this.flushOutbox();
              return result;
            }
            if (payload.kind === "context_ack") {
              const receipt = await new ContextLedger(this.store).acknowledge(
                _owned,
                payload.batchId,
                payload.checkpointId,
              );
              this.flushOutbox();
              return receipt;
            }
            if (payload.kind === "tool_request")
              return hooks.call(
                payload.tool,
                payload.args,
                payload.logicalToolCallId,
              );
            const signal = AbortSignal.any([abort.signal, requestSignal]);
            return this.modelSlots.run(
              this.admissionClass(work),
              signal,
              async () => {
                const messages = fromModelWire(payload.messages);
                const reply = configuredModels
                  ? await (
                      payload.purpose === "summary"
                        ? configuredModels.summary
                        : payload.child
                          ? configuredModels.child
                          : configuredModels.root
                    )
                      .bindTools((payload.tools ?? []) as BindToolsInput[])
                      .invoke(messages, { signal })
                  : ((await hooks.modelRequest!(messages, payload.child))
                      .generations[0]?.message as AIMessage | undefined);
                if (!reply) throw Error("Model returned no message");
                return { content: reply.content, tool_calls: reply.tool_calls };
              },
            );
          },
          {
            graphPath: join(this.store.root, "graph-checkpoints.sqlite"),
            sourceGraphThreadId: new ConversationStore(this.store).session(
              work.id,
            ).sourceGraphThreadId,
            contextBatchId: contextBatch?.id,
            maxInputTokens: configuredModels?.root.profile.maxInputTokens,
            imageInputs: configuredModels?.root.profile.imageInputs,
            steering: true,
            mode: work.mode,
            testFixtureTools: this.testFixtureTools,
            event: (_owned, name, data) => hooks.event(name, data),
          },
        );
      }
      const active: Active = {
        worker,
        connection,
        model,
        abort,
        wallElapsedMs: 0,
      };
      this.active.set(work.id, active);
      handedOff = true;
      await this.run(work.id, undefined);
    } catch (error) {
      if (!abort.signal.aborted) {
        const current = this.store.get(work.id);
        current.status = "failed";
        current.error = error instanceof Error ? error.message : "Run failed";
        this.update(current);
      }
    } finally {
      if (!handedOff) await Promise.allSettled(cleanup.map((close) => close()));
    }
  }
  private fingerprint(work: Work, tool: string, args: Record<string, unknown>) {
    return intentHash({
      workId: work.id,
      runId: work.runId,
      executionSessionId: work.executionSessionId,
      tool,
      args,
      transport: work.transport,
      policyRevision: 1,
      fixtureSchemaRevision: 1,
      ...(tool === "mcp_call" || tool === "mcp_data"
        ? {
            mcpIdentity: this.configuredTool(work, args, tool).identity,
            mcpConfigHash: this.mcp.snapshot().hash,
            workspaceId: work.workspaceId ?? null,
          }
        : {}),
      ...(work.modelSelection ? { modelSelection: work.modelSelection } : {}),
    });
  }
  async previewWrite(approvalId: string, input: unknown) {
    const command = writePreviewRequestSchema.parse(input);
    const work = this.store.list().find((w) => w.approval?.id === approvalId);
    if (!work) throw new RockyError("not_found", "Approval not found", 404);
    const check = () => {
      const current = this.store.get(work.id),
        approval = current.approval;
      if (
        current.status !== "waiting_approval" ||
        approval?.id !== approvalId ||
        approval.tool !== "workspace_write" ||
        approval.status !== "pending" ||
        approval.revision !== command.expectedRevision ||
        approval.intentFingerprint !== command.intentFingerprint
      )
        throw new RockyError(
          "stale_approval",
          "This write proposal is no longer pending",
          409,
        );
    };
    check();
    const approval = work.approval!,
      proposal = this.workspaceWrites.get(approval.operationId!);
    if (!proposal)
      throw new RockyError(
        "stale_approval",
        "Write proposal is unavailable",
        409,
      );
    const fresh = await new WorkspaceWriter(this.workspaces).prepare(
      work,
      approval.args,
    );
    if (fresh.fingerprint !== proposal.fingerprint)
      throw new RockyError(
        "target_changed",
        "File state changed; prepare a fresh proposal",
        409,
      );
    const before = proposal.target.exists
      ? (
          await this.workspaces.read(
            proposal.workspace.id,
            proposal.workspace.revision,
            proposal.args.path,
            proposal.target.contentHash!,
          )
        ).text
      : "";
    const final = await new WorkspaceWriter(this.workspaces).prepare(
      work,
      approval.args,
    );
    check();
    if (final.fingerprint !== proposal.fingerprint)
      throw new RockyError(
        "target_changed",
        "File changed during preview",
        409,
      );
    return writePreviewSchema.parse({
      path: proposal.target.relativePath,
      previousHash: proposal.target.contentHash,
      sha256: proposal.sha256,
      ...replacementDiff(before, proposal.args.content),
    });
  }
  private async callWorkspaceWrite(
    work: Work,
    args: Record<string, unknown>,
    callId: string,
    signal: AbortSignal,
    name = "workspace_write",
  ) {
    const proposal =
      name === "workspace_worktree"
        ? this.workspaceWorktrees.get(work.runId + ":" + callId)
        : this.workspaceWrites.get(work.runId + ":" + callId);
    if (!proposal || intentHash(args) !== intentHash(proposal.args))
      throw new RockyError(
        "stale_approval",
        "Write proposal is unavailable or changed",
        409,
      );
    let operation = this.operations.prepare(
      work,
      callId,
      name,
      args,
      proposal.fingerprint,
      proposal.targetIdentity,
    );
    if (operation.outcome === "succeeded") return operation.result!;
    if (operation.phase !== "prepared")
      throw new RockyError(
        "unknown_effect",
        "Prior write requires reconciliation",
        409,
      );
    const fresh =
      name === "workspace_worktree"
        ? await new WorkspaceWorktrees(this.workspaces).prepare(
            work,
            args,
            signal,
          )
        : await new WorkspaceWriter(this.workspaces).prepare(work, args);
    signal.throwIfAborted();
    if (fresh.fingerprint !== proposal.fingerprint)
      throw new RockyError(
        "stale_approval",
        "File or workspace changed; prepare a fresh proposal",
        409,
      );
    const current = this.store.get(work.id);
    if (current.modelSelection)
      this.models.assertRunnable(
        current.modelSelection.connectionId,
        current.modelSelection.revision,
      );
    const owner = {
      workId: current.id,
      runId: current.runId,
      executionSessionId: current.executionSessionId,
    };
    authorizeOperation({
      owner,
      resolvedOwner: owner,
      mode: current.runMode,
      effect: "critical",
      configurationAllowed: true,
      resourceAllowed:
        current.workspaceId === proposal.workspace.id &&
        current.workspaceRevision === proposal.workspace.revision,
      revoked: false,
      preparedTargetHash: proposal.targetIdentity,
      currentTargetHash: fresh.targetIdentity,
      policyRevision: 1,
      preparedPolicyRevision: 1,
      operationId: operation.id,
      intentFingerprint: fresh.fingerprint,
      synthetic: false,
      allowLocalNew: false,
      targetExists: fresh.target.exists,
      approval: current.approval
        ? {
            status: current.approval.status,
            operationId: current.approval.operationId,
            intentFingerprint: current.approval.intentFingerprint,
          }
        : null,
    });
    operation = this.operations.transition(
      current,
      operation,
      "authorized",
      "not_executed",
    );
    signal.throwIfAborted();
    operation = this.operations.transition(
      current,
      operation,
      "dispatched",
      "unknown",
      null,
      { destination: "workspace:" + current.workspaceId },
    );
    this.flushOutbox();
    try {
      const result =
        "git" in proposal
          ? await new WorkspaceWorktrees(this.workspaces).dispatch(
              proposal,
              signal,
            )
          : await new WorkspaceWriter(this.workspaces).dispatch(
              proposal,
              signal,
            );
      const serialized = JSON.stringify(result);
      this.operations.transition(
        current,
        operation,
        "settled",
        "succeeded",
        serialized,
        { result },
      );
      this.flushOutbox();
      return serialized;
    } catch (error) {
      this.operations.transition(
        current,
        operation,
        "settled",
        error instanceof WorkspaceWriteError ? error.outcome : "unknown",
      );
      this.flushOutbox();
      throw error;
    }
  }
  private workspaceScope(work: Work) {
    if (
      work.mode !== "configured" ||
      work.runMode !== "normal" ||
      work.workspaceRead !== true ||
      !work.workspaceId ||
      !work.workspaceRevision
    )
      throw new RockyError(
        "workspace_scope",
        "No registered workspace is bound to this Work",
        403,
      );
    const workspace = this.workspaces.get(work.workspaceId);
    if (workspace.revision !== work.workspaceRevision)
      throw new RockyError(
        "stale_workspace",
        "Workspace revision changed",
        409,
      );
    return intentHash({
      workspaceId: workspace.id,
      revision: workspace.revision,
      rootIdentity: workspace.rootIdentity,
      root: workspace.root,
      effect: "known_read",
      policyRevision: 1,
    });
  }
  private async callWorkspace(
    work: Work,
    name: string,
    args: Record<string, unknown>,
    callId: string,
    signal: AbortSignal,
  ) {
    const paging =
      name === "workspace_read"
        ? workspaceReadToolSchema.parse(args)
        : undefined;
    const query = paging ?? workspaceToolSchema.parse(args),
      targetHash = this.workspaceScope(work);
    const check = () => {
      signal.throwIfAborted();
      if (!this.grants.allows(work, targetHash, "known_read", 1))
        throw new RockyError(
          "workspace_scope",
          "This Work has no active workspace read grant",
          403,
        );
      if (this.workspaceScope(work) !== targetHash)
        throw new RockyError(
          "workspace_changed",
          "Workspace scope changed",
          409,
        );
    };
    check();
    if (work.modelSelection)
      this.models.assertRunnable(
        work.modelSelection.connectionId,
        work.modelSelection.revision,
      );
    const fingerprint = intentHash({
      workId: work.id,
      runId: work.runId,
      executionSessionId: work.executionSessionId,
      name,
      args: query,
      targetHash,
      modelSelection: work.modelSelection,
    });
    let operation = this.operations.prepare(
      work,
      callId,
      name,
      query,
      fingerprint,
      intentHash({ scope: targetHash, runId: work.runId, readCallId: callId }),
    );
    if (operation.outcome === "succeeded") return operation.result!;
    if (operation.phase !== "prepared")
      throw new RockyError(
        "read_replay",
        "Previous read did not complete; use a fresh call identity",
        409,
      );
    const owner = {
      workId: work.id,
      runId: work.runId,
      executionSessionId: work.executionSessionId,
    };
    authorizeOperation({
      owner,
      resolvedOwner: owner,
      mode: work.runMode,
      effect: "known_read",
      configurationAllowed: true,
      resourceAllowed: this.grants.allows(work, targetHash, "known_read", 1),
      revoked: false,
      preparedTargetHash: targetHash,
      currentTargetHash: targetHash,
      policyRevision: 1,
      preparedPolicyRevision: 1,
      operationId: operation.id,
      intentFingerprint: fingerprint,
      synthetic: false,
      allowLocalNew: false,
      targetExists: true,
      approval: null,
    });
    operation = this.operations.transition(
      work,
      operation,
      "authorized",
      "not_executed",
    );
    operation = this.operations.transition(
      work,
      operation,
      "dispatched",
      "unknown",
      null,
      { destination: "workspace:" + work.workspaceId },
    );
    this.flushOutbox();
    try {
      const workspace = await this.workspaces.root(
        work.workspaceId!,
        work.workspaceRevision!,
      );
      let result: Record<string, unknown> =
        name === "workspace_info"
          ? {
              workspaceId: workspace.id,
              revision: workspace.revision,
              name: workspace.name,
              untrustedData: true,
              capabilities: ["workspace_files", "workspace_read"],
            }
          : name === "workspace_files"
            ? await this.workspaces.files(
                workspace.id,
                workspace.revision,
                query.path,
              )
            : await this.workspaces.read(
                workspace.id,
                workspace.revision,
                query.path,
                paging?.expectedHash,
              );
      if (paging) {
        const file = result as Awaited<ReturnType<WorkspaceRegistry["read"]>>,
          characters = [...file.text];
        const end = Math.min(characters.length, paging.offset + paging.limit);
        result = {
          ...file,
          text: characters.slice(paging.offset, end).join(""),
          offset: paging.offset,
          nextOffset: end < characters.length ? end : null,
          totalCharacters: characters.length,
          truncated: end < characters.length,
        };
      }
      check();
      if (work.modelSelection)
        this.models.assertRunnable(
          work.modelSelection.connectionId,
          work.modelSelection.revision,
        );
      const delivery = this.models.redact(
          this.mcp.redact({ ...result, untrustedData: true }),
        ),
        serialized = JSON.stringify(delivery);
      this.operations.transition(
        work,
        operation,
        "settled",
        "succeeded",
        serialized,
        { result: delivery },
      );
      this.flushOutbox();
      return serialized;
    } catch (error) {
      this.operations.transition(
        work,
        operation,
        "settled",
        "failed_known_no_effect",
      );
      this.flushOutbox();
      throw error;
    }
  }
  private configuredTool(
    work: Work,
    args: Record<string, unknown>,
    name = "mcp_call",
  ) {
    if (work.mode !== "configured" || work.runMode !== "normal")
      throw new RockyError(
        "mcp_scope",
        "Configured MCP execution is unavailable in this mode",
        403,
      );
    if (name === "mcp_data") return this.mcpManager.prepareData(args);
    const call = mcpCallSchema.parse(args);
    return this.mcpManager.prepareTool(
      call.serverId,
      call.registryRevision,
      call.toolName,
      call.arguments,
    );
  }
  private deliverMcp(
    prepared:
      | ReturnType<McpManager["prepareTool"]>
      | ReturnType<McpManager["prepareData"]>,
    result: unknown,
  ) {
    const { serverId, configRevision, registryRevision, toolName, schemaHash } =
      prepared.identity;
    const data =
      "request" in prepared ? mcpDataResultSchema.parse(result) : undefined;
    const delivery = mcpDeliverySchema.parse({
      kind: "mcp_result",
      source: {
        serverId,
        configRevision,
        registryRevision,
        toolName,
        schemaHash,
      },
      result: this.models.redact(this.mcp.redact(data ? data.result : result)),
      ...(data ? { dataKind: data.dataKind } : {}),
    });
    mapMcpDelivery(delivery);
    return delivery;
  }
  private async run(id: string, decision?: "approve" | "reject") {
    const active = this.active.get(id)!;
    let work = this.store.get(id);
    work.status = "running";
    this.update(work);
    const wallBudgetMs =
      work.wallBudgetMs ??
      (this.admissionClass(work) === "background"
        ? this.admissionConfig.backgroundWallBudgetMs
        : this.admissionClass(work) === "evaluation"
          ? this.admissionConfig.evaluationWallBudgetMs
          : this.admissionConfig.mainWallBudgetMs);
    const remaining = wallBudgetMs - active.wallElapsedMs;
    if (remaining <= 0) {
      this.cancelWork(id, undefined, "wall_budget");
      await this.release(id, active);
      return;
    }
    const segmentStarted = performance.now();
    active.wallTimer = setTimeout(() => {
      if (this.store.get(id).status === "running")
        this.cancelWork(id, undefined, "wall_budget");
    }, remaining);
    active.wallTimer.unref();
    try {
      const result = await active.worker.invoke(decision);
      if (active.abort.signal.aborted) return;
      work = this.store.get(id);
      const raw = result as unknown as {
        __interrupt__?: {
          value: {
            actionRequests: { name: string; args: Record<string, unknown> }[];
          };
        }[];
        messages?: {
          content: unknown;
          type?: string;
          tool_calls?: {
            id?: string;
            name: string;
            args: Record<string, unknown>;
          }[];
        }[];
      };
      const request = raw.__interrupt__?.[0]?.value.actionRequests?.[0];
      if (request) {
        if (
          raw.__interrupt__?.length !== 1 ||
          raw.__interrupt__[0]?.value.actionRequests?.length !== 1
        )
          throw Error("Only one exact tool approval at a time is supported");
        if (
          (request.name === "write_sample" && !active.connection) ||
          (request.name !== "write_sample" &&
            request.name !== "mcp_call" &&
            request.name !== "mcp_data" &&
            request.name !== "workspace_write" &&
            request.name !== "workspace_worktree")
        )
          throw Error("Unsupported interrupt");
        const calls =
          raw.messages
            ?.at(-1)
            ?.tool_calls?.filter(
              (call) =>
                call.name === request.name &&
                intentHash(call.args) === intentHash(request.args),
            ) ?? [];
        if (calls.length !== 1 || !calls[0]?.id)
          throw Error("Interrupted tool identity is ambiguous or missing");
        const worktreeProposal =
          request.name === "workspace_worktree"
            ? await new WorkspaceWorktrees(this.workspaces).prepare(
                work,
                request.args,
                active.abort.signal,
              )
            : undefined;
        if (worktreeProposal)
          this.workspaceWorktrees.set(
            work.runId + ":" + calls[0].id,
            worktreeProposal,
          );
        const writeProposal =
          request.name === "workspace_write"
            ? await new WorkspaceWriter(this.workspaces).prepare(
                work,
                request.args,
              )
            : undefined;
        active.abort.signal.throwIfAborted();
        if (writeProposal)
          this.workspaceWrites.set(
            work.runId + ":" + calls[0].id,
            writeProposal,
          );
        const approvalFingerprint =
          worktreeProposal?.fingerprint ??
          writeProposal?.fingerprint ??
          this.fingerprint(work, request.name, request.args);
        const operation = this.operations.prepare(
          work,
          calls[0].id,
          request.name,
          request.args,
          approvalFingerprint,
          ...(worktreeProposal
            ? [worktreeProposal.targetIdentity]
            : writeProposal
              ? [writeProposal.targetIdentity]
              : []),
          ...(request.name === "mcp_call" || request.name === "mcp_data"
            ? [
                intentHash(
                  this.configuredTool(work, request.args, request.name)
                    .identity,
                ),
              ]
            : []),
        );
        work.status = "waiting_approval";
        const dataPreview =
          request.name === "mcp_data"
            ? this.mcpManager.prepareData(request.args)
            : undefined;
        work.approval = {
          id: randomUUID(),
          operationId: operation.id,
          revision: 1,
          tool: request.name,
          ...(worktreeProposal
            ? {
                worktreePreview: {
                  destination: worktreeProposal.git.destination,
                  branch: worktreeProposal.git.branch,
                  head: worktreeProposal.git.head,
                },
              }
            : {}),
          ...(writeProposal
            ? { targetPreview: writeProposal.target.relativePath }
            : {}),
          ...(dataPreview
            ? {
                targetPreview:
                  dataPreview.uri ??
                  (dataPreview.request.target.kind === "prompt"
                    ? dataPreview.request.target.name
                    : "MCP data"),
              }
            : {}),
          args: request.args,
          intentFingerprint: approvalFingerprint,
          status: "pending",
        };
        this.update(work);
        this.emit(work, "rocky.approval.required", { approval: work.approval });
        return;
      }
      const last = raw.messages?.at(-1);
      work.answer =
        typeof last?.content === "string"
          ? last.content
          : JSON.stringify(last?.content ?? "");
      const unknown = this.store.db
        .prepare(
          "SELECT id FROM operations WHERE id LIKE ? AND outcome='unknown' LIMIT 1",
        )
        .get(work.runId + ":%");
      if (unknown) {
        work.status = "blocked";
        work.answer = "";
        work.error =
          "Operation outcome is unknown; reconciliation is required before retry.";
      } else work.status = "completed";
      this.update(work);
    } catch (error) {
      work = this.store.get(id);
      if (!active.abort.signal.aborted) {
        const unknown = this.store.db
          .prepare(
            "SELECT id FROM operations WHERE id LIKE ? AND outcome='unknown' LIMIT 1",
          )
          .get(work.runId + ":%");
        work.status = unknown ? "blocked" : "failed";
        work.error =
          this.workspaceWriteErrors.get(id) ??
          (error instanceof Error ? error.message : "Run failed");
        if (
          work.approval &&
          ["workspace_write", "workspace_worktree"].includes(
            work.approval?.tool ?? "",
          ) &&
          work.approval.status === "approved" &&
          this.workspaceWriteErrors.has(id) &&
          ["not_executed", "failed_known_no_effect"].includes(
            this.operations.get(work.approval.operationId!)?.outcome ??
              "unknown",
          )
        ) {
          work.approval.status = "expired";
          work.approval.revision++;
        }
        this.update(work);
      }
    } finally {
      clearTimeout(active.wallTimer);
      active.wallTimer = undefined;
      active.wallElapsedMs += performance.now() - segmentStarted;
      if (this.store.get(id).status !== "waiting_approval") {
        await this.release(id, active);
      }
    }
  }
  private release(id: string, active: Active) {
    active.closing ??= Promise.all([
      active.connection?.close(),
      active.model.close(),
      active.worker.close(),
    ]).then(() => {
      if (this.active.get(id) === active) {
        for (const key of this.workspaceWorktrees.keys())
          if (key.startsWith(this.store.get(id).runId + ":"))
            this.workspaceWorktrees.delete(key);
        for (const key of this.workspaceWrites.keys())
          if (key.startsWith(this.store.get(id).runId + ":"))
            this.workspaceWrites.delete(key);
        this.workspaceWriteErrors.delete(id);
        this.active.delete(id);
        this.pump();
      }
    });
    return active.closing;
  }
  decide(id: string, input: unknown) {
    const decision = decisionSchema.parse(input),
      work = this.store.get(id);
    const intent = hash({ id, ...decision });
    const prior = this.store.db
      .prepare("SELECT intent FROM decisions WHERE request_id=?")
      .get(decision.requestId) as { intent: string } | undefined;
    if (prior) {
      if (prior.intent !== intent)
        throw new RockyError("idempotency_conflict", "Decision changed", 409);
      return work;
    }
    if (
      work.status !== "waiting_approval" ||
      !work.approval ||
      work.approval.status !== "pending" ||
      !this.active.has(id)
    )
      throw new RockyError(
        "stale_approval",
        "Approval is no longer pending",
        409,
      );
    if (
      work.approval.revision !== decision.expectedRevision ||
      work.approval.intentFingerprint !== decision.intentFingerprint
    )
      throw new RockyError(
        "stale_approval",
        "Approval fingerprint or revision changed",
        409,
      );
    if (work.modelSelection)
      this.models.assertRunnable(
        work.modelSelection.connectionId,
        work.modelSelection.revision,
      );
    if (
      decision.decision === "approve" &&
      ["mcp_call", "mcp_data"].includes(work.approval.tool) &&
      this.fingerprint(work, work.approval.tool, work.approval.args) !==
        work.approval.intentFingerprint
    )
      throw new RockyError(
        "stale_approval",
        "MCP approval identity changed",
        409,
      );
    work.approval.status =
      decision.decision === "approve" ? "approved" : "rejected";
    work.approval.revision++;
    work.revision++;
    const persistDecision = () => {
      this.store.db
        .prepare("INSERT INTO decisions VALUES(?,?,?)")
        .run(decision.requestId, intent, id);
      this.store.save(work, work.revision - 1);
      this.store.event(work, "rocky.work.updated", { work });
    };
    if (decision.decision === "reject" && work.approval.operationId) {
      const operation = this.operations.get(work.approval.operationId);
      if (!operation)
        throw new RockyError(
          "operation_missing",
          "Approval operation missing",
          409,
        );
      this.operations.transition(
        work,
        operation,
        "settled",
        "not_executed",
        null,
        {},
        persistDecision,
      );
    } else this.store.transaction(persistDecision);
    this.flushOutbox();
    const active = this.active.get(id)!;
    active.promise = this.run(id, decision.decision);
    return this.store.get(id);
  }
  stop(id: string, input: unknown) {
    const command = stopSchema.parse(input);
    const intent = hash({ id, ...command });
    const prior = this.store.db
      .prepare("SELECT intent,result FROM stop_receipts WHERE request_id=?")
      .get(command.requestId) as { intent: string; result: string } | undefined;
    if (prior) {
      if (prior.intent !== intent)
        throw new RockyError(
          "idempotency_conflict",
          "Stop request changed",
          409,
        );
      return JSON.parse(prior.result) as Work;
    }
    const work = this.store.get(id);
    if (
      work.runId !== command.runId ||
      work.executionSessionId !== command.executionSessionId ||
      work.revision !== command.expectedRevision
    )
      throw new RockyError(
        "stale_target",
        "Work run, session or revision changed",
        409,
      );
    if (!["queued", "running", "waiting_approval"].includes(work.status))
      throw new RockyError("terminal_work", "Work is no longer active", 409);
    return this.cancelWork(id, { requestId: command.requestId, intent });
  }
  steer(id: string, input: unknown) {
    const result = new SteeringStore(this.store).accept(id, input);
    this.flushOutbox();
    return this.store.publicEvidence(result);
  }
  private cancelWork(
    id: string,
    receipt?: { requestId: string; intent: string },
    reason: "stopped" | "wall_budget" = "stopped",
  ) {
    const work = this.store.get(id);
    if (!["queued", "running", "waiting_approval"].includes(work.status))
      return work;
    const unknown = this.store.db
      .prepare(
        "SELECT id FROM operations WHERE id LIKE ? AND outcome='unknown' LIMIT 1",
      )
      .get(work.runId + ":%");
    work.status = unknown
      ? "blocked"
      : reason === "wall_budget"
        ? "failed"
        : "cancelled";
    delete work.waitingFor;
    if (unknown)
      work.error =
        "Stopped with an unconfirmed operation outcome; reconciliation is required.";
    else if (reason === "wall_budget")
      work.error = "Work active execution time budget exhausted";
    if (work.approval?.status === "pending") work.approval.status = "expired";
    work.revision++;
    this.operations.finishUndispatched(work, reason, () => {
      this.store.save(work, work.revision - 1);
      this.store.event(work, "rocky.work.updated", { work });
      new SteeringStore(this.store).finish(work);
      if (receipt)
        this.store.db
          .prepare("INSERT INTO stop_receipts VALUES(?,?,?)")
          .run(receipt.requestId, receipt.intent, JSON.stringify(work));
    });
    this.flushOutbox();
    this.starting.get(id)?.abort.abort();
    this.active.get(id)?.abort.abort();
    const active = this.active.get(id);
    if (active?.worker) void active.worker.close();
    if (active && !active.promise && !this.starting.has(id)) {
      active.promise = this.release(id, active);
    }
    this.pump();
    return work;
  }
  async close() {
    this.stopping = true;
    clearInterval(this.deliveryTimer);
    this.reconciliationAbort.abort();
    await Promise.allSettled([...this.reconciliations]);
    for (const work of this.store.list())
      if (["queued", "running", "waiting_approval"].includes(work.status))
        this.cancelWork(work.id);
    await this.models.close();
    await this.mcpManager.close();
    this.mcp.close();
    await Promise.all([...this.starting.values()].map((a) => a.promise));
    await Promise.all(
      [...this.active.entries()].map(async ([id, a]) => {
        await a.promise;
        await this.release(id, a);
      }),
    );
    this.active.clear();
    this.flushOutbox();
    this.store.close();
  }
}
