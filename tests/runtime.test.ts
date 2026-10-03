import "../packages/agent-runtime/src/environment.js";
import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { WorkService } from "../apps/daemon/src/work-service.js";
async function waitFor(service: WorkService, id: string, status: string) {
  for (let i = 0; i < 300; i++) {
    const w = service.store.get(id);
    if (w.status === status) return w;
    if (w.status === "failed") throw Error(w.error);
    await new Promise((r) => setTimeout(r, 30));
  }
  throw Error("Timeout: " + JSON.stringify(service.store.get(id)));
}
for (const transport of ["stdio", "http"] as const) {
  test(
    "T-003 native task + interrupt + approval + MCP " + transport,
    async () => {
      const root = mkdtempSync(join(tmpdir(), "rocky-runtime-")),
        service = new WorkService(root);
      try {
        const work = service.submit({
          requestId: randomUUID(),
          text: "Inspect then write synthetic data",
          transport,
          mode: "fixture",
        });
        const waiting = await waitFor(service, work.id, "waiting_approval");
        expect(
          service.store.db.prepare("SELECT * FROM operations").all(),
        ).toHaveLength(1);
        expect(
          service.store
            .events()
            .some((e) => e.name === "rocky.subagent.completed"),
        ).toBe(true);
        expect(() =>
          service.decide(work.id, {
            requestId: randomUUID(),
            expectedRevision: 1,
            intentFingerprint: "forged",
            decision: "approve",
          }),
        ).toThrow("fingerprint");
        const decision = {
          requestId: randomUUID(),
          expectedRevision: 1,
          intentFingerprint: waiting.approval!.intentFingerprint,
          decision: "approve",
        };
        service.decide(work.id, decision);
        const completed = await waitFor(service, work.id, "completed");
        expect(completed.answer).toContain("核准後寫入");
        expect(
          service.store.db
            .prepare("SELECT * FROM operations WHERE outcome='succeeded'")
            .all(),
        ).toHaveLength(2);
        service.decide(work.id, decision);
        expect(
          service.store.db.prepare("SELECT * FROM operations").all(),
        ).toHaveLength(2);
      } finally {
        await service.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
}
test("T-003 rejected interrupt has valid tool result and no write", async () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-reject-")),
    service = new WorkService(root);
  try {
    const work = service.submit({
      requestId: randomUUID(),
      text: "Inspect",
      mode: "fixture",
    });
    const w = await waitFor(service, work.id, "waiting_approval");
    service.decide(work.id, {
      requestId: randomUUID(),
      expectedRevision: 1,
      intentFingerprint: w.approval!.intentFingerprint,
      decision: "reject",
    });
    expect((await waitFor(service, work.id, "completed")).answer).toContain(
      "拒絕",
    );
    expect(
      service.store.db.prepare("SELECT * FROM operations").all(),
    ).toHaveLength(1);
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});
