// Receipts: an intent row before every action, the outcome after. Outcomes are only
// succeeded, failed or unknown (not-run when Rocky refused or the user rejected).
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Actor, Effect, Reason } from './types.ts';

export type { Outcome, ReceiptDecision } from '../../shared/types.ts';
import type { Outcome, ReceiptDecision } from '../../shared/types.ts';

export interface Receipt {
  id: string;
  threadId: string | null;
  runId: string | null;
  toolCallId: string | null;
  actor: Actor;
  effect: Effect;
  contentHash: string;
  decision: ReceiptDecision;
  reason: Reason;
  outcome: Outcome;
  detail: string | null;
  createdAt: number;
  finishedAt: number | null;
}

interface Row {
  id: string;
  thread_id: string | null;
  run_id: string | null;
  tool_call_id: string | null;
  actor: Actor;
  effect: string;
  content_hash: string;
  decision: ReceiptDecision;
  reason: Reason;
  outcome: Outcome;
  detail: string | null;
  created_at: number;
  finished_at: number | null;
}

const toReceipt = (row: Row): Receipt => ({
  id: row.id,
  threadId: row.thread_id,
  runId: row.run_id,
  toolCallId: row.tool_call_id,
  actor: row.actor,
  effect: JSON.parse(row.effect) as Effect,
  contentHash: row.content_hash,
  decision: row.decision,
  reason: row.reason,
  outcome: row.outcome,
  detail: row.detail,
  createdAt: row.created_at,
  finishedAt: row.finished_at,
});

export interface Origin {
  threadId?: string;
  runId?: string;
  toolCallId?: string;
  actor: Actor;
}

export class ReceiptStore {
  private readonly db: DatabaseSync;
  private readonly now: () => number;

  constructor(db: DatabaseSync, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
  }

  /** Recorded before acting. Refusals are recorded as not-run straight away. */
  intent(
    origin: Origin,
    effect: Effect,
    verdict: { contentHash: string; reason: Reason },
    decision: ReceiptDecision,
    detail?: string,
  ): Receipt {
    const id = randomUUID();
    const outcome: Outcome =
      decision === 'rejected' || decision === 'denied' ? 'not-run' : 'pending';
    const at = this.now();
    this.db
      .prepare(
        `insert into receipts (id, thread_id, run_id, tool_call_id, actor, kind, effect, content_hash,
           decision, reason, outcome, detail, created_at, finished_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        origin.threadId ?? null,
        origin.runId ?? null,
        origin.toolCallId ?? null,
        origin.actor,
        effect.kind,
        JSON.stringify(effect),
        verdict.contentHash,
        decision,
        verdict.reason,
        outcome,
        detail ?? null,
        at,
        outcome === 'not-run' ? at : null,
      );
    return this.get(id)!;
  }

  finish(
    id: string,
    outcome: 'succeeded' | 'failed' | 'unknown',
    detail?: string,
  ): void {
    const changed = this.db
      .prepare(
        "update receipts set outcome = ?, detail = coalesce(?, detail), finished_at = ? where id = ? and outcome = 'pending'",
      )
      .run(outcome, detail ?? null, this.now(), id).changes;
    if (changed === 0) throw new Error(`receipt ${id} is not pending`);
  }

  /** Nothing was done after all (for example the pass did not match the content). */
  cancel(id: string, detail: string): void {
    this.db
      .prepare(
        "update receipts set outcome = 'not-run', detail = ?, finished_at = ? where id = ? and outcome = 'pending'",
      )
      .run(detail, this.now(), id);
  }

  /** The user looked and confirms an unknown outcome succeeded. Never re-runs anything. */
  confirm(id: string): boolean {
    return (
      this.db
        .prepare(
          "update receipts set outcome = 'succeeded', detail = 'confirmed by user' where id = ? and outcome = 'unknown'",
        )
        .run(id).changes > 0
    );
  }

  get(id: string): Receipt | undefined {
    const row = this.db
      .prepare('select * from receipts where id = ?')
      .get(id) as Row | undefined;
    return row ? toReceipt(row) : undefined;
  }

  forThread(threadId: string): Receipt[] {
    return (
      this.db
        .prepare(
          'select * from receipts where thread_id = ? order by created_at, rowid',
        )
        .all(threadId) as unknown as Row[]
    ).map(toReceipt);
  }

  /** At startup: anything still pending was interrupted, so its outcome is unknown. */
  markInterrupted(): number {
    return Number(
      this.db
        .prepare(
          "update receipts set outcome = 'unknown', detail = 'Rocky stopped before the result was known', finished_at = ? where outcome = 'pending'",
        )
        .run(this.now()).changes,
    );
  }
}
