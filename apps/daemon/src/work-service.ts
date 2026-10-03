import "../../../packages/agent-runtime/src/environment.js";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { Command } from "@langchain/langgraph";
import { createRockyAgent } from "../../../packages/agent-runtime/src/factory.js";
import { connectFixture } from "../../../packages/agent-runtime/src/mcp.js";
import {
  submissionSchema,
  decisionSchema,
  stopSchema,
  RockyError,
  type Work,
} from "../../../packages/contracts/src/index.js";
import { Store } from "./store.js";
import { ModelRegistry } from "./model-registry.js";
import { ModelBudgetLedger } from "./model-budget.js";
import { intentHash } from "./intent.js";
import { OperationLedger } from "./operation-ledger.js";
import { startModelFixture } from "../../../fixtures/models/server.js";
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
type Agent = ReturnType<typeof createRockyAgent>;
type Active = {
  agent: Agent;
  connection: Awaited<ReturnType<typeof connectFixture>>;
  model: { close: () => Promise<void> };
  abort: AbortController;
  promise?: Promise<void>;
  closing?: Promise<void>;
};
export class WorkService {
  readonly store: Store;
  readonly saver: SqliteSaver;
  readonly models: ModelRegistry;
  readonly modelBudgets: ModelBudgetLedger;
  readonly operations: OperationLedger;
  readonly events = new EventEmitter();
  private active = new Map<string, Active>();
  private stopping = false;
  private deliveryTimer: ReturnType<typeof setInterval>;
  deliveryError: string | null = null;
  constructor(root: string) {
    this.store = new Store(root);
    let saver: SqliteSaver | undefined;
    try {
      saver = SqliteSaver.fromConnString(
        join(this.store.root, "graph-checkpoints.sqlite"),
      );
      this.saver = saver;
      this.models = new ModelRegistry(this.store);
      this.modelBudgets = new ModelBudgetLedger(this.store);
      this.operations = new OperationLedger(this.store);
      // Never auto-replay an interrupted external action.
      for (const work of this.store.list())
        if (["running", "waiting_approval", "queued"].includes(work.status)) {
          work.status = "blocked";
          work.error =
            "Daemon restarted; review prior effects before starting a new work.";
          if (work.approval?.status === "pending")
            work.approval.status = "expired";
          this.update(work);
        }
      this.flushOutbox();
      this.deliveryTimer = setInterval(() => this.flushOutbox(), 500);
      this.deliveryTimer.unref();
    } catch (error) {
      saver?.db.close();
      this.store.close();
      throw error;
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
    if (new Set([...this.active.keys(), ...this.starting.keys()]).size >= 3)
      throw new RockyError("capacity", "Fixture capacity reached", 429);
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
    const abort = new AbortController();
    // Reserve before the first asynchronous connection, so stop and capacity checks are exact.
    const promise = this.start(work, abort);
    this.starting.set(work.id, { abort, promise });
    void promise.finally(() => this.starting.delete(work.id));
    return work;
  }
  private starting = new Map<
    string,
    { abort: AbortController; promise: Promise<void> }
  >();
  private async start(work: Work, abort: AbortController) {
    const cleanup: Array<() => Promise<void>> = [];
    let handedOff = false;
    try {
      const connection = await connectFixture(work.transport);
      cleanup.push(() => connection.close());
      if (abort.signal.aborted) {
        return;
      }
      const modelCleanup: Array<() => Promise<void>> = [];
      const fixtureModel =
        work.mode === "fixture" ? await startModelFixture() : undefined;
      if (fixtureModel) modelCleanup.push(() => fixtureModel.close());
      const model = {
        close: async () => {
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
      const agent = createRockyAgent(
        this.saver,
        {
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
            if (name === "write_sample") {
              const approval = current.approval;
              if (
                approval?.status !== "approved" ||
                approval.intentFingerprint !==
                  this.fingerprint(current, name, args)
              )
                throw new RockyError(
                  "approval_required",
                  "Exact server approval required",
                  403,
                );
            } else if (name !== "inspect_sample")
              throw new RockyError(
                "tool_denied",
                "Tool is not in fixture scope",
                403,
              );
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
                { name, arguments: args },
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
        },
        configuredModels,
      );
      const active = { agent, connection, model, abort };
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
    try {
      const result = await active.agent.invoke(
        decision
          ? new Command({
              resume: {
                decisions: [
                  decision === "approve"
                    ? { type: "approve" }
                    : {
                        type: "reject",
                        message: "Owner rejected synthetic write",
                      },
                ],
              },
            })
          : { messages: [{ role: "user", content: work.text }] },
        {
          configurable: { thread_id: work.runId },
          signal: active.abort.signal,
          recursionLimit: 30,
        },
      );
      if (active.abort.signal.aborted) return;
      work = this.store.get(id);
      const raw = result as unknown as {
        __interrupt__?: {
          value: {
            actionRequests: { name: string; args: Record<string, unknown> }[];
          };
        }[];
        messages?: { content: unknown; type?: string }[];
      };
      const request = raw.__interrupt__?.[0]?.value.actionRequests?.[0];
      if (request) {
        if (request.name !== "write_sample")
          throw Error("Unsupported interrupt");
        work.status = "waiting_approval";
        work.approval = {
          id: randomUUID(),
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
      if (this.store.get(id).status !== "waiting_approval") {
        await this.release(id, active);
      }
    }
  }
  private release(id: string, active: Active) {
    active.closing ??= Promise.all([
      active.connection.close(),
      active.model.close(),
    ]).then(() => {
      if (this.active.get(id) === active) this.active.delete(id);
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
    this.store.transaction(() => {
      this.store.db
        .prepare("INSERT INTO decisions VALUES(?,?,?)")
        .run(decision.requestId, intent, id);
      this.store.save(work, work.revision - 1);
      this.store.event(work, "rocky.work.updated", { work });
    });
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
  ) {
    const work = this.store.get(id);
    if (!["queued", "running", "waiting_approval"].includes(work.status))
      return work;
    const unknown = this.store.db
      .prepare(
        "SELECT id FROM operations WHERE id LIKE ? AND outcome='unknown' LIMIT 1",
      )
      .get(work.runId + ":%");
    work.status = unknown ? "blocked" : "cancelled";
    if (unknown)
      work.error =
        "Stopped with an unconfirmed operation outcome; reconciliation is required.";
    if (work.approval?.status === "pending") work.approval.status = "expired";
    work.revision++;
    this.store.transaction(() => {
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
    if (active && !active.promise && !this.starting.has(id)) {
      active.promise = this.release(id, active);
    }
    return work;
  }
  async close() {
    this.stopping = true;
    clearInterval(this.deliveryTimer);
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
    this.saver.db.close();
    this.store.close();
  }
}
