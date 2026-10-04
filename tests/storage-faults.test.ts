import { test, expect, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join, relative, resolve, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { AIMessage } from "@langchain/core/messages";
import { Store } from "../apps/daemon/src/store.js";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { createApp } from "../apps/daemon/src/http.js";
import { workSchema } from "../packages/contracts/src/index.js";
import { startAgentProvider } from "../fixtures/models/agent-provider.js";

async function cleanup(root: string) {
  const rel = relative(resolve(tmpdir()), resolve(root));
  if (!rel || rel.startsWith("..") || isAbsolute(rel))
    throw Error("Unsafe test cleanup");
  await rm(root, { recursive: true, force: true });
}

test.each(["full", "busy", "journal"] as const)(
  "storage %s cannot commit a partial completed Work or outbox",
  async (mode) => {
    const root = await mkdtemp(join(tmpdir(), "rocky-storage-fault-")),
      store = new Store(root);
    let second: DatabaseSync | undefined;
    let restore = () => {};
    try {
      const work = workSchema.parse({
        id: randomUUID(),
        runId: randomUUID(),
        executionSessionId: randomUUID(),
        requestId: randomUUID(),
        text: "Bounded storage fixture",
        transport: "http",
        mode: "fixture",
        runMode: "normal",
        kind: "background",
        status: "running",
        revision: 1,
        answer: "",
        createdAt: new Date().toISOString(),
      });
      store.add(work, work.id);
      store.db.exec("CREATE TABLE fault_bytes(value BLOB)");
      if (mode === "full") {
        const pages = (
          store.db.prepare("PRAGMA page_count").get() as { page_count: number }
        ).page_count;
        store.db.exec(`PRAGMA max_page_count=${pages + 1}`);
      } else if (mode === "busy") {
        store.db.exec("PRAGMA busy_timeout=1");
        second = new DatabaseSync(join(root, "domain.sqlite"));
        second.exec("BEGIN IMMEDIATE");
      } else {
        const exec = store.db.exec.bind(store.db);
        const spy = vi.spyOn(store.db, "exec").mockImplementation((sql) => {
          if (sql === "COMMIT")
            throw Object.assign(new Error("Injected journal write failure"), {
              code: "SQLITE_IOERR",
            });
          exec(sql);
        });
        restore = () => spy.mockRestore();
      }
      const completed = {
        ...work,
        status: "completed" as const,
        revision: 2,
        answer: "Must not commit",
      };
      expect(() =>
        store.transaction(() => {
          store.save(completed, 1);
          store.event(completed, "rocky.work.updated", { work: completed });
          if (mode === "full")
            store.db
              .prepare("INSERT INTO fault_bytes VALUES(?)")
              .run(Buffer.alloc(2097152));
        }),
      ).toThrow(
        mode === "full" ? /full/i : mode === "busy" ? /locked/i : /journal/i,
      );
      restore();
      second?.exec("ROLLBACK");
      expect(store.db.isTransaction).toBe(false);
      expect(store.get(work.id).status).toBe("running");
      expect(store.eventsForWork(work.id)).toEqual([]);
      expect(
        store.db.prepare("SELECT count(*) AS n FROM completion_messages").get(),
      ).toEqual({ n: 0 });
    } finally {
      restore();
      second?.close();
      store.close();
      await cleanup(root);
    }
  },
);

test("terminal persistence failure stops further execution and reports volatile degradation instead of success", async () => {
  const root = await mkdtemp(join(tmpdir(), "rocky-storage-runtime-")),
    service = new WorkService(root);
  const provider = await startAgentProvider({
    reply: async () => new AIMessage("Observed fixture response"),
  });
  const save = service.store.save.bind(service.store);
  const spy = vi
    .spyOn(service.store, "save")
    .mockImplementation((work, revision) => {
      if (work.status === "completed")
        throw Object.assign(new Error("Injected full storage"), {
          code: "SQLITE_FULL",
        });
      return save(work, revision);
    });
  try {
    const connectionId = randomUUID();
    service.models.save({
      id: connectionId,
      requestId: randomUUID(),
      expectedRevision: 0,
      config: {
        name: "Storage fixture model",
        provider: "openai-compatible",
        baseUrl: provider.baseUrl,
        modelId: "fixture",
        contextWindowTokens: 65536,
        maxOutputTokens: 128,
      },
    });
    const work = service.submit({
      requestId: randomUUID(),
      text: "Bounded persistence fault",
      mode: "configured",
      modelSelection: { connectionId, revision: 1 },
    });
    // Includes an actual Node worker startup and local model round trip.
    await expect
      .poll(() => service.executionError, { timeout: 10000 })
      .not.toBeNull();
    expect(service.store.get(work.id).status).not.toBe("completed");
    expect(
      service.store
        .eventsForWork(work.id)
        .some(
          (event) =>
            event.payload.kind === "domain" &&
            event.payload.name === "rocky.work.updated" &&
            (event.payload.data.work as { status: string }).status ===
              "completed",
        ),
    ).toBe(false);
    expect(() =>
      service.submit({
        requestId: randomUUID(),
        text: "Must not start",
        mode: "fixture",
      }),
    ).toThrow("disabled");
    const response = await createApp(service).request(
      "http://127.0.0.1:3211/api/v1/health",
      { headers: { host: "127.0.0.1:3211" } },
    );
    expect(await response.json()).toMatchObject({
      status: "degraded",
      execution: { error: expect.stringContaining("restart") },
    });
  } finally {
    spy.mockRestore();
    await provider.close();
    await service.close();
    await cleanup(root);
  }
});
