import { test, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink, link } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  snapshotSkillSource,
  discoverSkillSources,
} from "../apps/daemon/src/skill-sources.js";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { createApp } from "../apps/daemon/src/http.js";
const body =
  "---\nname: sample\ndescription: Local source fixture\n---\nOriginal";

test("project discovery is owner-only, untrusted, hash-pinned and imports immutable bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "rocky-skill-source-"));
  const project = join(root, "project"),
    skills = join(project, ".agents", "skills");
  await mkdir(join(skills, "sample"), { recursive: true });
  await writeFile(join(skills, "sample", "SKILL.md"), body);
  const service = new WorkService(join(root, "data"));
  try {
    const id = randomUUID();
    await service.workspaces.save({
      id,
      requestId: randomUUID(),
      expectedRevision: 0,
      name: "Skill source",
      root: project,
    });
    const scope = { kind: "project", projectId: id };
    const app = createApp(service);
    const headers = {
      host: "127.0.0.1:3211",
      "content-type": "application/json",
    };
    expect(
      (
        await app.request("/api/v1/skills/discover", {
          method: "POST",
          headers,
          body: JSON.stringify({ scope }),
        })
      ).status,
    ).toBe(403);
    const session = await (
      await app.request("/api/v1/session", { headers })
    ).json();
    const response = await app.request("/api/v1/skills/discover", {
      method: "POST",
      headers: { ...headers, "x-rocky-session": session.token },
      body: JSON.stringify({ scope }),
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.items[0]).toMatchObject({
      name: "sample",
      state: "untrusted",
    });
    expect(service.skills.list()).toHaveLength(0);
    const command = {
      scope,
      name: "sample",
      expectedHash: result.items[0].contentHash,
    };
    const snapshot = await service.skills.sourceSnapshot(command);
    const imported = service.skills.import({
      id: randomUUID(),
      requestId: randomUUID(),
      expectedRevision: 0,
      scope,
      source: { ...snapshot.source, license: "MIT test declaration" },
      package: snapshot.package,
    });
    expect(service.skills.selection(imported.id)).toBeNull();
    await writeFile(join(skills, "sample", "SKILL.md"), body + " changed");
    await expect(service.skills.sourceSnapshot(command)).rejects.toMatchObject({
      code: "skill_source_changed",
    });
    expect(
      Buffer.from(
        service.skills.get(imported.id, 1).package.files[0]!.contentBase64,
        "base64",
      ).toString(),
    ).toBe(body);
    await expect(
      service.skills.sourceSnapshot({ ...command, name: "../sample" }),
    ).rejects.toThrow();
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("filesystem sources reject junctions, hard links, oversized files and invalid packages", async () => {
  const root = await mkdtemp(join(tmpdir(), "rocky-skill-paths-"));
  const skills = join(root, "skills"),
    outside = join(root, "outside");
  await mkdir(join(skills, "sample"), { recursive: true });
  await mkdir(outside);
  await writeFile(join(skills, "sample", "SKILL.md"), body);
  try {
    await symlink(
      outside,
      join(skills, "sample", "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(snapshotSkillSource(skills, "sample")).rejects.toThrow();
    await rm(join(skills, "sample", "linked"));
    await writeFile(join(outside, "secret"), "outside bytes");
    await link(join(outside, "secret"), join(skills, "sample", "hard"));
    await expect(snapshotSkillSource(skills, "sample")).rejects.toThrow();
    await rm(join(skills, "sample", "hard"));
    await writeFile(join(skills, "sample", "large"), Buffer.alloc(1048577));
    await expect(snapshotSkillSource(skills, "sample")).rejects.toThrow();
    await rm(join(skills, "sample", "large"));
    await mkdir(join(skills, "invalid"));
    await writeFile(join(skills, "invalid", "SKILL.md"), "invalid");
    const listing = await discoverSkillSources(skills);
    expect(listing.items.find((x) => x.name === "sample")?.contentHash).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(listing.items.find((x) => x.name === "invalid")?.error).toBeTruthy();
    await symlink(
      skills,
      join(root, "linked-root"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(
      discoverSkillSources(join(root, "linked-root")),
    ).rejects.toThrow();
    expect(await discoverSkillSources(join(root, "missing"))).toEqual({
      items: [],
      truncated: false,
      available: false,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
