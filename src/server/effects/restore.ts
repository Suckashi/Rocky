// Restore for one turn: put the files the run changed back the way they were before the run
// (all of them, or the ones the user picked), or undo that by writing the run's result back.
// From snapshots; each restore is a normal write through the gate and the executor.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { Executor } from './execute.ts';
import type { Gate } from './gate.ts';
import { contentHash } from './hash.ts';
import type { ReceiptStore } from './receipts.ts';
import { asContent, SnapshotDamaged, type SnapshotStore } from './snapshots.ts';
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
    // Restores are recorded under "restore:<run>", so they never count as the run's changes.
    .filter((r) => r.runId === runId && r.outcome === 'succeeded')
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

/** "before": back to how the files were before the run (restore). "after": back to how the
 *  run left them (undo a restore). */
export type RestoreTarget = 'before' | 'after';

export function planRestore(
  receipts: ReceiptStore,
  snapshots: SnapshotStore,
  threadId: string,
  runId: string,
  target: RestoreTarget = 'before',
): RestoreItem[] {
  // A file whose saved version is damaged cannot be restored; the others still can.
  return runChanges(receipts, snapshots, threadId, runId).flatMap((change) => {
    const wanted = target === 'before' ? change.beforeSha : change.afterSha;
    const other = target === 'before' ? change.afterSha : change.beforeSha;
    let before: Buffer | null;
    try {
      before = wanted === null ? null : snapshots.read(wanted);
    } catch (error) {
      if (error instanceof SnapshotDamaged) return [];
      throw error;
    }
    const effect: WriteEffect =
      before === null
        ? { kind: 'write', path: change.path, operation: 'delete' }
        : {
            kind: 'write',
            path: change.path,
            operation: existsSync(change.path) ? 'edit' : 'create',
            ...asContent(before),
          };
    return [
      {
        path: change.path,
        effect,
        contentHash: contentHash(effect),
        modifiedSince: shaOf(change.path) !== other,
      },
    ];
  });
}

export type RestoreResult =
  | {
      ok: true;
      restored: string[];
      /** What undoes this restore: the same files, written back the other way. */
      undo: { path: string; contentHash: string }[];
    }
  | { ok: false; error: 'content-changed' | 'denied'; path?: string };

/** Restores exactly what the user saw (by content hash); anything else is refused. The whole
 *  plan must match, unless the user picked some files ("partial"): then each picked file must
 *  be in the plan. */
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
  options: {
    partial?: boolean | undefined;
    target?: RestoreTarget | undefined;
  } = {},
): RestoreResult {
  const target = options.target ?? 'before';
  const full = planRestore(
    deps.receipts,
    deps.snapshots,
    threadId,
    runId,
    target,
  );
  let plan: RestoreItem[];
  if (options.partial) {
    const byPath = new Map(full.map((item) => [item.path, item]));
    const picked = seen.map((s) => byPath.get(s.path));
    if (seen.length === 0 || picked.some((item) => item === undefined))
      return { ok: false, error: 'content-changed' };
    plan = picked as RestoreItem[];
  } else {
    const sameShape =
      full.length === seen.length &&
      full.every((item, i) => item.path === seen[i]?.path);
    if (!sameShape) return { ok: false, error: 'content-changed' };
    plan = full;
  }
  const restored: string[] = [];
  for (const [i, item] of plan.entries()) {
    const result = deps.gate.userAction(
      item.effect,
      { threadId, runId: `restore:${runId}`, actor: 'user' },
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
  // Planned now, after the writes: whether undoing creates or edits a file depends on them.
  const back = new Map(
    planRestore(
      deps.receipts,
      deps.snapshots,
      threadId,
      runId,
      target === 'before' ? 'after' : 'before',
    ).map((item) => [item.path, item.contentHash]),
  );
  const undo = restored.flatMap((path) => {
    const contentHash = back.get(path);
    return contentHash ? [{ path, contentHash }] : [];
  });
  return { ok: true, restored, undo };
}
