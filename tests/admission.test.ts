import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { Store } from "../apps/daemon/src/store.js";
import { startAgentProvider } from "../fixtures/models/agent-provider.js";

test("T-010 main admission remains available with two independent background sessions", async () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-admission-"));
  const service = new WorkService(root);
  try {
    const submit = (kind: "main" | "background", text: string) =>
      service.submit({
        requestId: randomUUID(),
        text,
        kind,
        mode: "fixture",
        transport: "http",
      });
    const a = submit("background", "Background A");
    const b = submit("background", "Background B");
    const waiting = submit("background", "Background queued");
    const main = submit("main", "Foreground remains available");
    expect(
      new Set([
        a.executionSessionId,
        b.executionSessionId,
        waiting.executionSessionId,
        main.executionSessionId,
      ]).size,
    ).toBe(4);
    expect(service.store.get(waiting.id).status).toBe("queued");
    expect(service.modelBudgets.snapshot(waiting.runId).calls).toBe(0);
    expect(
      service.store.db
        .prepare("SELECT 1 FROM worker_jobs WHERE run_id=?")
        .get(waiting.runId),
    ).toBeUndefined();
    await expect
      .poll(() => [a, b, main].map((w) => service.store.get(w.id).status), {
        timeout: 10000,
      })
      .toEqual(["waiting_approval", "waiting_approval", "waiting_approval"]);
    expect(service.store.get(waiting.id).status).toBe("queued");
    const pinned = service.store.get(main.id);
    expect(() =>
      service.store.save(
        {
          ...pinned,
          kind: "background",
          revision: pinned.revision + 1,
        },
        pinned.revision,
      ),
    ).toThrow("revision changed");
    const active = service.store.get(a.id);
    service.stop(a.id, {
      requestId: randomUUID(),
      runId: active.runId,
      executionSessionId: active.executionSessionId,
      expectedRevision: active.revision,
    });
    await expect
      .poll(() => service.store.get(waiting.id).status, { timeout: 10000 })
      .toBe("waiting_approval");
    expect(service.store.get(b.id).status).toBe("waiting_approval");
    expect(service.store.get(main.id).status).toBe("waiting_approval");
    expect(service.store.get(a.id).status).toBe("cancelled");
    expect(service.store.list().map((w) => w.kind)).toEqual([
      "background",
      "background",
      "background",
      "main",
    ]);
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T-010 main model request waits for a global slot and dispatches when a background call stops", async () => {
  const fixture = await startAgentProvider({ hold: true });
  const root = mkdtempSync(join(tmpdir(), "rocky-model-admission-"));
  const service = new WorkService(root);
  try {
    const connectionId = randomUUID();
    service.models.save({
      requestId: randomUUID(),
      id: connectionId,
      expectedRevision: 0,
      config: {
        name: "held provider",
        provider: "openai-compatible",
        baseUrl: fixture.baseUrl,
        modelId: "scripted",
        contextWindowTokens: 4096,
        maxOutputTokens: 128,
      },
    });
    const submit = (kind: "main" | "background", text: string) =>
      service.submit({
        requestId: randomUUID(),
        text,
        kind,
        mode: "configured",
        transport: "http",
        modelSelection: { connectionId, revision: 1 },
      });
    const a = submit("background", "Background A");
    submit("background", "Background B");
    await expect
      .poll(() => fixture.requests.length, { timeout: 10000 })
      .toBe(2);
    const main = submit("main", "Main request");
    await expect
      .poll(() => service.modelSlots.snapshot.waiting, { timeout: 10000 })
      .toBe(1);
    expect(fixture.requests).toHaveLength(2);
    const current = service.store.get(a.id);
    service.stop(a.id, {
      requestId: randomUUID(),
      runId: current.runId,
      executionSessionId: current.executionSessionId,
      expectedRevision: current.revision,
    });
    await expect
      .poll(() => fixture.requests.length, { timeout: 10000 })
      .toBe(3);
    expect(service.store.get(main.id).status).toBe("running");
  } finally {
    await service.close();
    await fixture.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T-010 restart re-admits only a durable queued command; prior running sessions stay terminal", async () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-queued-restart-"));
  let service = new WorkService(root);
  try {
    const submit = (text: string) =>
      service.submit({
        requestId: randomUUID(),
        text,
        kind: "background",
        mode: "fixture",
        transport: "http",
      });
    const a = submit("Running A");
    const b = submit("Running B");
    const queued = submit("Durable queued");
    expect(service.store.get(queued.id).status).toBe("queued");
    await service.close();
    const store = new Store(root);
    try {
      // Seed the exact crash boundary: queued was persisted but graceful close
      // did not run. Only this row is reset; no worker checkpoint is replayed.
      store.db
        .prepare(
          "UPDATE works SET data=json_set(data,'$.status','queued') WHERE id=?",
        )
        .run(queued.id);
    } finally {
      store.close();
    }
    service = new WorkService(root);
    await expect
      .poll(() => service.store.get(queued.id).status, { timeout: 10000 })
      .toBe("waiting_approval");
    expect(service.store.get(a.id).status).toBe("cancelled");
    expect(service.store.get(b.id).status).toBe("cancelled");
    expect(
      service.store.db
        .prepare("SELECT count(*) AS n FROM worker_jobs WHERE run_id=?")
        .get(queued.runId),
    ).toEqual({ n: 1 });
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});
