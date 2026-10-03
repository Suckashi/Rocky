import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { WorkService } from "../apps/daemon/src/work-service.js";
import type { Work } from "../packages/contracts/src/index.js";

const command = (w: Work) => ({
  requestId: randomUUID(),
  runId: w.runId,
  executionSessionId: w.executionSessionId,
  expectedRevision: w.revision,
});
async function waiting(service: WorkService, id: string) {
  for (let i = 0; i < 300; i++) {
    const work = service.store.get(id);
    if (work.status === "waiting_approval") return work;
    if (["failed", "blocked"].includes(work.status)) throw Error(work.error);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw Error("Approval timeout");
}

test("stale stop cannot cancel another run/session or a newer revision; receipt survives restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-stop-"));
  let service = new WorkService(root);
  try {
    const a = service.submit({
      requestId: randomUUID(),
      text: "First fixture",
      mode: "fixture",
      transport: "http",
    });
    const b = service.submit({
      requestId: randomUUID(),
      text: "Second fixture",
      mode: "fixture",
      transport: "http",
    });
    const current = await waiting(service, a.id);
    const other = await waiting(service, b.id);
    expect(() => service.stop(a.id, command(a))).toThrow("revision changed");
    expect(() =>
      service.stop(a.id, { ...command(current), runId: other.runId }),
    ).toThrow("revision changed");
    expect(() =>
      service.stop(a.id, {
        ...command(current),
        executionSessionId: other.executionSessionId,
      }),
    ).toThrow("revision changed");
    expect(() =>
      service.stop(a.id, { ...command(current), approved: true }),
    ).toThrow();
    const stop = command(current);
    const result = service.stop(a.id, stop);
    expect(result.status).toBe("cancelled");
    expect(result.approval?.status).toBe("expired");
    expect(service.store.get(b.id)).toEqual(other);
    const eventCount = service.store.eventsForWork(a.id).length;
    expect(service.stop(a.id, stop)).toEqual(result);
    expect(service.store.eventsForWork(a.id)).toHaveLength(eventCount);
    expect(() => service.stop(b.id, stop)).toThrow("Stop request changed");
    expect(() => service.stop(a.id, command(result))).toThrow(
      "no longer active",
    );
    await service.close();
    service = new WorkService(root);
    expect(service.stop(a.id, stop)).toEqual(result);
    expect(() =>
      service.stop(a.id, {
        ...stop,
        expectedRevision: stop.expectedRevision + 1,
      }),
    ).toThrow("Stop request changed");
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("stopping with a dispatched unknown effect requires reconciliation", async () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-stop-unknown-"));
  const service = new WorkService(root);
  try {
    const w = service.submit({
      requestId: randomUUID(),
      text: "Unknown outcome fixture",
      mode: "fixture",
      transport: "http",
    });
    const current = await waiting(service, w.id);
    // Synthetic persisted dispatch/result-loss boundary; never a real external effect.
    service.store.db
      .prepare("INSERT INTO operations VALUES(?,?,?,NULL)")
      .run(w.runId + ":lost-result", "synthetic", "unknown");
    const result = service.stop(w.id, command(current));
    expect(result.status).toBe("blocked");
    expect(result.error).toContain("reconciliation");
    expect(result.approval?.status).toBe("expired");
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});
