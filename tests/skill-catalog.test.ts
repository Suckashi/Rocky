import { test, expect } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Store } from "../apps/daemon/src/store.js";
import { WorkspaceRegistry } from "../apps/daemon/src/workspaces.js";
import { SkillRegistry } from "../apps/daemon/src/skills.js";
import { workSchema } from "../packages/contracts/src/index.js";

test("frozen catalog scope, newer selections, quarantine and reopened reads", async () => {
  const root = await mkdtemp(join(tmpdir(), "rocky-skill-catalog-"));
  let store = new Store(join(root, "data"));
  try {
    const workspaces = new WorkspaceRegistry(store);
    let skills = new SkillRegistry(store, workspaces);
    const projectId = randomUUID();
    await mkdir(join(root, "project"));
    await workspaces.save({
      id: projectId,
      requestId: randomUUID(),
      expectedRevision: 0,
      name: "Project",
      root: join(root, "project"),
    });
    const imported = (
      scope: unknown,
      body: string,
      id: string = randomUUID(),
      expectedRevision = 0,
    ) =>
      skills.import({
        id,
        requestId: randomUUID(),
        expectedRevision,
        scope,
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
                `---\nname: example\ndescription: Fixture skill\n---\n${body}`,
              ).toString("base64"),
            },
          ],
        },
      });
    const user = imported({ kind: "user" }, "User v1"),
      project = imported({ kind: "project", projectId }, "Project");
    imported({ kind: "user" }, "Untrusted");
    for (const skill of [user, project])
      skills.select(skill.id, {
        requestId: randomUUID(),
        expectedRevision: 0,
        skillRevision: 1,
        contentHash: skill.contentHash,
        action: "publish",
      });
    const makeWork = (workspaceId?: string, runMode = "normal") => {
      const work = workSchema.parse({
        id: randomUUID(),
        runId: randomUUID(),
        executionSessionId: randomUUID(),
        requestId: randomUUID(),
        text: "Fixture",
        transport: "http",
        mode: "configured",
        modelSelection: { connectionId: randomUUID(), revision: 1 },
        runMode,
        status: "running",
        revision: 1,
        answer: "",
        createdAt: new Date().toISOString(),
        ...(workspaceId ? { workspaceId } : {}),
      });
      store.transaction(() => {
        store.add(work, work.id);
        skills.freeze(work);
      });
      return work;
    };
    const plain = makeWork(),
      scoped = makeWork(projectId),
      evaluation = makeWork(projectId, "evaluation");
    expect(skills.catalog(plain.id)?.items.map((i) => i.id)).toEqual([user.id]);
    expect(
      skills
        .catalog(scoped.id)
        ?.items.map((i) => i.id)
        .sort(),
    ).toEqual([user.id, project.id].sort());
    expect(skills.catalog(evaluation.id)?.items).toEqual([]);
    expect(() => skills.readForWork(plain, project.id)).toThrow("outside");
    const frozen = skills.catalog(plain.id);
    const next = imported({ kind: "user" }, "User v2", user.id, 1);
    skills.select(user.id, {
      requestId: randomUUID(),
      expectedRevision: 1,
      skillRevision: 2,
      contentHash: next.contentHash,
      action: "publish",
    });
    expect(skills.catalog(plain.id)).toEqual(frozen);
    expect(skills.readForWork(plain, user.id).revision.revision).toBe(1);
    expect(skills.catalog(makeWork().id)?.items[0]?.revision).toBe(2);
    // Select the older revision for quarantine; a frozen run must stop reading it.
    skills.select(user.id, {
      requestId: randomUUID(),
      expectedRevision: 2,
      skillRevision: 1,
      contentHash: user.contentHash,
      action: "publish",
    });
    skills.select(user.id, {
      requestId: randomUUID(),
      expectedRevision: 3,
      skillRevision: 1,
      contentHash: user.contentHash,
      action: "quarantine",
    });
    expect(() => skills.readForWork(plain, user.id)).toThrow("quarantined");
    expect(() =>
      skills.readForWork(
        { ...scoped, executionSessionId: randomUUID() },
        project.id,
      ),
    ).toThrow("running Work");
    store.close();
    store = new Store(join(root, "data"));
    skills = new SkillRegistry(store, new WorkspaceRegistry(store));
    expect(skills.catalog(plain.id)).toEqual(frozen);
    expect(() => skills.readForWork(plain, user.id)).toThrow("quarantined");
    expect(skills.readForWork(scoped, project.id).revision.id).toBe(project.id);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
