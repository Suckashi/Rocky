import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { createApp } from "../apps/daemon/src/http.js";

test("exact owner selection, independent import head, rollback, quarantine and durable replay", async () => {
  const root = await mkdtemp(join(tmpdir(), "rocky-skill-selection-"));
  let service = new WorkService(root);
  try {
    const id = randomUUID();
    const importRevision = (expectedRevision: number, body: string) =>
      service.skills.import({
        requestId: randomUUID(),
        id,
        expectedRevision,
        scope: { kind: "user" },
        source: {
          type: "manual",
          reference: "fixture/example",
          license: "MIT",
        },
        package: {
          directoryName: "example",
          files: [
            {
              path: "SKILL.md",
              contentBase64: Buffer.from(
                `---\nname: example\ndescription: Test fixture\n---\n${body}`,
              ).toString("base64"),
            },
          ],
        },
      });
    const first = importRevision(0, "First");
    expect(service.skills.selection(id)).toBeNull();
    const command = {
      requestId: randomUUID(),
      expectedRevision: 0,
      skillRevision: 1,
      contentHash: first.contentHash,
      action: "publish",
    };
    const app = createApp(service),
      host = { host: "127.0.0.1:3211" };
    expect(
      (
        await app.request(`/api/v1/skills/${id}/selection`, {
          method: "POST",
          headers: host,
          body: JSON.stringify(command),
        })
      ).status,
    ).toBe(403);
    const session = await (
      await app.request("/api/v1/session", { headers: host })
    ).json();
    const result = await app.request(`/api/v1/skills/${id}/selection`, {
      method: "POST",
      headers: {
        ...host,
        "content-type": "application/json",
        "x-rocky-session": session.token,
      },
      body: JSON.stringify(command),
    });
    expect(result.status).toBe(200);
    const selected = await result.json();
    expect(selected).toMatchObject({
      revision: 1,
      skillRevision: 1,
      state: "published",
    });
    const second = importRevision(1, "Second");
    expect(service.skills.selection(id)).toEqual(selected);
    expect(() =>
      service.skills.select(id, { ...command, requestId: randomUUID() }),
    ).toThrow("revision");
    expect(() =>
      service.skills.select(id, {
        ...command,
        requestId: randomUUID(),
        expectedRevision: 1,
        contentHash: second.contentHash,
      }),
    ).toThrow("hash");
    service.skills.select(id, {
      ...command,
      requestId: randomUUID(),
      expectedRevision: 1,
      skillRevision: 2,
      contentHash: second.contentHash,
    });
    service.skills.select(id, {
      ...command,
      requestId: randomUUID(),
      expectedRevision: 2,
    });
    expect(service.skills.selection(id)).toMatchObject({
      revision: 3,
      skillRevision: 1,
      state: "published",
    });
    // Corruption must not prevent the owner from withdrawing a published selection.
    const stored = service.store.db
      .prepare("SELECT data FROM skill_packages WHERE hash=?")
      .get(first.contentHash) as { data: string };
    service.store.db
      .prepare("UPDATE skill_packages SET data='{}' WHERE hash=?")
      .run(first.contentHash);
    service.skills.select(id, {
      ...command,
      requestId: randomUUID(),
      expectedRevision: 3,
      action: "quarantine",
    });
    expect(service.skills.selection(id)?.state).toBe("quarantined");
    service.store.db
      .prepare("UPDATE skill_packages SET data=? WHERE hash=?")
      .run(stored.data, first.contentHash);
    expect(() =>
      service.skills.select(id, {
        ...command,
        requestId: randomUUID(),
        expectedRevision: 4,
      }),
    ).toThrow("Quarantined");
    service.skills.select(id, {
      ...command,
      requestId: randomUUID(),
      expectedRevision: 4,
      skillRevision: 2,
      contentHash: second.contentHash,
    });
    service.skills.select(id, {
      ...command,
      requestId: randomUUID(),
      expectedRevision: 5,
      skillRevision: 2,
      contentHash: second.contentHash,
      action: "deactivate",
    });
    await service.close();
    service = new WorkService(root);
    expect(service.skills.select(id, command)).toEqual(selected);
    expect(service.skills.selection(id)).toMatchObject({
      revision: 6,
      state: "inactive",
      skillRevision: 2,
    });
    expect(() =>
      service.skills.select(id, { ...command, action: "deactivate" }),
    ).toThrow("changed");
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
