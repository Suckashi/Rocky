import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { startAgentProvider } from "../fixtures/models/agent-provider.js";

for (const provider of ["openai-compatible", "anthropic"] as const) {
  test(`truncated ${provider} SSE never completes Work or dispatches tool effects`, async () => {
    const prefix = join(tmpdir(), "rocky-stream-truncated-");
    const root = mkdtempSync(prefix),
      fixture = await startAgentProvider({ truncateStream: true }),
      service = new WorkService(root);
    try {
      const connectionId = randomUUID();
      service.models.save({
        id: connectionId,
        requestId: randomUUID(),
        expectedRevision: 0,
        config: {
          name: "Truncated local fixture",
          provider,
          baseUrl: fixture.baseUrl,
          modelId: "scripted",
          contextWindowTokens: 4096,
          maxOutputTokens: 128,
        },
      });
      const work = service.submit({
        requestId: randomUUID(),
        text: "Must not infer success at stream EOF",
        mode: "configured",
        transport: "http",
        modelSelection: { connectionId, revision: 1 },
      });
      await expect
        .poll(() => service.store.get(work.id).status, { timeout: 10000 })
        .toBe("failed");
      expect(service.store.get(work.id).answer).toBe("");
      expect(service.operations.list(work.id)).toHaveLength(0);
      const events = service.store
        .events("0")
        .filter(
          (e) =>
            e.workId === work.id &&
            e.payload.kind === "domain" &&
            e.payload.name === "rocky.model.stream",
        );
      expect(
        events.some(
          (e) =>
            e.payload.kind === "domain" && e.payload.data.phase === "start",
        ),
      ).toBe(true);
      expect(
        events.some(
          (e) => e.payload.kind === "domain" && e.payload.data.phase === "end",
        ),
      ).toBe(false);
      expect(service.modelBudgets.snapshot(work.runId).unknownUsageCalls).toBe(
        1,
      );
    } finally {
      await service.close();
      await fixture.close();
      if (!root.startsWith(prefix)) throw Error("Unexpected test directory");
      rmSync(root, { recursive: true, force: true });
    }
  });
}
