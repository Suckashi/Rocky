import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { FixtureWorkService as WorkService } from "./support/fixture-work-service.js";
import { Store } from "../apps/daemon/src/store.js";
import { startAgentProvider } from "../fixtures/models/agent-provider.js";
import {
  admissionConfigSchema,
  admissionConfigFromEnv,
} from "../apps/daemon/src/admission-config.js";

test("T-010 background submission receipt is stable across retry and restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-background-receipt-"));
  const request = {
    requestId: randomUUID(),
    text: "Background receipt",
    kind: "background" as const,
    mode: "fixture" as const,
    transport: "http" as const,
  };
  let service = new WorkService(root);
  try {
    const first = service.submit(request);
    const retry = service.submit(request);
    expect(retry.id).toBe(first.id);
    expect(retry.runId).toBe(first.runId);
    expect(retry.executionSessionId).toBe(first.executionSessionId);
    expect(service.store.list()).toHaveLength(1);
    expect(() => service.submit({ ...request, text: "Changed" })).toThrow(
      "Request ID has different content",
    );
    await service.close();
    service = new WorkService(root);
    const recovered = service.submit(request);
    expect(recovered.id).toBe(first.id);
    expect(recovered.executionSessionId).toBe(first.executionSessionId);
    expect(service.store.list()).toHaveLength(1);
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

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

test("T-010 restart keeps a queued resource behind an interrupted owner", async () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-resource-restart-"));
  let service = new WorkService(root);
  try {
    const workspaceId = randomUUID();
    const submit = (text: string) =>
      service.submit({
        requestId: randomUUID(),
        text,
        kind: "background",
        workspaceId,
        mode: "fixture",
        transport: "http",
      });
    const owner = submit("Prior active owner");
    const waiting = submit("Must not pass unknown owner");
    await expect
      .poll(() => service.store.get(owner.id).status, { timeout: 10000 })
      .toBe("waiting_approval");
    expect(service.store.get(waiting.id).status).toBe("queued");
    await service.close();
    const store = new Store(root);
    try {
      // Simulated crash image: the old invocation was active and the waiter queued.
      store.db
        .prepare(
          "UPDATE works SET data=json_set(data,'$.status','running') WHERE id=?",
        )
        .run(owner.id);
      store.db
        .prepare(
          "UPDATE works SET data=json_set(data,'$.status','queued') WHERE id=?",
        )
        .run(waiting.id);
    } finally {
      store.close();
    }
    service = new WorkService(root);
    expect(service.store.get(owner.id).status).toBe("blocked");
    expect(service.store.get(waiting.id).status).toBe("queued");
    expect(
      service.store.db
        .prepare("SELECT 1 FROM worker_jobs WHERE run_id=?")
        .get(waiting.runId),
    ).toBeUndefined();
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T-010 bounded admission settings and Work settings snapshot are immutable", async () => {
  expect(admissionConfigSchema.safeParse({ mainSlots: 2 }).success).toBe(false);
  expect(
    admissionConfigFromEnv({
      ROCKY_BACKGROUND_SLOTS: "3",
      ROCKY_MODEL_SLOTS: "4",
    }),
  ).toMatchObject({ backgroundSlots: 3, modelSlots: 4, mainSlots: 1 });
  expect(() => admissionConfigFromEnv({ ROCKY_MODEL_SLOTS: "0" })).toThrow();
  expect(() => admissionConfigFromEnv({ ROCKY_MODEL_SLOTS: "2x" })).toThrow();
  expect(admissionConfigSchema.safeParse({ backgroundSlots: 0 }).success).toBe(
    false,
  );
  expect(admissionConfigSchema.safeParse({ modelSlots: 17 }).success).toBe(
    false,
  );
  expect(admissionConfigSchema.safeParse({ maxQueued: 257 }).success).toBe(
    false,
  );
  const root = mkdtempSync(join(tmpdir(), "rocky-admission-snapshot-"));
  const config = { backgroundSlots: 1, mainWallBudgetMs: 5000 };
  const service = new WorkService(root, config);
  try {
    config.backgroundSlots = 8;
    expect(service.admissionConfig.backgroundSlots).toBe(1);
    const workspaceId = randomUUID();
    const work = service.submit({
      requestId: randomUUID(),
      text: "Pinned settings",
      kind: "main",
      workspaceId,
      mode: "fixture",
      transport: "http",
    });
    const stored = service.store.get(work.id);
    expect(stored).toMatchObject({
      workspaceId,
      wallBudgetMs: 5000,
      kind: "main",
    });
    for (const changed of [
      { text: "changed" },
      { transport: "stdio" as const },
      { workspaceId: randomUUID() },
      { wallBudgetMs: 6000 },
      { kind: "background" as const },
    ])
      expect(() =>
        service.store.save(
          {
            ...stored,
            ...changed,
            revision: stored.revision + 1,
          },
          stored.revision,
        ),
      ).toThrow("revision changed");
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T-010 same resource waits before worker or model slot; unrelated background proceeds", async () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-resource-wait-"));
  const service = new WorkService(root);
  try {
    const shared = randomUUID();
    const submit = (text: string, workspaceId: string) =>
      service.submit({
        requestId: randomUUID(),
        text,
        kind: "background",
        workspaceId,
        mode: "fixture",
        transport: "http",
      });
    const a = submit("Shared A", shared);
    const b = submit("Shared B", shared);
    const c = submit("Unrelated", randomUUID());
    await expect
      .poll(() => [a, c].map((w) => service.store.get(w.id).status), {
        timeout: 10000,
      })
      .toEqual(["waiting_approval", "waiting_approval"]);
    expect(service.store.get(b.id).status).toBe("queued");
    expect(service.modelBudgets.snapshot(b.runId).calls).toBe(0);
    expect(
      service.store.db
        .prepare("SELECT 1 FROM worker_jobs WHERE run_id=?")
        .get(b.runId),
    ).toBeUndefined();
    expect(service.modelSlots.snapshot.active).toBe(0);
    const current = service.store.get(a.id);
    service.stop(a.id, {
      requestId: randomUUID(),
      runId: current.runId,
      executionSessionId: current.executionSessionId,
      expectedRevision: current.revision,
    });
    await expect
      .poll(() => service.store.get(b.id).status, { timeout: 10000 })
      .toBe("waiting_approval");
    expect(service.store.get(c.id).status).toBe("waiting_approval");
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T-010 queued model selection stays pinned and never adopts another Work's changed connection", async () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-queued-settings-"));
  const service = new WorkService(root);
  try {
    const connectionId = randomUUID();
    const config = {
      name: "pinned endpoint",
      provider: "openai-compatible" as const,
      baseUrl: "http://127.0.0.1:65530/v1",
      modelId: "pinned",
      contextWindowTokens: 4096,
      maxOutputTokens: 128,
    };
    service.models.save({
      requestId: randomUUID(),
      id: connectionId,
      expectedRevision: 0,
      config,
    });
    const shared = randomUUID();
    const occupied = service.submit({
      requestId: randomUUID(),
      text: "Occupy shared resource",
      kind: "background",
      workspaceId: shared,
      mode: "fixture",
      transport: "http",
    });
    const queued = service.submit({
      requestId: randomUUID(),
      text: "Pinned queued model",
      kind: "background",
      workspaceId: shared,
      mode: "configured",
      transport: "http",
      modelSelection: { connectionId, revision: 1 },
    });
    expect(service.store.get(queued.id).status).toBe("queued");
    service.models.save({
      requestId: randomUUID(),
      id: connectionId,
      expectedRevision: 1,
      config: { ...config, modelId: "changed" },
    });
    const current = service.store.get(occupied.id);
    service.stop(occupied.id, {
      requestId: randomUUID(),
      runId: current.runId,
      executionSessionId: current.executionSessionId,
      expectedRevision: current.revision,
    });
    await expect
      .poll(() => service.store.get(queued.id).status, { timeout: 10000 })
      .toBe("failed");
    expect(service.store.get(queued.id).modelSelection).toEqual({
      connectionId,
      revision: 1,
    });
    expect(service.modelBudgets.snapshot(queued.runId).calls).toBe(0);
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T-010 active wall budget stops a held model request without claiming completion", async () => {
  const fixture = await startAgentProvider({ hold: true });
  const root = mkdtempSync(join(tmpdir(), "rocky-wall-budget-"));
  const service = new WorkService(root, { mainWallBudgetMs: 1500 });
  try {
    const connectionId = randomUUID();
    service.models.save({
      requestId: randomUUID(),
      id: connectionId,
      expectedRevision: 0,
      config: {
        name: "held wall provider",
        provider: "openai-compatible",
        baseUrl: fixture.baseUrl,
        modelId: "scripted",
        contextWindowTokens: 4096,
        maxOutputTokens: 128,
      },
    });
    const work = service.submit({
      requestId: randomUUID(),
      text: "Wait for held model",
      mode: "configured",
      modelSelection: { connectionId, revision: 1 },
    });
    await expect
      .poll(() => service.store.get(work.id).status, { timeout: 10000 })
      .toBe("failed");
    expect(service.store.get(work.id).error).toContain("time budget exhausted");
    expect(service.store.get(work.id).answer).toBe("");
    expect(
      service.store.db
        .prepare("SELECT count(*) AS n FROM operations WHERE id LIKE ?")
        .get(work.runId + ":%"),
    ).toEqual({ n: 0 });
  } finally {
    await service.close();
    await fixture.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T-010 approval waiting does not consume active wall budget", async () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-wall-pause-"));
  const service = new WorkService(root, { mainWallBudgetMs: 3000 });
  try {
    const work = service.submit({
      requestId: randomUUID(),
      text: "Pause for approval",
      mode: "fixture",
      transport: "http",
    });
    await expect
      .poll(() => service.store.get(work.id).status, { timeout: 10000 })
      .toBe("waiting_approval");
    await new Promise((resolve) => setTimeout(resolve, 3200));
    const pending = service.store.get(work.id);
    expect(pending.status).toBe("waiting_approval");
    service.decide(work.id, {
      requestId: randomUUID(),
      expectedRevision: pending.approval!.revision,
      intentFingerprint: pending.approval!.intentFingerprint,
      decision: "reject",
    });
    await expect
      .poll(() => service.store.get(work.id).status, { timeout: 10000 })
      .toBe("completed");
    expect(service.store.get(work.id).answer).toContain("拒絕");
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});
