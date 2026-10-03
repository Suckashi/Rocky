import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../apps/daemon/src/store.js";
import {
  ModelBudgetLedger,
  pricedMicroUsd,
} from "../apps/daemon/src/model-budget.js";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { createApp } from "../apps/daemon/src/http.js";
import { modelUsageSnapshotSchema } from "../packages/contracts/src/model-budget.js";
const reservation = (purpose: "target" | "subagent" = "target") => ({
  requestId: randomUUID(),
  purpose,
  inputTokenBound: 10,
  outputTokenBound: 20,
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "rocky-budget-"));
  const store = new Store(root);
  const ledger = new ModelBudgetLedger(store);
  return {
    root,
    store,
    ledger,
    close: () => {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test("T-007 R-048 root and native child share a durable dispatch cap; duplicate reservations never authorize resend", () => {
  const f = fixture(),
    runId = randomUUID(),
    first = reservation();
  try {
    f.ledger.open(runId, { maxCalls: 2 });
    f.ledger.reserve(runId, first);
    f.ledger.reserve(runId, reservation("subagent"));
    expect(() => f.ledger.reserve(runId, reservation())).toThrow("exhausted");
    expect(() => f.ledger.reserve(runId, first)).toThrow("already reserved");
    expect(() => f.ledger.open(runId, { maxCalls: 3 })).toThrow("immutable");
    f.store.close();
    const reopened = new Store(f.root);
    const recovered = new ModelBudgetLedger(reopened);
    try {
      expect(recovered.snapshot(runId).calls).toBe(2);
      expect(() => recovered.reserve(runId, reservation())).toThrow(
        "exhausted",
      );
    } finally {
      reopened.close();
    }
  } finally {
    f.close();
  }
});
test("T-007 budget reservations hold unknown usage and only reported settlement releases token capacity", () => {
  const f = fixture(),
    runId = randomUUID(),
    first = reservation();
  try {
    f.ledger.open(runId, { maxTokens: 40 });
    f.ledger.reserve(runId, first);
    expect(() => f.ledger.reserve(runId, reservation("subagent"))).toThrow(
      "exhausted",
    );
    expect(f.ledger.snapshot(runId).unknownUsageCalls).toBe(1);
    f.ledger.settle(runId, first.requestId, {
      inputTokens: 4,
      outputTokens: 6,
    });
    f.ledger.settle(runId, first.requestId, {
      inputTokens: 4,
      outputTokens: 6,
    });
    expect(() =>
      f.ledger.settle(runId, first.requestId, {
        inputTokens: 5,
        outputTokens: 6,
      }),
    ).toThrow("differently");
    const second = reservation("subagent");
    f.ledger.reserve(runId, second);
    f.ledger.settle(runId, second.requestId, null);
    const snapshot = f.ledger.snapshot(runId);
    expect(snapshot.knownUsage).toEqual({ inputTokens: 4, outputTokens: 6 });
    expect(snapshot.heldTokens).toBe(40);
    expect(snapshot.unknownUsageCalls).toBe(1);
    expect(snapshot.knownEstimatedMicroUsd).toBeNull();
    expect(() => f.ledger.reserve(runId, reservation())).toThrow("exhausted");
  } finally {
    f.close();
  }
});
test("T-007 cost caps require explicit prices and trusted token bounds; integer pricing rounds up", () => {
  const f = fixture(),
    runId = randomUUID();
  try {
    expect(() => f.ledger.open(runId, { maxMicroUsd: 1 })).toThrow();
    const pricing = {
      inputMicroUsdPerMillion: 1000000,
      outputMicroUsdPerMillion: 2000000,
    };
    f.ledger.open(runId, { maxMicroUsd: 50, pricing });
    expect(() =>
      f.ledger.reserve(runId, { ...reservation(), inputTokenBound: null }),
    ).toThrow("trusted token bounds");
    f.ledger.reserve(runId, reservation());
    expect(f.ledger.snapshot(runId).heldMicroUsd).toBe("50");
    expect(() => f.ledger.reserve(runId, reservation())).toThrow("exhausted");
    expect(
      pricedMicroUsd(
        { inputTokens: 1, outputTokens: 1 },
        { inputMicroUsdPerMillion: 1, outputMicroUsdPerMillion: 1 },
      ),
    ).toBe(1);
    expect(() =>
      f.ledger.settle(runId, randomUUID(), {
        inputTokens: NaN,
        outputTokens: 0,
      }),
    ).toThrow();
  } finally {
    f.close();
  }
});
test("T-007 provider-reported overrun is retained and prevents a subsequent dispatch", () => {
  const f = fixture(),
    runId = randomUUID(),
    request = reservation();
  try {
    f.ledger.open(runId, { maxTokens: 30 });
    f.ledger.reserve(runId, request);
    f.ledger.settle(runId, request.requestId, {
      inputTokens: 100,
      outputTokens: 200,
    });
    expect(f.ledger.snapshot(runId).heldTokens).toBe(300);
    expect(() => f.ledger.reserve(runId, reservation())).toThrow("exhausted");
  } finally {
    f.close();
  }
});
test("T-007 actual Work path refuses the next model dispatch when its root call budget is spent", async () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-budget-work-"));
  const service = new WorkService(root);
  try {
    const work = service.submit({
      requestId: randomUUID(),
      text: "Budget exhaustion fixture",
      transport: "http",
      mode: "fixture",
    });
    service.modelBudgets.open(work.runId);
    for (let i = 0; i < 48; i++)
      service.modelBudgets.reserve(work.runId, {
        ...reservation(),
        inputTokenBound: null,
        outputTokenBound: null,
      });
    await expect.poll(() => service.store.get(work.id).status).toBe("failed");
    expect(service.modelBudgets.snapshot(work.runId).calls).toBe(48);
    const response = await createApp(service).request(
      `/api/v1/works/${work.id}/model-usage`,
      { headers: { host: "127.0.0.1:3211" } },
    );
    expect(response.status).toBe(200);
    expect(
      modelUsageSnapshotSchema.parse(await response.json()).unknownUsageCalls,
    ).toBe(48);
    expect(
      service.store
        .eventsForWork(work.id)
        .some(
          (e) =>
            e.payload.kind === "domain" &&
            e.payload.name === "rocky.model.completed",
        ),
    ).toBe(false);
    expect(
      service.store.db.prepare("SELECT * FROM operations").all(),
    ).toHaveLength(0);
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T-007 submission freezes custom budget across receipts, CAS and restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-budget-submit-"));
  const service = new WorkService(root);
  let closed = false;
  try {
    const command = {
      requestId: randomUUID(),
      text: "Bounded fixture",
      mode: "fixture",
      transport: "http",
      modelBudget: { maxCalls: 1 },
    };
    const work = service.submit(command);
    expect(service.modelBudgets.snapshot(work.runId).budget.maxCalls).toBe(1);
    expect(service.submit(command).id).toBe(work.id);
    expect(() =>
      service.submit({ ...command, modelBudget: { maxCalls: 2 } }),
    ).toThrow("different content");
    expect(() =>
      service.store.save(
        {
          ...work,
          revision: 2,
          modelBudget: { ...work.modelBudget!, maxCalls: 2 },
        },
        1,
      ),
    ).toThrow("revision changed");
    await expect.poll(() => service.store.get(work.id).status).toBe("failed");
    expect(service.modelBudgets.snapshot(work.runId).calls).toBe(1);
    await service.close();
    closed = true;
    const reopened = new Store(root);
    try {
      const ledger = new ModelBudgetLedger(reopened);
      expect(ledger.snapshot(work.runId).budget.maxCalls).toBe(1);
      expect(ledger.snapshot(work.runId).calls).toBe(1);
      expect(() => ledger.open(work.runId, { maxCalls: 48 })).toThrow(
        "immutable",
      );
      expect(reopened.get(work.id).modelBudget?.maxCalls).toBe(1);
    } finally {
      reopened.close();
    }
  } finally {
    if (!closed) await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T-007 submitted token cap fails closed before dispatch when no trusted bounds exist", async () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-budget-no-bounds-"));
  const service = new WorkService(root);
  try {
    const work = service.submit({
      requestId: randomUUID(),
      text: "Never guess tokens",
      mode: "fixture",
      transport: "http",
      modelBudget: { maxTokens: 1000 },
    });
    await expect.poll(() => service.store.get(work.id).status).toBe("failed");
    expect(service.modelBudgets.snapshot(work.runId).calls).toBe(0);
    expect(
      service.store.db.prepare("SELECT * FROM operations").all(),
    ).toHaveLength(0);
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});
