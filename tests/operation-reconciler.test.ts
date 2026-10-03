import { test, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Store } from "../apps/daemon/src/store.js";
import { OperationLedger } from "../apps/daemon/src/operation-ledger.js";
import {
  OperationReconciler,
  type OperationObservation,
} from "../apps/daemon/src/operation-reconciler.js";
import { workSchema } from "../packages/contracts/src/index.js";
function setup(transport: "stdio" | "http" = "http") {
  const root = mkdtempSync(join(tmpdir(), "rocky-reconcile-")),
    store = new Store(root),
    ledger = new OperationLedger(store);
  const work = workSchema.parse({
    id: randomUUID(),
    runId: randomUUID(),
    executionSessionId: randomUUID(),
    requestId: randomUUID(),
    text: "Synthetic reconciliation",
    transport,
    mode: "fixture",
    runMode: "normal",
    status: "running",
    revision: 1,
    answer: "",
    createdAt: new Date().toISOString(),
  });
  store.add(work, "test");
  const prepared = ledger.prepare(
    work,
    "lost-result",
    "write_sample",
    { value: "synthetic" },
    "f",
  );
  const dispatched = ledger.transition(
    work,
    ledger.transition(work, prepared, "authorized", "not_executed"),
    "dispatched",
    "unknown",
  );
  store.save({ ...work, status: "blocked", revision: 2 }, 1);
  const command = {
    requestId: randomUUID(),
    operationId: dispatched.id,
    expectedRevision: dispatched.revision,
  };
  const observation: OperationObservation = {
    operationId: dispatched.id,
    intentHash: dispatched.args_hash,
    outcome: "succeeded",
    result: '{"synthetic":true}',
    evidenceRef: randomUUID(),
    observedAt: new Date().toISOString(),
  };
  return {
    root,
    store,
    ledger,
    work,
    dispatched,
    command,
    observation,
    reconciler: new OperationReconciler(store),
  };
}
test("T-008 lost synthetic result reconciles from durable receipt without replay; request persists across restart", async () => {
  const f = setup();
  let closed = false,
    queries = 0;
  try {
    const receiptPath = join(f.root, "synthetic-remote-receipt.json");
    writeFileSync(receiptPath, JSON.stringify(f.observation));
    const observer = async () => {
      queries++;
      return JSON.parse(readFileSync(receiptPath, "utf8"));
    };
    const receipt = await f.reconciler.reconcile(
      f.work.id,
      f.command,
      observer,
      AbortSignal.timeout(2000),
    );
    expect(receipt.outcome).toBe("succeeded");
    expect(queries).toBe(1);
    expect(f.ledger.get(f.dispatched.id)).toMatchObject({
      phase: "settled",
      outcome: "succeeded",
      result: f.observation.result,
    });
    expect(f.store.get(f.work.id).status).toBe("blocked");
    expect(
      f.store
        .eventsForWork(f.work.id)
        .filter(
          (e) =>
            e.payload.kind === "domain" &&
            e.payload.name === "rocky.operation.dispatched",
        ),
    ).toHaveLength(1);
    f.store.close();
    closed = true;
    const reopened = new Store(f.root);
    try {
      expect(
        await new OperationReconciler(reopened).reconcile(
          f.work.id,
          f.command,
          observer,
          AbortSignal.timeout(2000),
        ),
      ).toEqual(receipt);
      expect(queries).toBe(1);
    } finally {
      reopened.close();
    }
  } finally {
    if (!closed) f.store.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
test("T-008 mismatched evidence/cancelled query and stale concurrent reconciliation cannot overwrite unknown or newer results", async () => {
  const f = setup();
  try {
    await expect(
      f.reconciler.reconcile(
        f.work.id,
        f.command,
        async () => ({ ...f.observation, intentHash: "0".repeat(64) }),
        AbortSignal.timeout(2000),
      ),
    ).rejects.toThrow("does not match");
    const abort = new AbortController();
    await expect(
      f.reconciler.reconcile(
        f.work.id,
        f.command,
        async () => {
          abort.abort();
          return f.observation;
        },
        abort.signal,
      ),
    ).rejects.toThrow();
    expect(f.ledger.get(f.dispatched.id)).toEqual(f.dispatched);
    let resolve!: (value: OperationObservation) => void;
    const pending = f.reconciler.reconcile(
      f.work.id,
      f.command,
      () =>
        new Promise((r) => {
          resolve = r;
        }),
      AbortSignal.timeout(2000),
    );
    const other = await f.reconciler.reconcile(
      f.work.id,
      { ...f.command, requestId: randomUUID() },
      async () => ({
        ...f.observation,
        outcome: "failed_known_no_effect",
        result: null,
      }),
      AbortSignal.timeout(2000),
    );
    resolve(f.observation);
    await expect(pending).rejects.toThrow("changed while observing");
    expect(other.outcome).toBe("failed_known_no_effect");
    expect(f.ledger.get(f.dispatched.id)?.outcome).toBe(
      "failed_known_no_effect",
    );
  } finally {
    f.store.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
test("T-008 inconclusive status remains unknown and cannot become permission to dispatch", async () => {
  const f = setup();
  try {
    const receipt = await f.reconciler.reconcile(
      f.work.id,
      f.command,
      async () => ({ ...f.observation, outcome: "unknown", result: null }),
      AbortSignal.timeout(2000),
    );
    expect(receipt.outcome).toBe("unknown");
    expect(f.ledger.get(f.dispatched.id)?.outcome).toBe("unknown");
    expect(() =>
      f.ledger.transition(
        f.work,
        f.ledger.get(f.dispatched.id)!,
        "dispatched",
        "unknown",
      ),
    ).toThrow("Invalid operation transition");
  } finally {
    f.store.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

for (const transport of ["stdio", "http"] as const)
  test(
    "T-008 MCP durable receipt resolves lost response after restart without resending: " +
      transport,
    async () => {
      const { connectFixture } =
        await import("../packages/agent-runtime/src/mcp.js");
      const { WorkService } =
        await import("../apps/daemon/src/work-service.js");
      const { readdirSync } = await import("node:fs");
      const f = setup(transport);
      let closed = false;
      try {
        const receiptRoot = join(f.root, "synthetic-receipts", f.work.runId);
        const connection = await connectFixture(transport, receiptRoot);
        try {
          // External side commits; deliberately discard its response before any domain settlement.
          const response = await connection.client.callTool({
            name: "write_sample",
            arguments: { value: "synthetic" },
            _meta: {
              "rocky/operation": {
                operationId: f.dispatched.id,
                intentHash: f.dispatched.args_hash,
              },
            },
          });
          expect(response.isError).not.toBe(true);
        } finally {
          await connection.close();
        }
        const files = readdirSync(receiptRoot);
        expect(files).toHaveLength(1);
        const before = readFileSync(join(receiptRoot, files[0]!), "utf8");
        expect(f.ledger.get(f.dispatched.id)?.outcome).toBe("unknown");
        f.store.close();
        closed = true;
        const service = new WorkService(f.root);
        try {
          const { createApp } = await import("../apps/daemon/src/http.js");
          const app = createApp(service);
          const headers: Record<string, string> = {
            host: "127.0.0.1:3211",
            "content-type": "application/json",
          };
          const path = "/api/v1/works/" + f.work.id;
          const post = (body: unknown) =>
            app.request(path + "/reconcile", {
              method: "POST",
              headers,
              body: JSON.stringify(body),
            });
          expect((await post(f.command)).status).toBe(403);
          headers["x-rocky-session"] = (
            await (await app.request("/api/v1/session", { headers })).json()
          ).token;
          expect(
            (await post({ ...f.command, outcome: "succeeded" })).status,
          ).toBe(400);
          const response = await post(f.command);
          expect(response.status).toBe(200);
          const receipt = await response.json();
          const listing = await (
            await app.request(path + "/operations", { headers })
          ).json();
          expect(listing.operations).toEqual([
            {
              id: f.dispatched.id,
              revision: receipt.operationRevision,
              tool: "write_sample",
              phase: "settled",
              outcome: "succeeded",
              canReconcile: false,
            },
          ]);
          expect(receipt.outcome).toBe("succeeded");
          expect(service.operations.get(f.dispatched.id)?.result).toContain(
            "synthetic-only",
          );
          expect(service.store.get(f.work.id).status).toBe("blocked");
          expect(
            service.store.db.prepare("SELECT * FROM target_claims").all(),
          ).toHaveLength(0);
          expect(
            await service.reconcileOperation(
              f.work.id,
              f.command,
              AbortSignal.timeout(10000),
            ),
          ).toEqual(receipt);
          expect(readdirSync(receiptRoot)).toEqual(files);
          expect(readFileSync(join(receiptRoot, files[0]!), "utf8")).toBe(
            before,
          );
        } finally {
          await service.close();
        }
      } finally {
        if (!closed) f.store.close();
        rmSync(f.root, { recursive: true, force: true });
      }
    },
  );

test("T-008 missing MCP receipt remains unknown and keeps target claim", async () => {
  const { WorkService } = await import("../apps/daemon/src/work-service.js");
  const f = setup();
  f.store.close();
  const service = new WorkService(f.root);
  try {
    const receipt = await service.reconcileOperation(
      f.work.id,
      f.command,
      AbortSignal.timeout(10000),
    );
    expect(receipt.outcome).toBe("unknown");
    expect(service.operations.get(f.dispatched.id)?.result).toBeNull();
    expect(
      service.store.db.prepare("SELECT * FROM target_claims").all(),
    ).toHaveLength(1);
  } finally {
    await service.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
