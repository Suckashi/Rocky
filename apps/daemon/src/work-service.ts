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
  RockyError,
  type Work,
  type PublicEvent,
} from "../../../packages/contracts/src/index.js";
import { Store } from "./store.js";
import { startModelFixture } from "../../../fixtures/models/server.js";
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
type Agent = ReturnType<typeof createRockyAgent>;
type Active = {
  agent: Agent;
  connection: Awaited<ReturnType<typeof connectFixture>>;
  model: Awaited<ReturnType<typeof startModelFixture>>;
  abort: AbortController;
  promise?: Promise<void>;
};
export class WorkService {
  readonly store: Store;
  readonly saver: SqliteSaver;
  readonly events = new EventEmitter();
  private active = new Map<string, Active>();
  private stopping = false;
  constructor(root: string) {
    this.store = new Store(root);
    this.saver = SqliteSaver.fromConnString(
      join(this.store.root, "graph-checkpoints.sqlite"),
    );
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
  }
  emit(work: Work, name: string, data: Record<string, unknown>) {
    const event = this.store.event(work, name, data);
    this.events.emit("event", event);
    return event;
  }
  update(work: Work) {
    work.revision++;
    let event: PublicEvent;
    this.store.transaction(() => {
      this.store.save(work);
      event = this.store.event(work, "rocky.work.updated", { work });
    });
    this.events.emit("event", event!);
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
    const work: Work = {
      id: randomUUID(),
      runId: randomUUID(),
      requestId: parsed.requestId,
      text: parsed.text,
      transport: parsed.transport,
      mode: "fixture",
      runMode,
      status: "queued",
      revision: 1,
      answer: "",
      createdAt: new Date().toISOString(),
    };
    this.store.transaction(() => {
      this.store.add(work, intent);
      this.store.event(work, "rocky.work.updated", { work });
    });
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
    try {
      const connection = await connectFixture(work.transport);
      if (abort.signal.aborted) {
        await connection.close();
        return;
      }
      const model = await startModelFixture();
      this.emit(work, "rocky.model.configured", {
        endpoint: model.endpoint,
        purpose: "target",
        mode: "fixture",
      });
      const agent = createRockyAgent(this.saver, {
        modelRequest: async (messages, child) => {
          abort.signal.throwIfAborted();
          const result = await model.request(messages, child);
          this.emit(this.store.get(work.id), "rocky.model.completed", {
            destination: model.endpoint,
            purpose: "target",
            child,
          });
          return result;
        },
        event: (name, data) => this.emit(this.store.get(work.id), name, data),
        call: async (name, args, callId) => {
          abort.signal.throwIfAborted();
          const current = this.store.get(work.id);
          const identity = work.runId + ":" + callId,
            argsHash = hash({ name, args });
          const existing = this.store.db
            .prepare("SELECT * FROM operations WHERE id=?")
            .get(identity) as
            { args_hash: string; outcome: string; result: string } | undefined;
          if (existing) {
            if (existing.args_hash !== argsHash)
              throw new RockyError(
                "operation_conflict",
                "Operation arguments changed",
                409,
              );
            if (existing.outcome === "succeeded") return existing.result;
            throw new RockyError(
              "unknown_effect",
              "Prior operation outcome requires reconciliation",
              409,
            );
          }
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
          this.store.db
            .prepare("INSERT INTO operations VALUES(?,?,?,NULL)")
            .run(identity, argsHash, "unknown");
          this.emit(current, "rocky.operation.dispatched", {
            operationId: identity,
            name,
            destination: connection.destination,
          });
          try {
            const result = await connection.client.callTool(
              { name, arguments: args },
              undefined,
              { signal: abort.signal, timeout: 10000 },
            );
            if (result.isError) throw Error("MCP fixture returned an error");
            const serialized = JSON.stringify(result);
            this.store.db
              .prepare("UPDATE operations SET outcome=?, result=? WHERE id=?")
              .run("succeeded", serialized, identity);
            this.emit(current, "rocky.operation.succeeded", {
              operationId: identity,
              name,
              result,
            });
            return serialized;
          } catch (error) {
            this.emit(current, "rocky.operation.unknown", {
              operationId: identity,
              name,
            });
            throw error;
          }
        },
      });
      const active = { agent, connection, model, abort };
      this.active.set(work.id, active);
      await this.run(work.id, undefined);
    } catch (error) {
      if (!abort.signal.aborted) {
        const current = this.store.get(work.id);
        current.status = "failed";
        current.error = error instanceof Error ? error.message : "Run failed";
        this.update(current);
      }
    }
  }
  private fingerprint(work: Work, tool: string, args: Record<string, unknown>) {
    return hash({
      workId: work.id,
      runId: work.runId,
      tool,
      args,
      transport: work.transport,
      policyRevision: 1,
      fixtureSchemaRevision: 1,
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
      if (work.status !== "cancelled") {
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
        await active.connection.close();
        await active.model.close();
        this.active.delete(id);
      }
    }
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
    work.approval.status =
      decision.decision === "approve" ? "approved" : "rejected";
    work.approval.revision++;
    this.store.transaction(() => {
      this.store.db
        .prepare("INSERT INTO decisions VALUES(?,?,?)")
        .run(decision.requestId, intent, id);
      this.store.save(work);
    });
    const active = this.active.get(id)!;
    active.promise = this.run(id, decision.decision);
    return this.store.get(id);
  }
  stop(id: string) {
    const work = this.store.get(id);
    if (!["queued", "running", "waiting_approval"].includes(work.status))
      return work;
    this.starting.get(id)?.abort.abort();
    this.active.get(id)?.abort.abort();
    work.status = "cancelled";
    if (work.approval?.status === "pending") work.approval.status = "expired";
    this.update(work);
    const active = this.active.get(id);
    if (active && !active.promise && !this.starting.has(id)) {
      active.promise = Promise.all([
        active.connection.close(),
        active.model.close(),
      ]).then(() => {
        this.active.delete(id);
      });
    }
    return work;
  }
  async close() {
    this.stopping = true;
    for (const work of this.store.list())
      if (["queued", "running", "waiting_approval"].includes(work.status))
        this.stop(work.id);
    await Promise.all([...this.starting.values()].map((a) => a.promise));
    await Promise.all(
      [...this.active.values()].map(async (a) => {
        await a.promise;
        await a.connection.close();
        await a.model.close();
      }),
    );
    this.active.clear();
    this.saver.db.close();
    this.store.close();
  }
}
