import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../apps/daemon/src/store.js";
import { WorkspaceRegistry } from "../apps/daemon/src/workspaces.js";
import { LearningRegistry } from "../apps/daemon/src/learning.js";
import { workSchema } from "../packages/contracts/src/index.js";
import { z } from "zod";
test("manual episodes retain bounded provenance, redact summaries, dedupe and obey withdrawal", async () => {
  const root = await mkdtemp(join(tmpdir(), "rocky-episode-"));
  let store = new Store(root);
  try {
    let learning = new LearningRegistry(store, new WorkspaceRegistry(store));
    const make = () => {
      const work = workSchema.parse({
        id: randomUUID(),
        runId: randomUUID(),
        executionSessionId: randomUUID(),
        requestId: randomUUID(),
        text: "private unselected transcript",
        transport: "http",
        mode: "fixture",
        runMode: "normal",
        status: "completed",
        revision: 1,
        answer: "Unselected answer",
        createdAt: new Date().toISOString(),
      });
      store.add(work, work.id);
      const event = store.event(work, "rocky.tool.completed", {
        name: "read_file",
        unselected: "Do not copy this result",
      });
      store.event(work, "rocky.work.updated", { work });
      store.dispatchOutbox(() => {});
      learning.saveWorkConsent(work.id, {
        requestId: randomUUID(),
        expectedRevision: 0,
        private: false,
        excluded: false,
        sourceReuseAllowed: true,
      });
      return { work, event };
    };
    const { work, event } = make(),
      other = make();
    const command = {
      requestId: randomUUID(),
      workId: work.id,
      expectedPolicyRevision: 0,
      expectedConsentRevision: 1,
      trigger: "manual_request",
      goal: "Reusable workflow password=fixture-secret",
      constraints: [],
      corrections: [],
      verification: ["Owner-selected result; not an evaluation verdict"],
      failuresAndRepairs: [],
      preconditions: ["Windows fixture only"],
      evidenceEventIds: [event.id],
    };
    expect(() =>
      learning.createEpisode({
        ...command,
        evidenceEventIds: [other.event.id],
      }),
    ).toThrow("outside");
    expect(() =>
      learning.createEpisode({ ...command, expectedConsentRevision: 2 }),
    ).toThrow("changed");
    const late = store.event(work, "rocky.tool.completed", { name: "late" });
    expect(() =>
      learning.createEpisode({ ...command, evidenceEventIds: [late.id] }),
    ).toThrow("outside");
    const episode = learning.createEpisode(command),
      id = z.object({ id: z.uuid() }).parse(episode).id;
    const serialized = JSON.stringify(episode);
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).not.toContain("fixture-secret");
    expect(serialized).not.toContain("unselected");
    expect(serialized).not.toContain("Unselected answer");
    expect(episode).toMatchObject({
      workId: work.id,
      sourceRunId: work.runId,
      learningPolicyRevision: 0,
      status: "pending_review",
      evidence: [{ id: event.id }],
    });
    expect(learning.createEpisode(command)).toEqual(episode);
    expect(() =>
      learning.createEpisode({ ...command, requestId: randomUUID() }),
    ).toThrow("already exists");
    expect(() =>
      learning.createEpisode({ ...command, goal: "changed" }),
    ).toThrow("request changed");
    const raw = String(
      (
        store.db
          .prepare("SELECT data FROM learning_episodes WHERE id=?")
          .get(id) as { data: string }
      ).data,
    );
    expect(raw).not.toContain("fixture-secret");
    expect(learning.episodes().items).toEqual([episode]);
    expect(() => learning.episodes("-1")).toThrow("cursor");
    for (let i = 0; i < 21; i++) {
      const copy = {
        ...z.object({}).passthrough().parse(episode),
        id: randomUUID(),
      };
      store.db
        .prepare("INSERT INTO learning_episodes VALUES(?,?,?,?,?)")
        .run(
          copy.id,
          randomUUID(),
          randomUUID(),
          "pagination fixture",
          JSON.stringify(copy),
        );
    }
    const firstPage = learning.episodes();
    expect(firstPage.items).toHaveLength(20);
    expect(firstPage.nextCursor).not.toBeNull();
    const lastPage = learning.episodes(firstPage.nextCursor!);
    expect(lastPage.items).toHaveLength(2);
    expect(lastPage.nextCursor).toBeNull();

    store.close();
    store = new Store(root);
    learning = new LearningRegistry(store, new WorkspaceRegistry(store));
    expect(learning.episode(id)).toEqual(episode);
    const withdraw = {
      requestId: randomUUID(),
      expectedRevision: 1,
      private: false,
      excluded: true,
      sourceReuseAllowed: false,
    };
    store.db.exec(
      "CREATE TRIGGER fail_episode_withdrawal BEFORE UPDATE ON learning_episodes BEGIN SELECT RAISE(ABORT,'fixture withdrawal failure'); END",
    );
    expect(() => learning.saveWorkConsent(work.id, withdraw)).toThrow(
      "fixture withdrawal failure",
    );
    expect(learning.workConsent(work.id).revision).toBe(1);
    expect(learning.episode(id)).toEqual(episode);
    store.db.exec("DROP TRIGGER fail_episode_withdrawal");
    learning.saveWorkConsent(work.id, withdraw);
    expect(() => learning.episode(id)).toThrow("consent");
    expect(() => learning.createEpisode(command)).toThrow("consent");
    const tombstone = JSON.parse(
      (
        store.db
          .prepare("SELECT data FROM learning_episodes WHERE id=?")
          .get(id) as { data: string }
      ).data,
    );
    expect(tombstone).toMatchObject({
      id,
      status: "withdrawn",
      withdrawalConsentRevision: 2,
    });
    expect(learning.episodes().items).toEqual([]);
    expect(tombstone).not.toHaveProperty("summary");
    expect(tombstone).not.toHaveProperty("evidence");
    learning.saveWorkConsent(work.id, {
      requestId: randomUUID(),
      expectedRevision: 2,
      private: false,
      excluded: false,
      sourceReuseAllowed: true,
    });
    expect(() => learning.episode(id)).toThrow("withdrawn");
    expect(() => learning.createEpisode(command)).toThrow("withdrawn");
    learning.saveWorkConsent(work.id, withdraw);
    expect(learning.workConsent(work.id).excluded).toBe(false);
    store.close();
    store = new Store(root);
    learning = new LearningRegistry(store, new WorkspaceRegistry(store));
    expect(() => learning.episode(id)).toThrow("withdrawn");
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
