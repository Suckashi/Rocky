// The only code that writes project files or runs commands for Rocky. Each call needs a
// pass the gate issued for exactly this content, snapshots files before and after, and
// finishes the receipt with succeeded, failed or unknown.
import { spawn as crossSpawn } from 'cross-spawn';
import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { contentHash } from './hash.ts';
import type { Pass, PassBook } from './passes.ts';
import type { ReceiptStore } from './receipts.ts';
import type { SnapshotStore } from './snapshots.ts';
import type { Effect } from './types.ts';

type WriteEffect = Extract<Effect, { kind: 'write' }>;
type CommandEffect = Extract<Effect, { kind: 'command' }>;

export interface CommandResult {
  exitCode: number | null;
  output: string;
  truncated: boolean;
  timedOut: boolean;
  stopped: boolean;
}

const OUTPUT_LIMIT = 64 * 1024;

/** Environment for commands: Rocky's own secrets are never there to begin with; drop proxies of Rocky's tooling too. */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^ROCKY_/i.test(key)) delete env[key];
  }
  return env;
}

/** Ends a process and everything it started: taskkill /T on Windows, the process group elsewhere. */
export function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

export class Executor {
  private readonly passes: PassBook;
  private readonly receipts: ReceiptStore;
  private readonly snapshots: SnapshotStore;

  constructor(deps: {
    passes: PassBook;
    receipts: ReceiptStore;
    snapshots: SnapshotStore;
  }) {
    this.passes = deps.passes;
    this.receipts = deps.receipts;
    this.snapshots = deps.snapshots;
  }

  private redeem(pass: Pass, effect: Effect): void {
    try {
      this.passes.redeem(pass, contentHash(effect));
    } catch (error) {
      if (pass.receiptId)
        this.receipts.cancel(pass.receiptId, (error as Error).message);
      throw error;
    }
  }

  /** Writes, edits (new full content) or deletes one file. */
  write(pass: Pass, effect: WriteEffect): void {
    this.redeem(pass, effect);
    const path = effect.path;
    try {
      const before = existsSync(path)
        ? this.snapshots.put(readFileSync(path))
        : null;
      if (effect.operation === 'delete') {
        rmSync(path, { force: true });
        this.snapshots.record({
          receiptId: pass.receiptId,
          path,
          beforeSha: before,
          afterSha: null,
        });
      } else {
        mkdirSync(dirname(path), { recursive: true });
        const content = Buffer.from(effect.content ?? '', 'utf8');
        writeFileSync(path, content);
        const after = this.snapshots.put(content);
        this.snapshots.record({
          receiptId: pass.receiptId,
          path,
          beforeSha: before,
          afterSha: after,
        });
      }
      this.receipts.finish(pass.receiptId, 'succeeded');
    } catch (error) {
      // A failed write may have left a partial file: the outcome is not known.
      this.receipts.finish(
        pass.receiptId,
        'unknown',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /** Runs argv in cwd without a shell; .cmd shims on Windows are handled by cross-spawn. */
  run(
    pass: Pass,
    effect: CommandEffect,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<CommandResult> {
    this.redeem(pass, effect);
    const [file, ...args] = effect.argv;
    return new Promise((resolve) => {
      let output = '';
      let truncated = false;
      let timedOut = false;
      let stopped = false;
      let child: ChildProcess;
      try {
        child = crossSpawn(file!, args, {
          cwd: effect.cwd,
          env: childEnv(),
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          detached: process.platform !== 'win32',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.receipts.finish(pass.receiptId, 'failed', message);
        resolve({
          exitCode: null,
          output: message,
          truncated: false,
          timedOut: false,
          stopped: false,
        });
        return;
      }
      const take = (chunk: Buffer) => {
        output += chunk.toString('utf8');
        if (output.length > OUTPUT_LIMIT) {
          output = output.slice(-OUTPUT_LIMIT);
          truncated = true;
        }
      };
      child.stdout?.on('data', take);
      child.stderr?.on('data', take);
      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child);
      }, options.timeoutMs ?? 120_000);
      const onAbort = () => {
        stopped = true;
        killTree(child);
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      let settled = false;
      const done = (exitCode: number | null, spawnError?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        if (spawnError !== undefined) {
          this.receipts.finish(pass.receiptId, 'failed', spawnError);
          output = spawnError;
        } else if (timedOut || stopped) {
          // Killed part-way: whatever it changed is not known.
          this.receipts.finish(
            pass.receiptId,
            'unknown',
            timedOut ? 'timed out' : 'stopped',
          );
        } else {
          this.receipts.finish(
            pass.receiptId,
            exitCode === 0 ? 'succeeded' : 'failed',
            `exit ${exitCode}`,
          );
        }
        resolve({ exitCode, output, truncated, timedOut, stopped });
      };
      child.on('error', (error) => done(null, error.message));
      child.on('close', (code) => done(code));
    });
  }
}
