import { expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Store } from "../apps/daemon/src/store.js";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { createApp } from "../apps/daemon/src/http.js";
import type { Work } from "../packages/contracts/src/index.js";

function work(): Work {
  return {
    id: randomUUID(),
    runId: randomUUID(),
    executionSessionId: randomUUID(),
    requestId: randomUUID(),
    text: "Synthetic",
    transport: "http",
    mode: "fixture",
    runMode: "normal",
    status: "queued",
    revision: 1,
    answer: "",
    createdAt: new Date().toISOString(),
  };
}
function worker(root: string, mode: string) {
  const child = fork(
    fileURLToPath(
      new URL("../fixtures/persistence/crash-worker.ts", import.meta.url),
    ),
    [root, mode],
    {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk).slice(0, 4000);
  });
  const exit = new Promise<number | null>((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
  const message = new Promise<{ status: string; workId?: string }>(
    (resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Child fixture timed out: " + stderr)),
        10000,
      );
      timer.unref();
      child.once("message", (value) => {
        clearTimeout(timer);
        resolve(value as { status: string; workId?: string });
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", () => clearTimeout(timer));
    },
  );
  return { child, exit, message };
}

test("T-006 stale CAS and transaction failure cannot partially change Work, events or outbox", () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-cas-")),
    store = new Store(root);
  try {
    const initial = work();
    store.add(initial, "fixture");
    const newer = { ...initial, revision: 2, status: "running" as const };
    store.transaction(() => {
      store.save(newer, 1);
      store.event(newer, "rocky.work.updated", { work: newer });
    });
    expect(() =>
      store.save({ ...initial, revision: 2, status: "cancelled" }, 1),
    ).toThrow("revision changed");
    expect(() =>
      store.save({ ...newer, revision: 3, runId: randomUUID() }, 2),
    ).toThrow("revision changed");
    expect(() =>
      store.transaction(() => {
        const changed = { ...newer, revision: 3, status: "completed" as const };
        store.save(changed, 2);
        store.event(changed, "rocky.work.updated", { work: changed });
        throw Error("Injected commit failure");
      }),
    ).toThrow("Injected");
    expect(store.get(initial.id)).toEqual(newer);
    expect(store.events()).toHaveLength(1);
    expect(store.db.prepare("SELECT * FROM outbox").all()).toHaveLength(1);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T-006 outbox replay after acknowledgement failure creates one completion and no new operations", () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-outbox-"));
  let store = new Store(root);
  try {
    const completed = {
      ...work(),
      status: "completed" as const,
      answer: "Synthetic result",
    };
    store.transaction(() => {
      store.add(completed, "fixture");
      store.event(completed, "rocky.work.updated", { work: completed });
    });
    let deliveries = 0;
    expect(() =>
      store.dispatchOutbox(() => {
        deliveries++;
        throw Error("Lost acknowledgement");
      }),
    ).toThrow("Lost acknowledgement");
    store.close();
    store = new Store(root);
    expect(
      store.dispatchOutbox(() => {
        deliveries++;
      }),
    ).toBe(1);
    expect(deliveries).toBe(2);
    expect(store.completions().messages.map((m) => m.id)).toEqual([
      "work-result:" + completed.id,
    ]);
    // Simulate a repeated delivery after projection commit by resetting only its acknowledgement.
    store.db.exec("UPDATE outbox SET delivered_at=NULL");
    store.dispatchOutbox(() => {});
    expect(store.completions().messages).toHaveLength(1);
    expect(store.db.prepare("SELECT * FROM operations").all()).toHaveLength(0);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T-006 an outbox write failure rolls back the operation ledger and its event together", () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-outbox-fault-")),
    store = new Store(root);
  try {
    const current = work();
    store.add(current, "fixture");
    store.db.exec(
      "CREATE TEMP TRIGGER fail_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT,'Injected outbox write failure'); END",
    );
    expect(() =>
      store.transaction(() => {
        store.db
          .prepare(
            "INSERT INTO operations(id,args_hash,outcome,result) VALUES(?,?,?,NULL)",
          )
          .run(current.runId + ":synthetic", "synthetic-hash", "unknown");
        store.event(current, "rocky.operation.dispatched", {
          name: "synthetic",
        });
      }),
    ).toThrow("Injected outbox write failure");
    expect(store.db.prepare("SELECT * FROM operations").all()).toHaveLength(0);
    expect(store.events()).toHaveLength(0);
    expect(store.pendingDeliveries()).toBe(0);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T-006 actual child exits roll back uncommitted writes and preserve committed pending delivery", async () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-crash-"));
  const children: ReturnType<typeof worker>[] = [];
  try {
    const interrupted = worker(root, "uncommitted");
    children.push(interrupted);
    expect(await interrupted.exit).toBe(74);
    let store = new Store(root);
    expect(store.list()).toHaveLength(0);
    expect(store.events()).toHaveLength(0);
    store.close();
    const committed = worker(root, "committed");
    children.push(committed);
    const receipt = await committed.message;
    expect(await committed.exit).toBe(75);
    store = new Store(root);
    try {
      expect(store.completions().messages).toHaveLength(0);
      expect(store.dispatchOutbox(() => {})).toBe(1);
      expect(store.completions().messages[0]?.workId).toBe(receipt.workId);
    } finally {
      store.close();
    }
  } finally {
    for (const w of children) if (w.child.exitCode === null) w.child.kill();
    await Promise.all(children.map((w) => w.exit));
    rmSync(root, { recursive: true, force: true });
  }
});

