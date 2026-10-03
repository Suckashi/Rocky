import { test, expect } from "vitest";
import { randomUUID } from "node:crypto";
import type { Work, PublicEvent } from "../packages/contracts/src/index.js";
import {
  deriveRockyPresence,
  type PresenceInput,
} from "../apps/web/src/presence.js";
const now = Date.parse("2026-10-04T00:00:00Z");
function work(status: Work["status"], kind: Work["kind"] = "main"): Work {
  return {
    id: randomUUID(),
    runId: randomUUID(),
    executionSessionId: randomUUID(),
    requestId: randomUUID(),
    text: "fixture",
    transport: "http",
    mode: "fixture",
    runMode: "normal",
    status,
    kind,
    revision: 1,
    answer: "",
    createdAt: new Date(now).toISOString(),
  };
}
function event(w: Work, name: string, time = now): PublicEvent {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    sequence: "1",
    timestamp: new Date(time).toISOString(),
    workId: w.id,
    runId: w.runId,
    payload: { kind: "domain", name, data: {} },
  };
}
function input(works: Work[], events: PublicEvent[] = []): PresenceInput {
  return {
    works,
    events,
    connected: true,
    configured: true,
    animationsEnabled: true,
    reducedMotion: false,
    hidden: false,
  };
}
test("presence uses run progress, not heartbeat or connection, with deterministic sixty-second staleness", () => {
  const w = work("running"),
    i = input([w], [event(w, "rocky.model.started")]);
  expect(deriveRockyPresence(i, now).moving).toBe(true);
  expect(deriveRockyPresence(i, now + 60000).state).toBe("running");
  i.events.push(event(w, "rocky.worker.heartbeat", now + 61000));
  expect(deriveRockyPresence(i, now + 61000).state).toBe("stale");
  for (const flag of ["hidden", "reducedMotion"] as const)
    expect(deriveRockyPresence({ ...i, [flag]: true }, now).moving).toBe(false);
  expect(
    deriveRockyPresence({ ...i, animationsEnabled: false }, now).moving,
  ).toBe(false);
  expect(deriveRockyPresence({ ...i, connected: false }, now)).toMatchObject({
    state: "running",
    connected: false,
    moving: false,
  });
  expect(
    deriveRockyPresence(
      input([w], [{ ...event(w, "rocky.model.started"), runId: randomUUID() }]),
      now,
    ).state,
  ).toBe("stale");
});
test("foreground outcomes stay distinct from independent background counts and evaluation work", () => {
  const bg = [
    work("running", "background"),
    work("queued", "background"),
    work("waiting_approval", "background"),
    work("failed", "background"),
  ];
  const i = input(bg);
  expect(deriveRockyPresence(i, now)).toMatchObject({
    state: "idle",
    counts: { running: 1, queued: 1, approval: 1, attention: 1 },
    moving: false,
  });
  for (const status of [
    "failed",
    "cancelled",
    "interrupted",
    "blocked",
    "completed",
    "queued",
  ] as const)
    expect(
      deriveRockyPresence(input([work(status), ...bg]), now),
    ).toMatchObject({ state: status, moving: false });
  expect(
    deriveRockyPresence(input([work("waiting_approval")]), now).state,
  ).toBe("awaiting_approval");
  expect(
    deriveRockyPresence(
      {
        ...input([{ ...work("running"), runMode: "evaluation" }]),
        configured: false,
      },
      now,
    ).state,
  ).toBe("setup_required");
});
