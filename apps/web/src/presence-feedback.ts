import {
  workSchema,
  type PublicEvent,
} from "../../../packages/contracts/src/index.js";
export type CompletionFeedback = {
  id: string;
  workId: string;
  receivedAt: number;
};
// Snapshot cursor is the initial watermark. Historical/catch-up/replayed events are silent.
export function projectCompletion(
  event: PublicEvent,
  watermark: string,
  now: number,
  completedRuns: ReadonlySet<string> = new Set(),
): { watermark: string; completion?: CompletionFeedback } {
  if (BigInt(event.sequence) <= BigInt(watermark)) return { watermark };
  const next = { watermark: event.sequence };
  if (
    event.payload.kind !== "domain" ||
    event.payload.name !== "rocky.work.updated"
  )
    return next;
  const work = workSchema.parse(event.payload.data.work);
  if (
    work.id !== event.workId ||
    work.runId !== event.runId ||
    work.runMode !== "normal" ||
    work.kind === "background" ||
    work.status !== "completed" ||
    completedRuns.has(work.runId) ||
    Math.abs(now - Date.parse(event.timestamp)) > 5000
  )
    return next;
  return {
    ...next,
    completion: { id: event.id, workId: work.id, receivedAt: now },
  };
}
