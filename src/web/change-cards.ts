// Where each turn's change card goes in the transcript.
import type { Receipt } from './api.ts';

export interface Snapshot {
  receiptId: string;
  path: string;
}

/** Files each run changed (by Rocky, not by the user's restores), and its last tool call. */
export function runsWithChanges(receipts: Receipt[], snapshots: Snapshot[]) {
  const paths = new Map<string, string[]>();
  for (const s of snapshots) {
    paths.set(s.receiptId, [...(paths.get(s.receiptId) ?? []), s.path]);
  }
  const runs = new Map<string, { files: Set<string>; lastToolCall: string }>();
  for (const r of receipts) {
    if (r.actor === 'user' || r.outcome !== 'succeeded' || !r.runId) continue;
    const files = paths.get(r.id);
    if (!files || !r.toolCallId) continue;
    const run = runs.get(r.runId) ?? {
      files: new Set<string>(),
      lastToolCall: r.toolCallId,
    };
    files.forEach((f) => run.files.add(f));
    run.lastToolCall = r.toolCallId;
    runs.set(r.runId, run);
  }
  return runs;
}

export interface Card {
  runId: string;
  count: number;
}

/**
 * Each run's card goes at the end of the turn that holds its last tool call. A run cut off
 * before its transcript was saved (a crash, a reboot) has changes but no message to attach
 * them to: its card is returned apart, to show at the end, so the changes stay restorable.
 */
export function placeChangeCards(
  messages: { role: string; toolCalls?: { id: string }[] }[],
  runs: Map<string, { files: Set<string>; lastToolCall: string }>,
): { at: Map<number, Card[]>; unanchored: Card[] } {
  const at = new Map<number, Card[]>();
  const unanchored: Card[] = [];
  for (const [runId, run] of runs) {
    const card = { runId, count: run.files.size };
    const anchor = messages.findIndex(
      (m) =>
        m.role === 'assistant' &&
        (m.toolCalls ?? []).some((c) => c.id === run.lastToolCall),
    );
    if (anchor < 0) {
      unanchored.push(card);
      continue;
    }
    const nextUser = messages.findIndex(
      (m, i) => i > anchor && m.role === 'user',
    );
    const index = (nextUser < 0 ? messages.length : nextUser) - 1;
    at.set(index, [...(at.get(index) ?? []), card]);
  }
  return { at, unanchored };
}
