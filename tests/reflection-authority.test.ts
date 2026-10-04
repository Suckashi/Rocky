import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../apps/daemon/src/store.js";
import { WorkspaceRegistry } from "../apps/daemon/src/workspaces.js";
import { LearningRegistry } from "../apps/daemon/src/learning.js";
import { SkillRegistry } from "../apps/daemon/src/skills.js";
import { ReflectionRegistry } from "../apps/daemon/src/reflection.js";
import { workSchema } from "../packages/contracts/src/index.js";
test("reflection authority pins reviewed source, restricts skills and persists only scoped drafts", async () => {
  const root = await mkdtemp(join(tmpdir(), "rocky-reflection-authority-")),
    store = new Store(root);
  try {
    const workspaces = new WorkspaceRegistry(store),
      learning = new LearningRegistry(store, workspaces),
      skills = new SkillRegistry(store, workspaces),
      reflection = new ReflectionRegistry(store, learning, skills);
    const skill = skills.import({
      id: randomUUID(),
      requestId: randomUUID(),
      expectedRevision: 0,
      scope: { kind: "user" },
      source: { type: "manual", reference: "fixture", license: "MIT" },
      package: {
        directoryName: "sample",
        files: [
          {
            path: "SKILL.md",
            contentBase64: Buffer.from(
              "---\nname: sample\ndescription: Fixture\n---\nBound skill instructions",
            ).toString("base64"),
          },
        ],
      },
    });
    skills.select(skill.id, {
      requestId: randomUUID(),
      expectedRevision: 0,
      skillRevision: 1,
      contentHash: skill.contentHash,
      action: "publish",
    });
    const work = workSchema.parse({
      id: randomUUID(),
      runId: randomUUID(),
      executionSessionId: randomUUID(),
      requestId: randomUUID(),
      text: "Fixture",
      transport: "http",
      mode: "configured",
      modelSelection: { connectionId: randomUUID(), revision: 1 },
      runMode: "normal",
      status: "completed",
      revision: 1,
      answer: "",
      createdAt: new Date().toISOString(),
    });
    store.transaction(() => {
      store.add(work, work.id);
      skills.freeze(work);
    });
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
    const episode = learning.createEpisode({
      requestId: randomUUID(),
      workId: work.id,
      expectedPolicyRevision: 0,
      expectedConsentRevision: 1,
      trigger: "manual_request",
      goal: "Reusable procedure",
      constraints: [],
      corrections: [],
      verification: [],
      failuresAndRepairs: [],
      preconditions: [],
      evidenceEventIds: [event.id],
    });
    const binding = {
      episodeId: episode.id,
      episodeRevision: 2,
      episodeHash: episode.contentHash,
    };
    expect(() => reflection.check(binding)).toThrow("approved");
    learning.reviewEpisode(episode.id, {
      requestId: randomUUID(),
      expectedRevision: 1,
      contentHash: episode.contentHash,
      decision: "approve",
    });
    expect(reflection.check(binding).episode.status).toBe("approved");
    const owner = workSchema.parse({
      ...work,
      id: randomUUID(),
      runId: randomUUID(),
      executionSessionId: randomUUID(),
      requestId: randomUUID(),
      runMode: "reflection",
      reflection: binding,
      status: "running",
    });
    store.add(owner, owner.id);
    const rpc = { binding, name: "read_learning_episode", args: {} };
    expect(
      JSON.parse(
        reflection.dispatch(owner, "rocky_reflection_tool", rpc, "read-owned"),
      ),
    ).toMatchObject({ id: episode.id });
    expect(
      reflection.dispatch(owner, "rocky_reflection_check", { binding }),
    ).toBe("ok");
    expect(() =>
      reflection.dispatch(work, "rocky_reflection_check", { binding }),
    ).toThrow("running owned");
    expect(() =>
      reflection.dispatch(
        { ...owner, runId: randomUUID() },
        "rocky_reflection_check",
        { binding },
      ),
    ).toThrow("running owned");
    expect(() =>
      reflection.dispatch(owner, "rocky_reflection_check", {
        binding: { ...binding, episodeId: randomUUID() },
      }),
    ).toThrow("stored episode");
    expect(() => reflection.dispatch(owner, "mcp_call", rpc, "denied")).toThrow(
      "not allowed",
    );
    store.save({ ...owner, revision: 2, status: "cancelled" }, 1);
    expect(() =>
      reflection.dispatch(owner, "rocky_reflection_check", { binding }),
    ).toThrow("running owned");
    store.save({ ...owner, revision: 3 }, 2);
    expect(
      reflection.call(binding, "list", "list_allowed_skills", {}),
    ).toMatchObject({ skills: [{ id: skill.id }] });
    const ref = {
      skillId: skill.id,
      revision: 1,
      contentHash: skill.contentHash,
    };
    expect(
      reflection.call(binding, "read", "read_skill_revision", ref),
    ).toMatchObject({
      content: expect.stringContaining("Bound skill instructions"),
    });
    expect(() =>
      reflection.call(binding, "bad", "read_skill_revision", {
        ...ref,
        skillId: randomUUID(),
      }),
    ).toThrow("outside");
    expect(() => reflection.call(binding, "bad", "mcp_call", {})).toThrow(
      "not allowed",
    );
    const candidate = {
      name: "learned-procedure",
      description: "Scoped draft",
      goal: "Repeat observed procedure",
      preconditions: ["Fixture only"],
      triggers: ["Repeated task"],
      steps: ["Read source"],
      stopConditions: ["Uncertain result"],
      verification: ["Verify output"],
      evidenceRefs: [event.id],
      requiredCapabilities: [],
      knownLimitations: ["Not evaluated"],
    };
    const output = reflection.call(
      binding,
      "proposal",
      "propose_skill_create",
      { candidate },
    );
    expect(output).toMatchObject({
      status: "proposed",
      scope: { kind: "user" },
    });
    expect(
      reflection.call(binding, "proposal", "propose_skill_create", {
        candidate,
      }),
    ).toEqual(output);
    expect(() =>
      reflection.call(binding, "proposal", "propose_skill_create", {
        candidate: { ...candidate, goal: "Changed" },
      }),
    ).toThrow("changed");
    expect(() =>
      reflection.call(binding, "bad-ref", "propose_skill_create", {
        candidate: { ...candidate, evidenceRefs: [randomUUID()] },
      }),
    ).toThrow("outside");
    expect(() =>
      reflection.call(binding, "secret", "propose_skill_create", {
        candidate: { ...candidate, goal: "password=fixture-secret" },
      }),
    ).toThrow("protected");
    expect(
      reflection.call(binding, "patch", "propose_skill_patch", {
        base: ref,
        reason: "Scoped fix",
        changes: { steps: ["Read then verify"] },
      }),
    ).toMatchObject({ status: "proposed" });
    expect(
      JSON.parse(
        reflection.dispatch(
          owner,
          "rocky_reflection_tool",
          {
            binding,
            name: "mark_no_learning",
            args: { reason: "No broader evidence" },
          },
          "none",
        ),
      ),
    ).toMatchObject({
      status: "no_learning",
      execution: {
        workId: owner.id,
        runId: owner.runId,
        executionSessionId: owner.executionSessionId,
      },
    });
    expect(skills.list()).toHaveLength(1);
    expect(skills.selection(skill.id)?.skillRevision).toBe(1);
    skills.select(skill.id, {
      requestId: randomUUID(),
      expectedRevision: 1,
      skillRevision: 1,
      contentHash: skill.contentHash,
      action: "quarantine",
    });
    expect(() =>
      reflection.call(binding, "read-again", "read_skill_revision", ref),
    ).toThrow("outside");
    learning.saveWorkConsent(work.id, {
      requestId: randomUUID(),
      expectedRevision: 1,
      private: true,
      excluded: true,
      sourceReuseAllowed: false,
    });
    expect(() =>
      reflection.call(binding, "proposal", "propose_skill_create", {
        candidate,
      }),
    ).toThrow("consent");
    expect(() =>
      reflection.dispatch(owner, "rocky_reflection_check", { binding }),
    ).toThrow("consent");
    const rows = store.db
      .prepare("SELECT data FROM learning_reflection_outputs")
      .all() as { data: string }[];
    expect(rows).toHaveLength(3);
    expect(
      rows.every(
        (row) =>
          JSON.parse(row.data).status === "withdrawn" &&
          !Object.hasOwn(JSON.parse(row.data), "payload"),
      ),
    ).toBe(true);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
