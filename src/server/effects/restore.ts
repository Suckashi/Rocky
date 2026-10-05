// "Restore all" for one turn: put every file the run changed back the way it was before the
// run, from snapshots. Each restore is a normal write through the gate and the executor.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { Executor } from './execute.ts';
import type { Gate } from './gate.ts';
import { contentHash } from './hash.ts';
import type { ReceiptStore } from './receipts.ts';
import type { SnapshotStore } from './snapshots.ts';
import type { Effect } from './types.ts';

type WriteEffect = Extract<Effect, { kind: 'write' }>;

export interface RestoreItem {
  path: string;
  effect: WriteEffect;
  contentHash: string;
  /** The file was changed again after this run (by the user or a later run). */
  modifiedSince: boolean;
}

export interface FileChange {
  path: string;
  beforeSha: string | null;
  afterSha: string | null;
}

/** Net change per file in one run: the first "before" and the last "after". */
export function runChanges(
  receipts: ReceiptStore,
  snapshots: SnapshotStore,
  threadId: string,
  runId: string,
): FileChange[] {
  const list = receipts
    .forThread(threadId)
    // Restores are the user's own writes in the same run; they are not part of the run's changes.
    .filter(
      (r) =>
        r.runId === runId && r.outcome === 'succeeded' && r.actor !== 'user',
    )
    .sort((a, b) => a.createdAt - b.createdAt);
  const order = new Map(list.map((r, i) => [r.id, i]));
  const snaps = snapshots
    .forReceipts(list.map((r) => r.id))
    .sort((a, b) => order.get(a.receiptId)! - order.get(b.receiptId)!);
  const byPath = new Map<string, FileChange>();
  for (const s of snaps) {
    const seen = byPath.get(s.path);
    if (seen) seen.afterSha = s.afterSha;
    else byPath.set(s.path, { ...s });
  }
  return [...byPath.values()].filter((c) => c.beforeSha !== c.afterSha);
}

function shaOf(path: string): string | null {
  return existsSync(path)
    ? createHash('sha256').update(readFileSync(path)).digest('hex')
    : null;
}

export function planRestore(
  receipts: ReceiptStore,
  snapshots: SnapshotStore,
  threadId: string,
  runId: string,
): RestoreItem[] {
  return runChanges(receipts, snapshots, threadId, runId).map((change) => {
    const effect: WriteEffect =
      change.beforeSha === null
        ? { kind: 'write', path: change.path, operation: 'delete' }
        : {
            kind: 'write',
            path: change.path,
            operation: existsSync(change.path) ? 'edit' : 'create',
            content: snapshots.read(change.beforeSha).toString('utf8'),
          };
    return {
      path: change.path,
      effect,
      contentHash: contentHash(effect),
      modifiedSince: shaOf(change.path) !== change.afterSha,
    };
  });
}

export type RestoreResult =
  | { ok: true; restored: string[] }
  | { ok: false; error: 'content-changed' | 'denied'; path?: string };

/** Restores exactly the plan the user saw (by content hash); anything else is refused. */
export function restoreRun(
  deps: {
    gate: Gate;
    executor: Executor;
    receipts: ReceiptStore;
    snapshots: SnapshotStore;
  },
  threadId: string,
  runId: string,
  seen: { path: string; contentHash: string }[],
): RestoreResult {
  const plan = planRestore(deps.receipts, deps.snapshots, threadId, runId);
  const sameShape =
    plan.length === seen.length &&
    plan.every((item, i) => item.path === seen[i]?.path);
  if (!sameShape) return { ok: false, error: 'content-changed' };
  const restored: string[] = [];
  for (const [i, item] of plan.entries()) {
    const result = deps.gate.userAction(
      item.effect,
      { threadId, runId, actor: 'user' },
      seen[i]!.contentHash,
    );
    if (!result.allowed) {
      return {
        ok: false,
        error:
          result.message === 'content-changed' ? 'content-changed' : 'denied',
        path: item.path,
      };
    }
    deps.executor.write(result.pass, item.effect);
    restored.push(item.path);
  }
  return { ok: true, restored };
}
