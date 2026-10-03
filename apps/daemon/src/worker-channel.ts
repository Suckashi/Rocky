import { fork, spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { parseIpcMessage } from "../../../packages/contracts/src/ipc.js";
import { ModelTransferAssembler } from "../../../packages/contracts/src/model-transfer.js";
import {
  ResultTransferAssembler,
  frameResult,
  type ResultPayload,
} from "../../../packages/contracts/src/result-transfer.js";
import {
  RockyError,
  type Work,
} from "../../../packages/contracts/src/index.js";
import { Store } from "./store.js";
import { WorkerJobs } from "./worker-jobs.js";
type Message = ReturnType<typeof parseIpcMessage>;
type Handler = (
  work: Work,
  payload: Extract<
    Message["payload"],
    {
      kind:
        | "tool_request"
        | "model_request"
        | "context_read"
        | "context_ack"
        | "steer_read"
        | "steer_ack";
    }
  >,
  signal: AbortSignal,
) => Promise<unknown>;
type AgentOptions = {
  reflection?: Extract<Message["payload"], { kind: "start" }>["reflection"];
  graphPath: string;
  sourceGraphThreadId?: string;
  contextBatchId?: string;
  maxInputTokens?: number;
  imageInputs?: boolean;
  steering?: boolean;
  testFixtureTools?: boolean;
  mode?: "fixture" | "configured";
  event: (work: Work, name: string, data: Record<string, unknown>) => void;
};

/** Trusted Node entry only. A channel grants one stored run, never a domain database path. */
export class WorkerChannel {
  readonly child: ChildProcess;
  readonly exited: Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>;
  private readonly capability = randomBytes(32).toString("hex");
  private sequence = 0n;
  private received = 0n;
  private readonly pending = new Map<string, AbortController>();
  private readonly seen = new Set<string>();
  private readonly modelTransfer = new ModelTransferAssembler();
  private readonly resultTransfer = new ResultTransferAssembler();
  private readonly jobs = new Set<Promise<void>>();
  private stopped = false;
  private completedInvocation = false;
  private failure: string | null = null;
  private closing?: Promise<void>;
  private readonly owner: Work;
  private readonly agentOptions?: AgentOptions;
  private readonly startRequestId = randomUUID();
  private invocation?: {
    id: string;
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
  };
  private readonly jobRegistry: WorkerJobs;
  readonly jobId: string;
  constructor(
    private readonly store: Store,
    workId: string,
    entry: string,
    private readonly handler: Handler,
    agentOptions?: AgentOptions,
  ) {
    if (
      agentOptions?.reflection &&
      (agentOptions.mode !== "configured" ||
        agentOptions.testFixtureTools ||
        agentOptions.sourceGraphThreadId ||
        agentOptions.contextBatchId ||
        agentOptions.steering ||
        agentOptions.imageInputs)
    )
      throw new RockyError(
        "reflection_start",
        "Reflection cannot inherit normal context or tools",
        422,
      );
    this.agentOptions = agentOptions;
    this.owner = store.get(workId);
    if (this.owner.status !== "running")
      throw new RockyError(
        "worker_owner",
        "Worker needs a running owned Work",
        409,
      );
    this.jobRegistry = new WorkerJobs(store);
    this.jobId = this.jobRegistry.begin(this.owner).id;
    let spawned: ChildProcess | undefined;
    try {
      spawned = fork(entry, [], {
        execPath: process.execPath,
        execArgv: [
          "--import",
          new URL("../../../scripts/worker-network-guard.mjs", import.meta.url)
            .href,
          ...(entry.endsWith(".ts") ? ["--import", "tsx"] : []),
        ],
        env: Object.fromEntries(
          ["PATH", "SystemRoot", "TEMP", "TMP"].flatMap((key) =>
            process.env[key] ? [[key, process.env[key]!]] : [],
          ),
        ),
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        windowsHide: true,
        detached: process.platform !== "win32",
        serialization: "json",
      });
      this.child = spawned;
      this.jobRegistry.attach(this.jobId, this.child.pid!);
    } catch (error) {
      spawned?.kill();
      this.jobRegistry.finish(
        this.jobId,
        "interrupted",
        null,
        "Worker failed to start",
      );
      throw error;
    }
    this.exited = new Promise((resolve) => {
      this.child.once("exit", (code, signal) => {
        if (
          this.agentOptions &&
          !this.completedInvocation &&
          !this.closing &&
          !this.failure
        )
          this.failure = "Worker exited without a confirmed invocation result";
        this.abortAll();
        try {
          const status = this.failure
            ? "interrupted"
            : this.completedInvocation && code === 0
              ? "exited"
              : this.closing
                ? "cancelled"
                : code === 0
                  ? "exited"
                  : "interrupted";
          this.jobRegistry.finish(
            this.jobId,
            status,
            code,
            this.failure ??
              (status === "interrupted"
                ? signal
                  ? "Worker exited by signal"
                  : "Worker exited without a confirmed result"
                : null),
          );
        } catch {
          this.failure = "Worker outcome could not be persisted";
        }
        resolve({ code, signal });
      });
      this.child.once("error", () => {
        this.failure = "Worker process error";
        this.abortAll();
        try {
          this.jobRegistry.finish(
            this.jobId,
            "interrupted",
            null,
            this.failure,
          );
        } catch {
          this.failure = "Worker outcome could not be persisted";
        }
        resolve({ code: null, signal: null });
      });
    });
    this.child.on("message", (wire) => {
      const job = this.receive(wire).catch(() => {
        this.failure = "Worker protocol or ownership violation";
        void this.close();
      });
      this.jobs.add(job);
      void job.finally(() => this.jobs.delete(job));
    });
    try {
      this.send(this.startRequestId, {
        kind: "start",
        ...(agentOptions?.reflection
          ? { reflection: agentOptions.reflection }
          : {}),
        graphStepLimit: 64 + 16 * (this.owner.modelBudget?.maxCalls ?? 48),
        ...(agentOptions?.steering ? { steering: true } : {}),
        text: this.owner.text,
        ...(agentOptions?.mode ? { mode: agentOptions.mode } : {}),
        ...(agentOptions?.testFixtureTools ? { testFixtureTools: true } : {}),
        ...(agentOptions?.imageInputs ? { imageInputs: true } : {}),
        ...(agentOptions ? { graphPath: agentOptions.graphPath } : {}),
        ...(agentOptions?.sourceGraphThreadId
          ? { sourceGraphThreadId: agentOptions.sourceGraphThreadId }
          : {}),
        ...(agentOptions?.contextBatchId
          ? { contextBatchId: agentOptions.contextBatchId }
          : {}),
        ...(agentOptions?.maxInputTokens
          ? { maxInputTokens: agentOptions.maxInputTokens }
          : {}),
      });
    } catch (error) {
      void this.close();
      throw error;
    }
  }
  get error() {
    return this.failure;
  }
  get pendingCount() {
    return this.pending.size;
  }
  invoke(decision?: "approve" | "reject"): Promise<unknown> {
    if (!this.agentOptions) throw Error("Worker is not an Agent runtime");
    if (this.invocation)
      throw new RockyError(
        "worker_busy",
        "Agent invocation is already active",
        409,
      );
    const id = decision ? randomUUID() : this.startRequestId;
    const promise = new Promise<unknown>((resolve, reject) => {
      this.invocation = { id, resolve, reject };
    });
    if (decision) {
      try {
        this.send(id, { kind: "resume", decision });
      } catch (error) {
        this.invocation = undefined;
        return Promise.reject(error);
      }
    }
    return promise;
  }
  private owned() {
    const work = this.store.get(this.owner.id);
    if (
      this.stopped ||
      work.status !== "running" ||
      work.runId !== this.owner.runId ||
      work.executionSessionId !== this.owner.executionSessionId
    )
      throw Error("Worker capability revoked");
    return work;
  }
  private send(requestId: string, payload: Message["payload"]) {
    const wire = JSON.stringify({
      schemaVersion: 1,
      requestId,
      runId: this.owner.runId,
      executionSessionId: this.owner.executionSessionId,
      runCapability: this.capability,
      sequence: String(++this.sequence),
      payload,
    });
    parseIpcMessage(wire);
    if (!this.child.connected) throw Error("Worker disconnected");
    // Node's false return indicates its IPC write queue is saturated: close rather than grow it.
    if (
      !this.child.send(wire, (error) => {
        if (error) {
          this.failure = "Worker IPC send failed";
          void this.close();
        }
      })
    )
      throw Error("Worker IPC backpressure");
  }
  private async sendResult(requestId: string, payload: ResultPayload) {
    if (Buffer.byteLength(JSON.stringify(payload)) < 40000) {
      this.send(requestId, payload);
      return;
    }
    for (const frame of frameResult(payload)) {
      this.owned();
      const wire = JSON.stringify({
        schemaVersion: 1,
        requestId,
        runId: this.owner.runId,
        executionSessionId: this.owner.executionSessionId,
        runCapability: this.capability,
        sequence: String(++this.sequence),
        payload: frame,
      });
      parseIpcMessage(wire);
      await new Promise<void>((resolve, reject) => {
        if (!this.child.connected) {
          reject(Error("Worker disconnected"));
          return;
        }
        // At most one frame per in-flight RPC is queued; callback provides bounded backpressure.
        this.child.send(wire, (error) => (error ? reject(error) : resolve()));
      });
    }
  }
  private async receive(wire: unknown) {
    if (typeof wire !== "string")
      throw Error("IPC wire must be a bounded string");
    const message = parseIpcMessage(wire);
    if (
      message.runId !== this.owner.runId ||
      message.executionSessionId !== this.owner.executionSessionId ||
      !timingSafeEqual(
        Buffer.from(message.runCapability, "hex"),
        Buffer.from(this.capability, "hex"),
      ) ||
      BigInt(message.sequence) !== this.received + 1n ||
      this.seen.has(message.requestId) ||
      ![
        "tool_request",
        "model_request",
        "model_begin",
        "model_chunk",
        "model_commit",
        "context_read",
        "context_ack",
        "steer_read",
        "steer_ack",
        "runtime_event",
        "run_result",
        "result_begin",
        "result_chunk",
        "result_commit",
        "error",
      ].includes(message.payload.kind)
    )
      throw Error("Invalid worker request");
    this.received = BigInt(message.sequence);
    if (
      message.payload.kind === "result_begin" ||
      message.payload.kind === "result_chunk" ||
      message.payload.kind === "result_commit"
    ) {
      this.owned();
      if (
        this.invocation?.id !== message.requestId ||
        (message.payload.kind === "result_begin" &&
          message.payload.resultKind !== "run_result")
      )
        throw Error("Unexpected invocation result transfer");
      const result = this.resultTransfer.ingest(
        message.requestId,
        message.payload,
      );
      if (!result) return;
      if (result.kind !== "run_result")
        throw Error("Invalid invocation result kind");
      message.payload = result;
    }
    if (message.payload.kind === "run_result") {
      this.owned();
      if (this.resultTransfer.has(message.requestId))
        throw Error("Incomplete invocation result transfer");
    }
    if (message.payload.kind === "runtime_event") {
      this.owned();
      this.agentOptions?.event(
        this.owner,
        message.payload.name,
        message.payload.data,
      );
      return;
    }
    if (
      message.payload.kind === "run_result" ||
      message.payload.kind === "error"
    ) {
      const pending = this.invocation;
      if (!pending || pending.id !== message.requestId)
        throw Error("Unexpected Agent invocation response");
      this.invocation = undefined;
      if (message.payload.kind === "error") {
        this.resultTransfer.clear(message.requestId);
        pending.reject(new Error(message.payload.error.message));
      } else {
        const result = message.payload.result as {
          __interrupt__?: unknown[];
        } | null;
        this.completedInvocation =
          !Array.isArray(result?.__interrupt__) ||
          result.__interrupt__.length === 0;
        pending.resolve(message.payload.result);
      }
      return;
    }
    if (
      message.payload.kind !== "tool_request" &&
      message.payload.kind !== "model_request" &&
      message.payload.kind !== "model_begin" &&
      message.payload.kind !== "model_chunk" &&
      message.payload.kind !== "model_commit" &&
      message.payload.kind !== "context_read" &&
      message.payload.kind !== "context_ack" &&
      message.payload.kind !== "steer_read" &&
      message.payload.kind !== "steer_ack"
    )
      throw Error("Unexpected worker message");
    if (this.pending.size >= 8 || this.seen.size >= 10000)
      throw Error("Worker queue limit");
    const work = this.owned();
    this.seen.add(message.requestId);
    const abort = new AbortController();
    this.pending.set(message.requestId, abort);
    const timer = setTimeout(
      () => abort.abort(new Error("Worker request timeout")),
      30000,
    );
    timer.unref();
    let onAbort = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(abort.signal.reason);
      abort.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      let payload = message.payload;
      if (
        payload.kind === "model_begin" ||
        payload.kind === "model_chunk" ||
        payload.kind === "model_commit"
      ) {
        const request = this.modelTransfer.ingest(payload);
        if (!request) {
          this.send(message.requestId, {
            kind: "tool_result",
            result: { accepted: true },
          });
          return;
        }
        payload = request;
      }
      const result = await Promise.race([
        this.handler(work, payload, abort.signal),
        cancelled,
      ]);
      abort.signal.throwIfAborted();
      this.owned();
      await this.sendResult(
        message.requestId,
        payload.kind === "model_request"
          ? { kind: "model_result", message: result }
          : { kind: "tool_result", result },
      );
    } catch {
      if (
        message.payload.kind === "model_begin" ||
        message.payload.kind === "model_chunk" ||
        message.payload.kind === "model_commit"
      )
        this.modelTransfer.clear(message.payload.transferId);
      if (!this.stopped)
        this.send(message.requestId, {
          kind: "error",
          error: {
            code: "worker_request_failed",
            message: "Worker request failed or was cancelled",
          },
        });
    } finally {
      clearTimeout(timer);
      abort.signal.removeEventListener("abort", onAbort);
      this.pending.delete(message.requestId);
    }
  }
  private abortAll() {
    this.modelTransfer.clear();
    this.resultTransfer.clear();
    this.stopped = true;
    for (const controller of this.pending.values()) controller.abort();
    this.invocation?.reject(
      new Error("Worker process stopped before Agent result"),
    );
    this.invocation = undefined;
  }
  close(): Promise<void> {
    return (this.closing ??= this.shutdown());
  }
  private async shutdown() {
    if (!this.stopped && !this.completedInvocation && this.child.connected) {
      try {
        this.send(randomUUID(), { kind: "cancel", reason: "shutdown" });
      } catch {
        /* kill below */
      }
    }
    this.abortAll();
    const timer = setTimeout(() => {
      const pid = this.child.pid;
      if (
        !pid ||
        this.child.exitCode !== null ||
        this.child.signalCode !== null
      )
        return;
      if (process.platform === "win32") {
        const killer = spawn(
          "taskkill.exe",
          ["/PID", String(pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
        killer.on("error", () => this.child.kill());
      } else {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          this.child.kill("SIGKILL");
        }
      }
    }, 500);
    try {
      await this.exited;
      await Promise.allSettled([...this.jobs]);
    } finally {
      clearTimeout(timer);
    }
  }
}
