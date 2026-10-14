// Where each turn's change card goes in the transcript.
import type { Receipt } from './api.ts';

export interface Snapshot {
  receiptId: string;
  path: string;
}

/** Files each run changed (by Rocky, not by the user's restores), and its last tool call. */
export function runsWithChanges(receipts: Receipt[], snapshots: Snapshot[]) {
  return changes(receipts, snapshots).runs;
}

/**
 * The tool calls whose writes a change card shows. The transcript leaves out their own tool
 * cards: one change is shown once, in its turn's card.
 */
export function shownInChangeCards(
  receipts: Receipt[],
  snapshots: Snapshot[],
): Set<string> {
  return changes(receipts, snapshots).calls;
}

function changes(receipts: Receipt[], snapshots: Snapshot[]) {
  const paths = new Map<string, string[]>();
  for (const s of snapshots) {
    paths.set(s.receiptId, [...(paths.get(s.receiptId) ?? []), s.path]);
  }
  const runs = new Map<string, { files: Set<string>; lastToolCall: string }>();
  const calls = new Set<string>();
  for (const r of receipts) {
    if (r.actor === 'user' || r.outcome !== 'succeeded' || !r.runId) continue;
    const files = paths.get(r.id);
    if (!files || !r.toolCallId) continue;
    calls.add(r.toolCallId);
    const run = runs.get(r.runId) ?? {
      files: new Set<string>(),
      lastToolCall: r.toolCallId,
    };
    files.forEach((f) => run.files.add(f));
    run.lastToolCall = r.toolCallId;
    runs.set(r.runId, run);
  }
  return { runs, calls };
}

export interface Card {
  runId: string;
  count: number;
  /** The changed files (absolute paths), listed on the card before its diff is loaded. */
  files: string[];
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
    const card = { runId, count: run.files.size, files: [...run.files] };
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
