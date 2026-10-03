import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../apps/daemon/src/store.js";
import { OperationLedger } from "../apps/daemon/src/operation-ledger.js";
import { workSchema } from "../packages/contracts/src/index.js";
function setup() {
  const root = mkdtempSync(join(tmpdir(), "rocky-operation-"));
  const store = new Store(root);
  const work = workSchema.parse({
    id: randomUUID(),
    runId: randomUUID(),
    executionSessionId: randomUUID(),
    requestId: randomUUID(),
    text: "Synthetic ledger test",
    transport: "http",
    mode: "fixture",
    runMode: "normal",
    status: "running",
    revision: 1,
    answer: "",
    createdAt: new Date().toISOString(),
  });
  store.add(work, "test");
  return { root, store, work, ledger: new OperationLedger(store) };
}
test("T-008 durable stages, exact intent, CAS and unknown never reset on restart", () => {
  const { root, store, work, ledger } = setup();
  let closed = false;
  try {
    const prepared = ledger.prepare(
      work,
      "call",
      "write_sample",
      { a: 1, b: 2 },
      "fingerprint",
    );
    expect(prepared).toMatchObject({
      phase: "prepared",
      outcome: "not_executed",
      revision: 1,
    });
    expect(() =>
      ledger.transition(
        work,
        prepared,
        "settled",
        "not_executed",
        null,
        {},
        () => {
          throw Error("receipt failed");
        },
      ),
    ).toThrow("receipt failed");
    expect(ledger.get(prepared.id)).toEqual(prepared);
    expect(store.eventsForWork(work.id)).toHaveLength(1);
    expect(
      ledger.prepare(
        work,
        "call",
        "write_sample",
        { b: 2, a: 1 },
        "fingerprint",
      ),
    ).toEqual(prepared);
    expect(() =>
      ledger.prepare(
        work,
        "call",
        "write_sample",
        { a: 3, b: 2 },
        "fingerprint",
      ),
    ).toThrow("intent changed");
    expect(() =>
      ledger.transition(work, prepared, "dispatched", "unknown"),
    ).toThrow("Invalid operation transition");
    const authorized = ledger.transition(
      work,
      prepared,
      "authorized",
      "not_executed",
    );
    expect(() =>
      ledger.transition(work, prepared, "authorized", "not_executed"),
    ).toThrow("revision changed");
    const dispatched = ledger.transition(
      work,
      authorized,
      "dispatched",
      "unknown",
    );
    expect(dispatched).toMatchObject({
      phase: "dispatched",
      outcome: "unknown",
    });
    const settled = ledger.transition(work, dispatched, "settled", "unknown");
    expect(() =>
      ledger.transition(work, settled, "dispatched", "unknown"),
    ).toThrow("Invalid operation transition");
    store.close();
    closed = true;
    const reopened = new Store(root);
    try {
      expect(new OperationLedger(reopened).get(prepared.id)).toEqual(settled);
      expect(reopened.eventsForWork(work.id)).toHaveLength(4);
    } finally {
      reopened.close();
    }
  } finally {
    if (!closed) store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("T-008 owner/session and active status are rechecked before dispatch; late known outcome can settle", () => {
  const { root, store, work, ledger } = setup();
  try {
    expect(() =>
      ledger.prepare(
        { ...work, executionSessionId: randomUUID() },
        "call",
        "write_sample",
        {},
        "f",
      ),
    ).toThrow("context changed");
    const prepared = ledger.prepare(work, "call", "write_sample", {}, "f");
    expect(() =>
      ledger.transition(
        { ...work, executionSessionId: randomUUID() },
        prepared,
        "authorized",
        "not_executed",
      ),
    ).toThrow("context changed");
    const authorized = ledger.transition(
      work,
      prepared,
      "authorized",
      "not_executed",
    );
    store.save({ ...work, status: "cancelled", revision: 2 }, 1);
    expect(() =>
      ledger.transition(work, authorized, "dispatched", "unknown"),
    ).toThrow("not running");
    store.save({ ...work, status: "running", revision: 3 }, 2);
    const dispatched = ledger.transition(
      work,
      authorized,
      "dispatched",
      "unknown",
    );
    store.save({ ...work, status: "cancelled", revision: 4 }, 3);
    const settled = ledger.transition(
      work,
      dispatched,
      "settled",
      "succeeded",
      '{"observed":true}',
    );
    expect(settled).toMatchObject({
      phase: "settled",
      outcome: "succeeded",
      result: '{"observed":true}',
    });
    expect(ledger.prepare(work, "call", "write_sample", {}, "f")).toEqual(
      settled,
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T-008 own v4 operation migration preserves success and unknown without inventing context", () => {
  const { root, store } = setup();
  let closed = false;
  try {
    store.db.exec(
      "DROP TABLE operations; CREATE TABLE operations(id TEXT PRIMARY KEY,args_hash TEXT NOT NULL,outcome TEXT NOT NULL,result TEXT); INSERT INTO operations VALUES('old-success','hash','succeeded','result'),('old-unknown','hash','unknown',NULL); PRAGMA user_version=4",
    );
    store.close();
    closed = true;
    const upgraded = new Store(root);
    try {
      const ledger = new OperationLedger(upgraded);
      expect(ledger.get("old-success")).toMatchObject({
        phase: "settled",
        outcome: "succeeded",
        result: "result",
        context: null,
      });
      expect(ledger.get("old-unknown")).toMatchObject({
        phase: "dispatched",
        outcome: "unknown",
        result: null,
        context: null,
      });
      expect(upgraded.db.prepare("PRAGMA user_version").get()).toMatchObject({
        user_version: 6,
      });
    } finally {
      upgraded.close();
    }
  } finally {
    if (!closed) store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T-008 restart settles only undispatched owned operations and cleanup rolls back with Work failure", async () => {
  const { WorkService } = await import("../apps/daemon/src/work-service.js");
  const { root, store, work, ledger } = setup();
  let closed = false;
  try {
    const prepared = ledger.prepare(work, "prepared", "write_sample", {}, "f");
    const authorized = ledger.transition(
      work,
      ledger.prepare(work, "authorized", "write_sample", {}, "f"),
      "authorized",
      "not_executed",
    );
    const dispatched = ledger.transition(
      work,
      ledger.transition(
        work,
        ledger.prepare(work, "dispatched", "write_sample", {}, "f"),
        "authorized",
        "not_executed",
      ),
      "dispatched",
      "unknown",
    );
    const eventCount = store.eventsForWork(work.id).length;
    expect(() =>
      ledger.finishUndispatched(work, "stopped", () => {
        throw Error("work commit failed");
      }),
    ).toThrow("work commit failed");
    expect(ledger.get(prepared.id)).toEqual(prepared);
    expect(ledger.get(authorized.id)).toEqual(authorized);
    expect(store.eventsForWork(work.id)).toHaveLength(eventCount);
    store.close();
    closed = true;
    const recovered = new WorkService(root);
    try {
      expect(recovered.store.get(work.id).status).toBe("blocked");
      expect(recovered.operations.get(prepared.id)).toMatchObject({
        phase: "settled",
        outcome: "not_executed",
      });
      expect(recovered.operations.get(authorized.id)).toMatchObject({
        phase: "settled",
        outcome: "not_executed",
      });
      expect(recovered.operations.get(dispatched.id)).toEqual(dispatched);
    } finally {
      await recovered.close();
    }
  } finally {
    if (!closed) store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