test("T-006 simultaneous daemons cannot both recover a stale PID lock", async () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-lock-race-")),
    children: ReturnType<typeof worker>[] = [];
  try {
    const first = worker(root, "hold");
    children.push(first);
    expect((await first.message).status).toBe("ready");
    first.child.send("exit");
    await first.exit;
    const a = worker(root, "hold"),
      b = worker(root, "hold");
    children.push(a, b);
    const results = await Promise.all([a.message, b.message]);
    expect(results.map((r) => r.status).sort()).toEqual([
      "ready",
      "store_locked",
    ]);
    (results[0]!.status === "ready" ? a : b).child.send("exit");
    await Promise.all([a.exit, b.exit]);
    const recovered = new Store(root);
    recovered.close();
  } finally {
    for (const w of children) if (w.child.exitCode === null) w.child.kill();
    await Promise.all(children.map((w) => w.exit));
    rmSync(root, { recursive: true, force: true });
  }
});

test("T-006 durable completion API pages stable sequences without skipping or duplicating results", async () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-completion-page-")),
    service = new WorkService(root);
  try {
    service.store.transaction(() => {
      for (let i = 0; i < 105; i++) {
        const completed = {
          ...work(),
          status: "completed" as const,
          answer: "Synthetic result " + i,
        };
        service.store.add(completed, "fixture");
        service.store.event(completed, "rocky.work.updated", {
          work: completed,
        });
      }
    });
    expect(service.store.pendingDeliveries()).toBe(105);
    expect(service.store.dispatchOutbox(() => {})).toBe(100);
    expect(service.store.pendingDeliveries()).toBe(5);
    service.store.dispatchOutbox(() => {});
    const app = createApp(service),
      headers = { host: "127.0.0.1:3211" };
    let cursor: string | null = null;
    const ids: string[] = [];
    do {
      const response = await app.request(
        "/api/v1/conversation/messages?limit=50" +
          (cursor ? "&before=" + cursor : ""),
        { headers },
      );
      expect(response.status).toBe(200);
      const page = await response.json();
      ids.push(...page.messages.map((m: { id: string }) => m.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(ids).toHaveLength(105);
    expect(new Set(ids).size).toBe(105);
    expect(
      (
        await app.request("/api/v1/conversation/messages?limit=101", {
          headers,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request("/api/v1/conversation/messages?before=invalid", {
          headers,
        })
      ).status,
    ).toBe(400);
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});
