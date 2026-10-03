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
  RockyError,
  type Work,
} from "../../../packages/contracts/src/index.js";
import { Store } from "./store.js";
import { ConversationStore } from "./conversation-store.js";
import { ModelRegistry } from "./model-registry.js";
import { ModelBudgetLedger } from "./model-budget.js";
import { intentHash } from "./intent.js";
import { OperationLedger } from "./operation-ledger.js";
import { authorizeOperation } from "./policy.js";
import { OperationReconciler } from "./operation-reconciler.js";
import { observeFixtureOperation } from "./fixture-reconciliation.js";
import { GrantRegistry } from "./grants.js";
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
  connection: Awaited<ReturnType<typeof connectFixture>>;
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
  readonly modelBudgets: ModelBudgetLedger;
  readonly operations: OperationLedger;
  readonly grants: GrantRegistry;
  readonly modelSlots: ModelSlots;
  readonly admissionConfig: ReturnType<typeof admissionConfigSchema.parse>;
  readonly events = new EventEmitter();
  private active = new Map<string, Active>();
  private stopping = false;
  private readonly reconciliationAbort = new AbortController();
  private readonly reconciliations = new Set<Promise<unknown>>();
  private deliveryTimer: ReturnType<typeof setInterval>;
  deliveryError: string | null = null;
  constructor(root: string, config?: unknown) {
    this.admissionConfig = Object.freeze(
      config === undefined
        ? admissionConfigFromEnv()
        : admissionConfigSchema.parse(config),
    );
    this.modelSlots = new ModelSlots(this.admissionConfig.modelSlots);
    this.store = new Store(root);
    try {
      this.models = new ModelRegistry(this.store);
      this.store.publicEvidence = (value) => this.models.redact(value);
      this.modelBudgets = new ModelBudgetLedger(this.store);
      this.operations = new OperationLedger(this.store);
      this.grants = new GrantRegistry(this.store);
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
    work.revision++;
    this.store.transaction(() => {
      this.store.save(work, work.revision - 1);
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
    const work: Work = {
      id: randomUUID(),
      runId: randomUUID(),
      executionSessionId: randomUUID(),
      requestId: parsed.requestId,
      text: parsed.text,
      transport: parsed.transport,
      mode: parsed.mode,
      kind: parsed.kind,
      ...(parsed.workspaceId ? { workspaceId: parsed.workspaceId } : {}),
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
    });
    this.flushOutbox();
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
        if (count >= limit) break;
        if (
          work.status !== "queued" ||
          occupied.has(work.id) ||
          this.admissionClass(work) !== kind
        )
          continue;
        if (
          this.store
            .list()
            .some(
              (other) =>
                other.id !== work.id &&
                (other.workspaceId ?? other.id) ===
                  (work.workspaceId ?? work.id) &&
                (["blocked"].includes(other.status) ||
                  (occupied.has(other.id) &&
                    ["queued", "running", "waiting_approval"].includes(
                      other.status,
                    ))),
            )
        )
          continue;
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
      const connection = await connectFixture(
        work.transport,
        join(this.store.root, "synthetic-receipts", work.runId),
      );
      cleanup.push(() => connection.close());
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
            const acquire = (child: boolean) => {
              const lease = this.models.acquireModel(
                selection.connectionId,
                selection.revision,
                {
                  ...(!child
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
                      purpose: child ? "subagent" : "target",
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
                        purpose: child ? "subagent" : "target",
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
            return { root: acquire(false), child: acquire(true) };
          })()
        : undefined;
      this.emit(work, "rocky.model.configured", {
        ...(fixtureModel
          ? { endpoint: fixtureModel.endpoint }
          : { modelSelection: selection }),
        purpose: "target",
        mode: work.mode,
        toolScope: "synthetic",
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
          );
          if (operation.outcome === "succeeded") return operation.result!;
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
          const targetHash = intentHash({
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
                  : "denied",
            configurationAllowed: true,
            resourceAllowed:
              name !== "inspect_sample" ||
              this.grants.allows(current, targetHash, "known_read", 1),
            revoked: false,
            preparedTargetHash: intentHash({
              fixture: work.runId,
              transport: work.transport,
            }),
            currentTargetHash: targetHash,
            policyRevision: 1,
            preparedPolicyRevision: 1,
            operationId: operation.id,
            intentFingerprint: this.fingerprint(current, name, args),
            synthetic: true,
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
            { destination: connection.destination },
          );
          this.flushOutbox();
          try {
            const result = await connection.client.callTool(
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
            if (result.isError) throw Error("MCP fixture returned an error");
            const serialized = JSON.stringify(result);
            operation = this.operations.transition(
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
                      payload.child
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
            mode: work.mode,
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
      ...(work.modelSelection ? { modelSelection: work.modelSelection } : {}),
    });
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
        if (request.name !== "write_sample")
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
        const operation = this.operations.prepare(
          work,
          calls[0].id,
          request.name,
          request.args,
          this.fingerprint(work, request.name, request.args),
        );
        work.status = "waiting_approval";
        work.approval = {
          id: randomUUID(),
          operationId: operation.id,
          revision: 1,
          tool: request.name,
          args: request.args,
          intentFingerprint: this.fingerprint(work, request.name, request.args),
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
        work.error = error instanceof Error ? error.message : "Run failed";
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
      active.connection.close(),
      active.model.close(),
      active.worker.close(),
    ]).then(() => {
      if (this.active.get(id) === active) {
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
