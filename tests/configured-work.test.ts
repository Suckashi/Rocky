import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { FixtureWorkService as WorkService } from "./support/fixture-work-service.js";
import { Store } from "../apps/daemon/src/store.js";
import { ModelBudgetLedger } from "../apps/daemon/src/model-budget.js";
import { startAgentProvider } from "../fixtures/models/agent-provider.js";
import {
  workSchema,
  submissionSchema,
} from "../packages/contracts/src/index.js";
test("T-007 shutdown cancels configured model I/O and retains unknown usage without replay", async () => {
  const fixture = await startAgentProvider({ hold: true }),
    root = mkdtempSync(join(tmpdir(), "rocky-configured-close-")),
    service = new WorkService(root);
  let closed = false;
  try {
    const connectionId = randomUUID();
    service.models.save({
      id: connectionId,
      requestId: randomUUID(),
      expectedRevision: 0,
      config: {
        name: "close fixture",
        provider: "openai-compatible",
        baseUrl: fixture.baseUrl,
        modelId: "scripted",
        contextWindowTokens: 4096,
        maxOutputTokens: 128,
      },
    });
    const work = service.submit({
      requestId: randomUUID(),
      text: "Wait for response",
      mode: "configured",
      modelSelection: { connectionId, revision: 1 },
      transport: "http",
    });
    await expect
      .poll(() => fixture.requests.length, { timeout: 10000 })
      .toBe(1);
    expect(
      service.store
        .snapshot()
        .events.some(
          (event) =>
            event.workId === work.id &&
            event.executionSessionId === work.executionSessionId &&
            event.payload.kind === "domain" &&
            event.payload.name === "rocky.model.started",
        ),
    ).toBe(true);
    await service.close();
    closed = true;
    const reopened = new Store(root);
    try {
      expect(reopened.get(work.id).status).toBe("cancelled");
      expect(
        new ModelBudgetLedger(reopened).snapshot(work.runId).unknownUsageCalls,
      ).toBe(1);
      expect(fixture.requests).toHaveLength(1);
    } finally {
      reopened.close();
    }
  } finally {
    if (!closed) await service.close();
    await fixture.close();
    rmSync(root, { recursive: true, force: true });
  }
});
for (const provider of ["openai-compatible", "anthropic"] as const)
  test(`T-007 configured Work ${provider} preserves daemon approval, native child, usage and persisted model selection`, async () => {
    const fixture = await startAgentProvider(),
      root = mkdtempSync(join(tmpdir(), "rocky-configured-work-")),
      service = new WorkService(root);
    try {
      const connectionId = randomUUID();
      service.models.save({
        requestId: randomUUID(),
        id: connectionId,
        expectedRevision: 0,
        config: {
          name: "configured fixture",
          provider,
          baseUrl: fixture.baseUrl,
          modelId: "scripted",
          contextWindowTokens: 4096,
          maxOutputTokens: 128,
        },
      });
      const command = {
        requestId: randomUUID(),
        text: "Inspect then write synthetic data",
        mode: "configured",
        transport: "http",
        modelSelection: { connectionId, revision: 1 },
      };
      const work = service.submit(command);
      expect(service.submit(command).id).toBe(work.id);
      await expect
        .poll(() => service.store.get(work.id).status, { timeout: 10000 })
        .toBe("waiting_approval");
      expect(
        service.store.db
          .prepare(
            "SELECT * FROM operations WHERE id LIKE ? AND outcome!='not_executed'",
          )
          .all(work.runId + ":%"),
      ).toHaveLength(1);
      const waiting = service.store.get(work.id);
      service.decide(work.id, {
        requestId: randomUUID(),
        expectedRevision: waiting.approval!.revision,
        intentFingerprint: waiting.approval!.intentFingerprint,
        decision: "approve",
      });
      await expect
        .poll(() => service.store.get(work.id).status, { timeout: 10000 })
        .toBe("completed");
      await expect
        .poll(
          () =>
            (
              service.store.db
                .prepare("SELECT status FROM worker_jobs WHERE run_id=?")
                .get(work.runId) as { status: string } | undefined
            )?.status,
        )
        .toBe("exited");
      expect(
        service.modelBudgets.snapshot(work.runId).knownUsage.inputTokens,
      ).toBe(fixture.requests.length * 7);
      expect(
        service.modelBudgets
          .snapshot(work.runId)
          .entries.some((e) => e.purpose === "subagent"),
      ).toBe(true);
      expect(
        workSchema.parse(service.store.get(work.id)).modelSelection,
      ).toEqual(command.modelSelection);
      const completed = service.store.get(work.id);
      expect(() =>
        service.store.save(
          {
            ...completed,
            revision: completed.revision + 1,
            modelSelection: { connectionId, revision: 2 },
          },
          completed.revision,
        ),
      ).toThrow("revision");
      const calls = fixture.requests.length;
      expect(service.submit(command).id).toBe(work.id);
      expect(fixture.requests).toHaveLength(calls);
    } finally {
      await service.close();
      await fixture.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
test("T-007 submission rejects implicit model selection and stale configured approvals cannot dispatch effects", async () => {
  expect(
    submissionSchema.safeParse({
      requestId: randomUUID(),
      text: "x",
      mode: "configured",
    }).success,
  ).toBe(false);
  const fixture = await startAgentProvider(),
    root = mkdtempSync(join(tmpdir(), "rocky-configured-revoke-")),
    service = new WorkService(root);
  try {
    const id = randomUUID(),
      config = {
        name: "revocation fixture",
        provider: "openai-compatible",
        baseUrl: fixture.baseUrl,
        modelId: "scripted",
        contextWindowTokens: 4096,
        maxOutputTokens: 128,
      };
    service.models.save({
      requestId: randomUUID(),
      id,
      expectedRevision: 0,
      config,
    });
    const input = {
      requestId: randomUUID(),
      text: "Inspect synthetic data",
      mode: "configured",
      transport: "http",
      modelSelection: { connectionId: id, revision: 1 },
    };
    const work = service.submit(input);
    await expect
      .poll(() => service.store.get(work.id).status, { timeout: 10000 })
      .toBe("waiting_approval");
    const waiting = service.store.get(work.id);
    service.models.save({
      requestId: randomUUID(),
      id,
      expectedRevision: 1,
      config,
    });
    expect(() =>
      service.decide(work.id, {
        requestId: randomUUID(),
        expectedRevision: waiting.approval!.revision,
        intentFingerprint: waiting.approval!.intentFingerprint,
        decision: "approve",
      }),
    ).toThrow("changed");
    expect(
      service.store.db
        .prepare("SELECT * FROM operations WHERE outcome!='not_executed'")
        .all(),
    ).toHaveLength(1);
    expect(() => service.submit({ ...input, requestId: randomUUID() })).toThrow(
      "changed",
    );
    expect(service.store.list()).toHaveLength(1);
  } finally {
    await service.close();
    await fixture.close();
    rmSync(root, { recursive: true, force: true });
  }
});
