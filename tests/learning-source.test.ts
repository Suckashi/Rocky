import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../apps/daemon/src/store.js";
import { WorkspaceRegistry } from "../apps/daemon/src/workspaces.js";
import { LearningRegistry } from "../apps/daemon/src/learning.js";
import { workSchema } from "../packages/contracts/src/index.js";
test("Learning source consent excludes private, nonnormal, noncompleted and unauthorized scopes", async () => {
  const root = await mkdtemp(join(tmpdir(), "rocky-learning-source-"));
  let store = new Store(root);
  try {
    let learning = new LearningRegistry(store, new WorkspaceRegistry(store));
    const make = (extra: Record<string, unknown> = {}) => {
      const w = workSchema.parse({
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
        answer: "Success is not evidence",
        createdAt: new Date().toISOString(),
        ...extra,
      });
      store.add(w, w.id);
      return w;
    };
    const command = {
      requestId: randomUUID(),
      expectedRevision: 0,
      private: false,
      excluded: false,
      sourceReuseAllowed: true,
    };
    const ordinary = make();
    expect(learning.workConsent(ordinary.id).excluded).toBe(true);
    expect(() => learning.assertSourceAllowed(ordinary.id, "manual")).toThrow(
      "consent",
    );
    const accepted = learning.saveWorkConsent(ordinary.id, command);
    expect(
      learning.assertSourceAllowed(ordinary.id, "manual").policy.mode,
    ).toBe("off");
    expect(() =>
      learning.assertSourceAllowed(ordinary.id, "automatic"),
    ).toThrow("scope");
    learning.savePolicy({
      requestId: randomUUID(),
      expectedRevision: 0,
      mode: "propose",
      scopes: [{ kind: "user" }],
      consent: true,
    });
    expect(
      learning.assertSourceAllowed(ordinary.id, "automatic").consent,
    ).toEqual(accepted);
    for (const extra of [
      { runMode: "evaluation" },
      { runMode: "unknown" },
      { status: "cancelled" },
      { status: "running" },
      { workspaceId: randomUUID() },
    ]) {
      const work = make(extra);
      learning.saveWorkConsent(work.id, {
        ...command,
        requestId: randomUUID(),
      });
      expect(() =>
        learning.assertSourceAllowed(work.id, "automatic"),
      ).toThrow();
    }
    for (const patch of [
      { private: true },
      { excluded: true },
      { sourceReuseAllowed: false },
    ]) {
      const work = make();
      learning.saveWorkConsent(work.id, {
        ...command,
        requestId: randomUUID(),
        ...patch,
      });
      expect(() => learning.assertSourceAllowed(work.id, "manual")).toThrow(
        "consent",
      );
    }
    const revoked = learning.saveWorkConsent(ordinary.id, {
      ...command,
      requestId: randomUUID(),
      expectedRevision: 1,
      excluded: true,
    });
    expect(learning.saveWorkConsent(ordinary.id, command)).toEqual(accepted);
    expect(learning.workConsent(ordinary.id)).toEqual(revoked);
    expect(() =>
      learning.saveWorkConsent(ordinary.id, {
        ...command,
        requestId: randomUUID(),
      }),
    ).toThrow("changed");
    const privateWork = make();
    learning.saveWorkConsent(privateWork.id, {
      ...command,
      requestId: randomUUID(),
    });
    store.db
      .prepare("INSERT INTO capability_grants VALUES(?,?,?,?)")
      .run(
        randomUUID(),
        randomUUID(),
        "fixture",
        JSON.stringify({
          workId: privateWork.id,
          memory: { includePrivate: true },
          revoked: true,
        }),
      );
    expect(() =>
      learning.assertSourceAllowed(privateWork.id, "manual"),
    ).toThrow("private memory");
    store.close();
    store = new Store(root);
    learning = new LearningRegistry(store, new WorkspaceRegistry(store));
    expect(learning.workConsent(ordinary.id)).toEqual(revoked);
    expect(() => learning.assertSourceAllowed(ordinary.id, "manual")).toThrow(
      "consent",
    );
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
