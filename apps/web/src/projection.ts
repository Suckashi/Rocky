import {
  workSchema,
  type Work,
  type PublicEvent,
} from "../../../packages/contracts/src/index.js";

export function projectWork(works: Work[], event: PublicEvent): Work[] {
  if (
    event.payload.kind !== "domain" ||
    event.payload.name !== "rocky.work.updated"
  )
    return works;
  const work = workSchema.parse(event.payload.data.work);
  const found = works.find((w) => w.id === work.id);
  if (found && found.revision >= work.revision) return works;
  return found
    ? works.map((w) => (w.id === work.id ? work : w))
    : [...works, work];
}

export function projectEvidence(
  events: PublicEvent[],
  event: PublicEvent,
): PublicEvent[] {
  if (events.some((e) => e.id === event.id)) return events;
  return [...events, event]
    .sort((a, b) =>
      BigInt(a.sequence) < BigInt(b.sequence)
        ? -1
        : BigInt(a.sequence) > BigInt(b.sequence)
          ? 1
          : 0,
    )
    .slice(-500);
}
