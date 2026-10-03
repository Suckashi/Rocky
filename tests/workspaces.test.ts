import { test, expect } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  rename,
  symlink,
  link,
} from "node:fs/promises";
import { join, parse } from "node:path";
import { tmpdir, homedir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { Store } from "../apps/daemon/src/store.js";
import { WorkspaceRegistry } from "../apps/daemon/src/workspaces.js";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { createApp } from "../apps/daemon/src/http.js";
import { workSchema } from "../packages/contracts/src/index.js";
test("directory limits are truthful and unfinished workspace reservations prevent rebinding", async () => {
  const base = await mkdtemp(join(tmpdir(), "rocky-workspace-reservation-"));
  const project = join(base, "project");
  await mkdir(project);
  await mkdir(join(project, "empty"));
  await Promise.all(
    Array.from({ length: 205 }, (_, i) =>
      writeFile(join(project, `file-${i}.txt`), "text"),
    ),
  );
  const store = new Store(join(base, "data")),
    registry = new WorkspaceRegistry(store);
  try {
    const command = {
      requestId: randomUUID(),
      id: randomUUID(),
      expectedRevision: 0,
      name: "Reserved",
      root: project,
    };
    const workspace = await registry.save(command);
    const listing = await registry.files(workspace.id, 1);
    expect(listing.entries).toHaveLength(200);
    expect(listing.truncated).toBe(true);
    expect((await registry.files(workspace.id, 1, "empty")).entries).toEqual(
      [],
    );
    const work = workSchema.parse({
      id: randomUUID(),
      runId: randomUUID(),
      executionSessionId: randomUUID(),
      requestId: randomUUID(),
      workspaceId: workspace.id,
      text: "Reserved",
      transport: "http",
      mode: "fixture",
      runMode: "normal",
      status: "blocked",
      revision: 1,
      answer: "",
      createdAt: new Date().toISOString(),
    });
    store.add(work, "reservation fixture");
    const change = {
      ...command,
      requestId: randomUUID(),
      expectedRevision: 1,
      name: "Renamed",
    };
    await expect(registry.save(change)).rejects.toThrow("unfinished Work");
    expect(registry.get(workspace.id).revision).toBe(1);
    store.save({ ...work, revision: 2, status: "cancelled" }, 1);
    expect((await registry.save(change)).revision).toBe(2);
  } finally {
    store.close();
    await rm(base, { recursive: true, force: true });
  }
});
test("workspace registration persists, replays parallel requests, enforces CAS and canonical duplicate roots", async () => {
  const base = await mkdtemp(join(tmpdir(), "rocky-workspace-"));
  await mkdir(join(base, "project"));
  const store = new Store(join(base, "data")),
    registry = new WorkspaceRegistry(store);
  const command = {
    requestId: randomUUID(),
    id: randomUUID(),
    expectedRevision: 0,
    name: "Project",
    root: join(base, "project"),
  };
  try {
    const [a, b] = await Promise.all([
      registry.save(command),
      registry.save(command),
    ]);
    expect(a).toEqual(b);
    expect(registry.list()).toHaveLength(1);
    await expect(
      registry.save({ ...command, name: "changed" }),
    ).rejects.toThrow("request changed");
    await expect(
      registry.save({ ...command, requestId: randomUUID(), id: randomUUID() }),
    ).rejects.toThrow("already registered");
    await expect(
      registry.save({ ...command, requestId: randomUUID() }),
    ).rejects.toThrow("revision changed");
    expect(
      (
        await registry.save({
          ...command,
          requestId: randomUUID(),
          expectedRevision: 1,
          name: "Renamed",
        })
      ).revision,
    ).toBe(2);
  } finally {
    store.close();
  }
  const restarted = new Store(join(base, "data"));
  try {
    expect(new WorkspaceRegistry(restarted).list()[0]?.name).toBe("Renamed");
    expect(
      restarted.db.prepare("PRAGMA user_version").get()?.user_version,
    ).toBe(17);
  } finally {
    restarted.close();
    await rm(base, { recursive: true, force: true });
  }
});
test("registered previews reject traversal, junctions, hardlinks, private data, binary and root replacement", async () => {
  const base = await mkdtemp(join(tmpdir(), "rocky-workspace-boundary-")),
    project = join(base, "project"),
    outside = join(base, "outside");
  await mkdir(project);
  await mkdir(outside);
  await writeFile(join(outside, "secret.txt"), "outside secret");
  await mkdir(join(project, "docs"));
  await writeFile(join(project, "docs", "sample.md"), "# Actual text\n");
  await writeFile(join(project, ".env"), "unknown secret");
  await writeFile(join(project, "binary.bin"), Buffer.from([0, 255]));
  await writeFile(join(project, "large.txt"), "x".repeat(1048577));
  await symlink(
    outside,
    join(project, "escape"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await link(join(outside, "secret.txt"), join(project, "hard.txt"));
  const store = new Store(join(project, "private-data")),
    registry = new WorkspaceRegistry(store);
  try {
    const workspace = await registry.save({
      requestId: randomUUID(),
      id: randomUUID(),
      expectedRevision: 0,
      name: "Scoped",
      root: project,
    });
    const listing = await registry.files(workspace.id, 1);
    expect(listing.entries.map((e) => e.name)).not.toContain(".env");
    expect(listing.entries.map((e) => e.name)).not.toContain("escape");
    expect(listing.entries.map((e) => e.name)).not.toContain("private-data");
    const preview = await registry.read(workspace.id, 1, "docs/sample.md");
    expect(preview.text).toBe("# Actual text\n");
    expect(preview.sha256).toBe(
      createHash("sha256").update(preview.text).digest("hex"),
    );
    expect((await registry.files(workspace.id, 1, "docs")).entries).toEqual([
      { name: "sample.md", kind: "file" },
    ]);
    for (const path of [
      "../outside/secret.txt",
      "escape/secret.txt",
      "hard.txt",
      ".env",
      "private-data/manifest.json",
      "docs/../binary.bin",
      "C:/Windows/system.ini",
    ]) {
      await expect(registry.read(workspace.id, 1, path)).rejects.toThrow();
    }
    await expect(registry.files(workspace.id, 1, "escape")).rejects.toThrow();
    await expect(registry.read(workspace.id, 1, "binary.bin")).rejects.toThrow(
      "UTF-8",
    );
    await expect(registry.read(workspace.id, 1, "large.txt")).rejects.toThrow(
      "1 MiB",
    );
    await expect(
      registry.read(workspace.id, 1, "docs/sample.md", "a".repeat(64)),
    ).rejects.toThrow("revision changed");
    await expect(
      registry.read(workspace.id, 2, "docs/sample.md"),
    ).rejects.toThrow("Workspace revision");
    for (const root of [
      "relative",
      parse(project).root,
      homedir(),
      join(project, "escape"),
      join(project, "private-data"),
    ])
      await expect(
        registry.save({
          requestId: randomUUID(),
          id: randomUUID(),
          expectedRevision: 0,
          name: "Denied",
          root,
        }),
      ).rejects.toThrow();
    await writeFile(join(project, "docs", "sample.md"), "new text");
    await expect(
      registry.read(workspace.id, 1, "docs/sample.md", preview.sha256),
    ).rejects.toThrow("revision changed");
  } finally {
    store.close();
  }
  // Replace root after closing SQLite handles, retaining its old directory identity.
  const registryStore = new Store(join(base, "other-data")),
    next = new WorkspaceRegistry(registryStore);
  try {
    const workspace = await next.save({
      requestId: randomUUID(),
      id: randomUUID(),
      expectedRevision: 0,
      name: "Root",
      root: project,
    });
    await rename(project, join(base, "old-project"));
    await mkdir(project);
    await expect(next.files(workspace.id, 1)).rejects.toThrow(
      "identity changed",
    );
  } finally {
    registryStore.close();
    await rm(base, { recursive: true, force: true });
  }
});
test("workspace owner HTTP commands require session; read API reports actual content and revision", async () => {
  const base = await mkdtemp(join(tmpdir(), "rocky-workspace-http-")),
    project = join(base, "project");
  await mkdir(project);
  await writeFile(join(project, "actual.txt"), "actual owner content");
  const service = new WorkService(join(base, "data")),
    app = createApp(service),
    host = "http://127.0.0.1:3211";
  const call = (url: string, init: RequestInit = {}) =>
    app.request(url, {
      ...init,
      headers: {
        host: "127.0.0.1:3211",
        ...Object.fromEntries(new Headers(init.headers)),
      },
    });
  try {
    const body = {
      requestId: randomUUID(),
      id: randomUUID(),
      expectedRevision: 0,
      name: "Actual",
      root: project,
    };
    expect(
      (
        await call(host + "/api/v1/workspaces", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      ).status,
    ).toBe(403);
    const { token } = await (await call(host + "/api/v1/session")).json();
    const response = await call(host + "/api/v1/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json", "x-rocky-session": token },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    const workspace = await response.json();
    expect(
      (
        await (
          await call(
            host +
              `/api/v1/workspaces/${workspace.id}/file?revision=1&path=actual.txt`,
          )
        ).json()
      ).text,
    ).toBe("actual owner content");
    expect(
      (
        await call(
          host +
            `/api/v1/workspaces/${workspace.id}/file?revision=2&path=actual.txt`,
        )
      ).status,
    ).toBe(409);
  } finally {
    await service.close();
    await rm(base, { recursive: true, force: true });
  }
});
