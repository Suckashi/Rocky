import { test, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { createApp } from "../apps/daemon/src/http.js";

test("owner imports untrusted immutable skill revisions with CAS, receipts, rollback and reopen", async () => {
  const root = await mkdtemp(join(tmpdir(), "rocky-skills-"));
  let service = new WorkService(root);
  const command = {
    requestId: randomUUID(),
    id: randomUUID(),
    expectedRevision: 0,
    scope: { kind: "user" },
    source: {
      type: "manual",
      reference: "fixture/example-skill",
      license: "MIT",
    },
    package: {
      directoryName: "example-skill",
      files: [
        {
          path: "SKILL.md",
          contentBase64: Buffer.from(
            "---\nname: example-skill\ndescription: Use for fixture testing\n---\nInstructions",
          ).toString("base64"),
        },
      ],
    },
  };
  try {
    const app = createApp(service),
      host = { host: "127.0.0.1:3211" };
    expect(
      (
        await app.request("/api/v1/skills/import", {
          method: "POST",
          headers: host,
          body: JSON.stringify(command),
        })
      ).status,
    ).toBe(403);
    const session = await (
      await app.request("/api/v1/session", { headers: host })
    ).json();
    const response = await app.request("/api/v1/skills/import", {
      method: "POST",
      headers: {
        ...host,
        "content-type": "application/json",
        "x-rocky-session": session.token,
      },
      body: JSON.stringify(command),
    });
    expect(response.status).toBe(200);
    const first = await response.json();
    expect(first).toMatchObject({
      state: "untrusted",
      revision: 1,
      id: command.id,
    });
    expect(first).not.toHaveProperty("activeRevision");
    expect(service.skills.import(command)).toEqual(first);
    expect(() =>
      service.skills.import({
        ...command,
        source: { ...command.source, license: "Changed" },
      }),
    ).toThrow("changed");
    expect(() =>
      service.skills.import({ ...command, requestId: randomUUID() }),
    ).toThrow("revision");
    const next = {
      ...command,
      requestId: randomUUID(),
      expectedRevision: 1,
      package: {
        ...command.package,
        files: [
          ...command.package.files,
          {
            path: "references/readme.md",
            contentBase64: Buffer.from("New evidence").toString("base64"),
          },
        ],
      },
    };
    const second = service.skills.import(next);
    expect(second.contentHash).not.toBe(first.contentHash);
    expect(service.skills.get(command.id, 1).revision).toEqual(first);
    expect(service.skills.list()).toEqual([second]);
    const transact = service.store.transaction.bind(service.store);
    vi.spyOn(service.store, "transaction").mockImplementationOnce((fn) =>
      transact(() => {
        fn();
        throw Error("Injected rollback");
      }),
    );
    expect(() =>
      service.skills.import({
        ...next,
        requestId: randomUUID(),
        expectedRevision: 2,
      }),
    ).toThrow("rollback");
    expect(service.skills.list()).toEqual([second]);
    expect(
      service.store.db.prepare("SELECT * FROM skill_import_receipts").all(),
    ).toHaveLength(2);
    await service.close();
    service = new WorkService(root);
    expect(service.skills.import(command)).toEqual(first);
    expect(service.skills.get(command.id, 2).revision).toEqual(second);
    const packageRow = service.store.db
      .prepare("SELECT data FROM skill_packages WHERE hash=?")
      .get(first.contentHash) as { data: string };
    const altered = JSON.parse(packageRow.data);
    altered.files[0].contentBase64 = Buffer.from("tampered").toString("base64");
    service.store.db
      .prepare("UPDATE skill_packages SET data=? WHERE hash=?")
      .run(JSON.stringify(altered), first.contentHash);
    expect(() => service.skills.get(command.id, 1)).toThrow();
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("schema 19 upgrades skill tables without changing owner memories", async () => {
  const root = await mkdtemp(join(tmpdir(), "rocky-skills-upgrade-"));
  let service = new WorkService(root);
  try {
    const id = randomUUID();
    service.memories.save({
      id,
      requestId: randomUUID(),
      expectedRevision: 0,
      scope: { kind: "user" },
      content: "Preserve across upgrade",
    });
    // Reconstruct the previous schema in this isolated test database only.
    service.store.db.exec(
      "DROP TABLE skill_heads; DROP TABLE skill_revisions; DROP TABLE skill_packages; DROP TABLE skill_import_receipts; PRAGMA user_version=19;",
    );
    await service.close();
    service = new WorkService(root);
    expect(service.store.db.prepare("PRAGMA user_version").get()).toMatchObject(
      { user_version: 20 },
    );
    expect(service.memories.get(id).content).toBe("Preserve across upgrade");
    expect(service.skills.list()).toEqual([]);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
