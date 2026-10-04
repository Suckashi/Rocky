import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { terminateProcessTree } from "./terminate-process-tree.js";

export const nativeCommandSchema = z.strictObject({
  executable: z.string().min(1).refine(isAbsolute),
  cwd: z.string().min(1).refine(isAbsolute),
  args: z.array(z.string().max(65536)).max(256),
  timeoutMs: z.number().int().min(1).max(300000),
  maxOutputBytes: z.number().int().min(1).max(1048576),
});
export type NativeCommand = z.infer<typeof nativeCommandSchema>;
export function nativeExecutionEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP"])
    if (process.env[name]) env[name] = process.env[name];
  return env;
}
export type NativeCommandResult = {
  reason:
    | "exited"
    | "spawn_failed"
    | "cancelled"
    | "timed_out"
    | "output_limit"
    | "termination_unconfirmed";
  launched: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
};

/** Internal effect adapter, NOT an authorization boundary or OS sandbox.
 * Only the daemon's exact-approved operation dispatcher may call this in production.
 * No public route/native model tool is wired until that ledger integration exists.
 * Exit code describes this process, never proof that an external effect succeeded.
 */
export class NativeEnvironment {
  readonly capabilities = Object.freeze({
    mode: "native",
    isolation: "none",
    networkEnforcement: "application_only",
  } as const);

  async execute(
    input: NativeCommand,
    signal: AbortSignal,
  ): Promise<NativeCommandResult> {
    signal.throwIfAborted();
    const command = nativeCommandSchema.parse(input);
    // Do not resolve a PATH command or silently switch environment/cwd.
    const [executable, cwd] = await Promise.all([
      realpath(command.executable),
      realpath(command.cwd),
    ]);
    if (!(await stat(executable)).isFile() || !(await stat(cwd)).isDirectory())
      throw new Error(
        "Native command executable or working directory is invalid",
      );
    signal.throwIfAborted();
    // Explicit OS plumbing only; no provider keys, NODE_OPTIONS, daemon credentials,
    // user configuration/home or arbitrary environment overrides are inherited.
    const env = nativeExecutionEnvironment();
    return new Promise((resolve) => {
      const child = spawn(executable, command.args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [],
        stderr: Buffer[] = [];
      let bytes = 0,
        truncated = false,
        launched = false,
        settled = false;
      let reason: NativeCommandResult["reason"] = "exited";
      let termination: Promise<void> | undefined;
      let terminationDeadline: ReturnType<typeof setTimeout> | undefined;
      const finish = (
        exitCode: number | null,
        exitSignal: NodeJS.Signals | null,
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(terminationDeadline);
        signal.removeEventListener("abort", abort);
        child.stdout.destroy();
        child.stderr.destroy();
        resolve({
          reason,
          launched,
          exitCode,
          signal: exitSignal,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
          outputTruncated: truncated,
        });
      };
      const stop = (why: NativeCommandResult["reason"]) => {
        if (termination || settled) return;
        reason = why;
        terminationDeadline = setTimeout(() => {
          reason = "termination_unconfirmed";
          finish(child.exitCode, child.signalCode);
        }, 6000);
        termination = terminateProcessTree(child).catch(() => {
          reason = "termination_unconfirmed";
          // A failed tree kill must not be reported as a confirmed cancellation.
        });
      };
      const abort = () => stop("cancelled");
      const timer = setTimeout(() => stop("timed_out"), command.timeoutMs);
      signal.addEventListener("abort", abort, { once: true });
      const collect = (target: Buffer[], chunk: Buffer) => {
        if (settled) return;
        const available = command.maxOutputBytes - bytes;
        if (available > 0) target.push(chunk.subarray(0, available));
        bytes += Math.min(available, chunk.length);
        if (chunk.length > available) {
          truncated = true;
          stop("output_limit");
        }
      };
      child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
      child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
      child.once("spawn", () => {
        launched = true;
      });
      child.once("error", () => {
        reason = launched ? "termination_unconfirmed" : "spawn_failed";
        finish(launched ? child.exitCode : null, child.signalCode);
      });
      child.once("close", (code, exitSignal) => {
        void (termination ?? Promise.resolve()).then(() =>
          finish(code, exitSignal),
        );
      });
      if (signal.aborted) abort();
    });
  }
}
