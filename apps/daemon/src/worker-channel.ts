import { fork, spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { parseIpcMessage } from "../../../packages/contracts/src/ipc.js";
import {
  RockyError,
  type Work,
} from "../../../packages/contracts/src/index.js";
import { Store } from "./store.js";
type Message = ReturnType<typeof parseIpcMessage>;
type Handler = (
  work: Work,
  payload: Extract<Message["payload"], { kind: "tool_request" }>,
  signal: AbortSignal,
) => Promise<unknown>;

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
  private readonly jobs = new Set<Promise<void>>();
  private stopped = false;
  private failure: string | null = null;
  private closing?: Promise<void>;
  private readonly owner: Work;
  constructor(
    private readonly store: Store,
    workId: string,
    entry: string,
    private readonly handler: Handler,
  ) {
    this.owner = store.get(workId);
    if (this.owner.status !== "running")
      throw new RockyError(
        "worker_owner",
        "Worker needs a running owned Work",
        409,
      );
    this.child = fork(entry, [], {
      execPath: process.execPath,
      execArgv: entry.endsWith(".ts") ? ["--import", "tsx"] : [],
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
    this.exited = new Promise((resolve) => {
      this.child.once("exit", (code, signal) => {
        this.abortAll();
        resolve({ code, signal });
      });
      this.child.once("error", () => {
        this.failure = "Worker process error";
        this.abortAll();
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
      this.send(randomUUID(), { kind: "start", text: this.owner.text });
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
      message.payload.kind !== "tool_request"
    )
      throw Error("Invalid worker request");
    this.received = BigInt(message.sequence);
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
      const result = await Promise.race([
        this.handler(work, message.payload, abort.signal),
        cancelled,
      ]);
      abort.signal.throwIfAborted();
      this.owned();
      this.send(message.requestId, { kind: "tool_result", result });
    } catch {
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
    this.stopped = true;
    for (const controller of this.pending.values()) controller.abort();
  }
  close(): Promise<void> {
    return (this.closing ??= this.shutdown());
  }
  private async shutdown() {
    if (!this.stopped && this.child.connected) {
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
