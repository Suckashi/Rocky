import { test, expect, vi } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { createApp } from "../apps/daemon/src/http.js";
import { intentHash } from "../apps/daemon/src/intent.js";
test("owner memory scopes, locks, CAS, bilingual search, atomic deletion and restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "rocky-memory-"));
  let service = new WorkService(join(root, "data"));
  try {
    const project = join(root, "project");
    await mkdir(project);
    const workspace = await service.workspaces.save({
      requestId: randomUUID(),
      id: randomUUID(),
      expectedRevision: 0,
      name: "Memory scope",
      root: project,
    });
    const command = {
      requestId: randomUUID(),
      id: randomUUID(),
      expectedRevision: 0,
      scope: { kind: "user" as const },
      content: "偏好繁體中文；concise engineering reports",
    };
    const receipt = service.memories.save(command);
    expect(
      (
        service.store.db
          .prepare("SELECT intent FROM memory_receipts WHERE request_id=?")
          .get(command.requestId) as { intent: string }
      ).intent,
    ).toBe(
      intentHash({
        kind: "save",
        ...command,
        private: true,
        status: "unverified",
      }),
    );
    expect(service.memories.save(command)).toEqual(receipt);
    expect(service.memories.get(command.id)).toMatchObject({
      locked: true,
      userEdited: true,
      source: "owner",
      private: true,
      status: "unverified",
      revision: 1,
    });
    for (const query of ["繁體", "ENGINEERING", "concise"])
      expect(
        service.memories
          .search({ scope: command.scope, query })
          .items.map((m) => m.id),
      ).toEqual([command.id]);
    const scoped = {
      ...command,
      requestId: randomUUID(),
      id: randomUUID(),
      scope: { kind: "project" as const, id: workspace.id },
      content: "專案專用 engineering",
    };
    service.memories.save(scoped);
    expect(
      service.memories.search({ scope: command.scope, query: "專案" }).items,
    ).toEqual([]);
    expect(
      service.memories
        .search({ scope: scoped.scope, query: "engineering" })
        .items.map((m) => m.id),
    ).toEqual([scoped.id]);
    expect(() =>
      service.memories.search({ scope: { kind: "task", id: randomUUID() } }),
    ).toThrow();
    expect(() =>
      service.memories.save({
        ...command,
        requestId: randomUUID(),
        content: "stale",
      }),
    ).toThrow("revision");
    expect(() =>
      service.memories.save({
        ...command,
        requestId: randomUUID(),
        expectedRevision: 1,
        scope: scoped.scope,
      }),
    ).toThrow("Scope");
    service.memories.save({
      ...command,
      requestId: randomUUID(),
      expectedRevision: 1,
      content: "更新後 new preference",
    });
    expect(
      service.memories.search({ scope: command.scope, query: "engineering" })
        .items,
    ).toEqual([]);
    expect(
      service.memories.search({ scope: command.scope, query: "更新" }).items,
    ).toHaveLength(1);
    const bounded = {
      ...command,
      id: randomUUID(),
      requestId: randomUUID(),
      content: "字".repeat(100),
    };
    service.memories.save(bounded);
    expect(
      service.memories.search({
        scope: command.scope,
        query: "字",
        byteBudget: 128,
      }),
    ).toMatchObject({ items: [], truncated: true, contentBytes: 0 });
    const transact = service.store.transaction.bind(service.store),
      inject = vi
        .spyOn(service.store, "transaction")
        .mockImplementationOnce((fn) =>
          transact(() => {
            fn();
            throw Error("Injected rollback");
          }),
        );
    const deletion = { requestId: randomUUID(), expectedRevision: 2 };
    expect(() => service.memories.delete(command.id, deletion)).toThrow(
      "Injected",
    );
    inject.mockRestore();
    expect(
      service.memories.search({ scope: command.scope, query: "更新" }).items,
    ).toHaveLength(1);
    const removed = service.memories.delete(command.id, deletion);
    expect(service.memories.delete(command.id, deletion)).toEqual(removed);
    expect(
      service.memories.search({ scope: command.scope, query: "更新" }).items,
    ).toEqual([]);
    expect(
      service.store.db
        .prepare("SELECT id FROM memory_fts WHERE id=?")
        .get(command.id),
    ).toBeUndefined();
    expect(() =>
      service.memories.save({ ...command, requestId: randomUUID() }),
    ).toThrow("cannot be reused");
    expect(
      JSON.stringify(
        service.store.db.prepare("SELECT * FROM memory_receipts").all(),
      ),
    ).not.toContain("更新後");
    const app = createApp(service),
      host = { host: "127.0.0.1:3211" };
    expect(
      (
        await app.request("/api/v1/memories/search", {
          method: "POST",
          headers: host,
          body: JSON.stringify({ scope: scoped.scope }),
        })
      ).status,
    ).toBe(403);
    const session = await (
      await app.request("/api/v1/session", { headers: host })
    ).json();
    const response = await app.request("/api/v1/memories/search", {
      method: "POST",
      headers: {
        ...host,
        "x-rocky-session": session.token,
        "content-type": "application/json",
      },
      body: JSON.stringify({ scope: scoped.scope, query: "專用" }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).items[0].id).toBe(scoped.id);
    await service.close();
    service = new WorkService(join(root, "data"));
    expect(
      service.memories.search({ scope: scoped.scope, query: "專用" }).items,
    ).toHaveLength(1);
    expect(() => service.memories.get(command.id)).toThrow("not found");
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
