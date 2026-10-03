import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../apps/daemon/src/store.js";
import { WorkspaceRegistry } from "../apps/daemon/src/workspaces.js";
import { LearningRegistry } from "../apps/daemon/src/learning.js";
import { workSchema } from "../packages/contracts/src/index.js";
test("episode review binds redacted view hash, source consent and durable decision receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "rocky-episode-review-"));
  let store = new Store(root);
  try {
    let learning = new LearningRegistry(store, new WorkspaceRegistry(store));
    const work = workSchema.parse({
      id: randomUUID(),
      runId: randomUUID(),
      executionSessionId: randomUUID(),
      requestId: randomUUID(),
      text: "Fixture",
      transport: "http",
      mode: "fixture",
      runMode: "normal",
      status: "completed",
      revision: 1,
      answer: "",
      createdAt: new Date().toISOString(),
    });
    store.add(work, work.id);
    const event = store.event(work, "rocky.tool.completed", {
      name: "read_file",
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
    const created = learning.createEpisode({
      requestId: randomUUID(),
      workId: work.id,
      expectedPolicyRevision: 0,
      expectedConsentRevision: 1,
      trigger: "manual_request",
      goal: "Review marker",
      constraints: [],
      corrections: [],
      verification: [],
      failuresAndRepairs: [],
      preconditions: [],
      evidenceEventIds: [event.id],
    });
    const id = String(created.id),
      command = {
        requestId: randomUUID(),
        expectedRevision: 1,
        contentHash: created.contentHash,
        decision: "approve",
      };
    expect(() =>
      learning.reviewEpisode(id, { ...command, contentHash: "0".repeat(64) }),
    ).toThrow("changed");
    const originalRedactor = store.publicEvidence;
    store.publicEvidence = (value) =>
      JSON.parse(
        JSON.stringify(value).replaceAll("Review marker", "[REDACTED]"),
      );
    expect(() => learning.reviewEpisode(id, command)).toThrow("changed");
    store.publicEvidence = originalRedactor;
    const receipt = learning.reviewEpisode(id, command);
    expect(receipt).toMatchObject({
      id,
      status: "approved",
      revision: 2,
      reviewedHash: created.contentHash,
    });
    expect(learning.reviewEpisode(id, command)).toEqual(receipt);
    expect(() =>
      learning.reviewEpisode(id, {
        ...command,
        requestId: randomUUID(),
        decision: "reject",
      }),
    ).toThrow("changed");
    expect(learning.episode(id).status).toBe("approved");
    store.publicEvidence = (value) =>
      JSON.parse(
        JSON.stringify(value).replaceAll("Review marker", "[REDACTED]"),
      );
    const changed = learning.episode(id);
    expect(changed.status).toBe("needs_review");
    expect(learning.episodes().items).toContainEqual(changed);
    expect(() =>
      learning.reviewEpisode(id, {
        ...command,
        requestId: randomUUID(),
        expectedRevision: 2,
      }),
    ).toThrow("changed");
    expect(learning.reviewEpisode(id, command)).toEqual(receipt);
    expect(learning.episode(id).status).toBe("needs_review");
    const renewed = learning.reviewEpisode(id, {
      requestId: randomUUID(),
      expectedRevision: changed.revision,
      contentHash: changed.contentHash,
      decision: "approve",
    });
    expect(renewed).toMatchObject({
      status: "approved",
      revision: 3,
      reviewedHash: changed.contentHash,
    });
    expect(learning.episode(id).status).toBe("approved");
    store.publicEvidence = originalRedactor;

    const rejectedId = randomUUID();
    const raw = JSON.parse(
      (
        store.db
          .prepare("SELECT data FROM learning_episodes WHERE id=?")
          .get(id) as { data: string }
      ).data,
    );
    store.db.prepare("INSERT INTO learning_episodes VALUES(?,?,?,?,?)").run(
      rejectedId,
      randomUUID(),
      randomUUID(),
      "review fixture",
      JSON.stringify({
        ...raw,
        id: rejectedId,
        revision: 1,
        status: "pending_review",
      }),
    );
    const rejectView = learning.episode(rejectedId);
    const rejected = learning.reviewEpisode(rejectedId, {
      requestId: randomUUID(),
      expectedRevision: 1,
      contentHash: rejectView.contentHash,
      decision: "reject",
    });
    expect(rejected).toMatchObject({ status: "rejected", revision: 2 });
    expect(learning.episode(rejectedId).status).toBe("rejected");

    store.close();
    store = new Store(root);
    learning = new LearningRegistry(store, new WorkspaceRegistry(store));
    expect(learning.reviewEpisode(id, command)).toEqual(receipt);
    learning.saveWorkConsent(work.id, {
      requestId: randomUUID(),
      expectedRevision: 1,
      private: true,
      excluded: true,
      sourceReuseAllowed: false,
    });
    expect(() => learning.episode(id)).toThrow("consent");
    expect(learning.reviewEpisode(id, command)).toEqual(receipt);
    expect(() =>
      learning.reviewEpisode(id, { ...command, requestId: randomUUID() }),
    ).toThrow("consent");
    expect(
      String(
        (
          store.db
            .prepare("SELECT data FROM learning_episodes WHERE id=?")
            .get(id) as { data: string }
        ).data,
      ),
    ).not.toContain("Review marker");
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
