import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { PassThrough } from "node:stream";
import {
  ReadBuffer,
  serializeMessage,
} from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { terminateProcessTree } from "./terminate-process-tree.js";

/** SDK framing with a daemon-owned child handle and process-group shutdown.
 * Native process management, not an OS sandbox. Escaped/detached descendants are not contained.
 */
export class OwnedStdioTransport implements Transport {
  private child?: ChildProcessWithoutNullStreams;
  private readonly buffer: ReadBuffer;
  private closing?: Promise<void>;
  private notified = false;
  terminationError: Error | null = null;
  readonly stderr = new PassThrough();
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  constructor(
    private readonly config: {
      command: string;
      args: string[];
      cwd: string;
      env: Record<string, string>;
      maxBufferSize: number;
    },
  ) {
    this.buffer = new ReadBuffer({ maxBufferSize: config.maxBufferSize });
  }
  get pid() {
    return this.child?.pid ?? null;
  }
  private closed() {
    if (this.notified) return;
    this.notified = true;
    this.buffer.clear();
    this.stderr.end();
    this.onclose?.();
  }
  async start() {
    if (this.child || this.closing || this.notified)
      throw Error("MCP transport already started or closed");
    if (/\.(cmd|bat)$/i.test(this.config.command))
      throw Error(
        "MCP requires a direct executable; invoke a Node script with node instead of a shell wrapper",
      );
    const child = spawn(this.config.command, this.config.args, {
      cwd: this.config.cwd,
      env: this.config.env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: "pipe",
    });
    this.child = child;
    child.stderr.pipe(this.stderr);
    child.stdout.on("data", (chunk: Buffer) => {
      try {
        this.buffer.append(chunk);
        for (;;) {
          const message = this.buffer.readMessage();
          if (!message) break;
          this.onmessage?.(message);
        }
      } catch {
        this.onerror?.(Error("Invalid or oversized MCP stdio message"));
        void this.close().catch(() =>
          this.onerror?.(Error("MCP process termination unconfirmed")),
        );
      }
    });
    child.once("close", () => this.closed());
    child.on("error", () =>
      this.onerror?.(Error("MCP process could not be started or accessed")),
    );
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", () => reject(Error("MCP process startup failed")));
    });
  }
  async send(message: JSONRPCMessage) {
    const child = this.child;
    if (!child || this.closing || this.notified || !child.stdin.writable)
      throw Error("MCP transport is not writable");
    const encoded = serializeMessage(message);
    if (Buffer.byteLength(encoded) > this.config.maxBufferSize)
      throw Error("MCP request exceeds transport limit");
    await new Promise<void>((resolve, reject) =>
      child.stdin.write(encoded, (error) =>
        error ? reject(error) : resolve(),
      ),
    );
  }
  close(): Promise<void> {
    this.closing ??= (async () => {
      const child = this.child;
      try {
        if (child) {
          await terminateProcessTree(child);
          if (child.exitCode === null && child.signalCode === null)
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(
                () => reject(Error("MCP process exit unconfirmed")),
                5000,
              );
              timer.unref();
              child.once("close", () => {
                clearTimeout(timer);
                resolve();
              });
            });
        }
      } catch (error) {
        this.terminationError =
          error instanceof Error ? error : Error("MCP termination unconfirmed");
        this.onerror?.(this.terminationError);
      } finally {
        child?.stdin.destroy();
        child?.stdout.destroy();
        child?.stderr.destroy();
        this.closed();
      }
    })();
    return this.closing;
  }
}
