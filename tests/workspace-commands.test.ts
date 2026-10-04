import { test, expect, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  rename,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../apps/daemon/src/store.js";
import { WorkspaceRegistry } from "../apps/daemon/src/workspaces.js";
import { WorkspaceCommands } from "../apps/daemon/src/workspace-commands.js";
import { workSchema } from "../packages/contracts/src/index.js";

test("command consent binds executable bytes, owner, limits, workspace and OS environment without execution", async () => {
  const base = await mkdtemp(join(tmpdir(), "rocky-command-proposal-"));
  const root = join(base, "project"),
    executable = join(base, "fixture-program");
  await mkdir(root);
  await writeFile(executable, "explicit non-executable identity fixture");
  const store = new Store(join(base, "data")),
    registry = new WorkspaceRegistry(store);
  try {
    const workspace = await registry.save({
      id: randomUUID(),
      requestId: randomUUID(),
      expectedRevision: 0,
      name: "Command workspace",
      root,
    });
    const work = workSchema.parse({
      id: randomUUID(),
      runId: randomUUID(),
      executionSessionId: randomUUID(),
      requestId: randomUUID(),
      workspaceId: workspace.id,
      workspaceRevision: workspace.revision,
      text: "Command preparation fixture",
      transport: "http",
      mode: "configured",
      modelSelection: { connectionId: randomUUID(), revision: 1 },
      runMode: "normal",
      status: "running",
      revision: 1,
      answer: "",
      createdAt: new Date().toISOString(),
    });
    const commands = new WorkspaceCommands(registry),
      signal = new AbortController().signal;
    const args = {
      executable,
      args: ["literal argument"],
      timeoutMs: 1000,
      maxOutputBytes: 1024,
    };
    const proposal = await commands.prepare(work, args, signal);
    expect(proposal.command.cwd).toBe(workspace.root);
    expect(
      (await commands.revalidate(work, proposal, signal)).fingerprint,
    ).toBe(proposal.fingerprint);
    for (const changed of [
      { ...args, args: ["changed"] },
      { ...args, timeoutMs: 2000 },
      { ...args, maxOutputBytes: 2048 },
    ])
      expect(
        (await commands.prepare(work, changed, signal)).fingerprint,
      ).not.toBe(proposal.fingerprint);
    for (const key of ["id", "runId", "executionSessionId"] as const)
      await expect(
        commands.revalidate({ ...work, [key]: randomUUID() }, proposal, signal),
      ).rejects.toThrow("fresh exact approval");
    await expect(
      commands.prepare({ ...work, runMode: "reflection" }, args, signal),
    ).rejects.toThrow("normal configured Work");
    await expect(
      commands.prepare({ ...work, mode: "fixture" }, args, signal),
    ).rejects.toThrow("normal configured Work");
    await expect(
      commands.prepare(work, { ...args, cwd: base }, signal),
    ).rejects.toThrow();
    await expect(
      commands.prepare(work, args, AbortSignal.abort()),
    ).rejects.toThrow();
    vi.stubEnv("PATH", (process.env.PATH ?? "") + ";changed-for-fixture");
    await expect(commands.revalidate(work, proposal, signal)).rejects.toThrow(
      "fresh exact approval",
    );
    vi.unstubAllEnvs();
    await writeFile(executable, "replacement executable content");
    await expect(commands.revalidate(work, proposal, signal)).rejects.toThrow(
      "fresh exact approval",
    );
    const fresh = await commands.prepare(work, args, signal);
    expect(fresh.executable.sha256).not.toBe(proposal.executable.sha256);
    // Registration CAS invalidates even otherwise unchanged command intent.
    await registry.save({
      id: workspace.id,
      requestId: randomUUID(),
      expectedRevision: 1,
      name: "Renamed",
      root,
    });
    await expect(commands.revalidate(work, fresh, signal)).rejects.toThrow(
      "revision changed",
    );
    const revisedWork = { ...work, workspaceRevision: 2 };
    const revised = await commands.prepare(revisedWork, args, signal);
    await rename(root, join(base, "original-project"));
    await mkdir(root);
    await expect(
      commands.revalidate(revisedWork, revised, signal),
    ).rejects.toThrow("identity changed");
    expect(await readFile(executable, "utf8")).toBe(
      "replacement executable content",
    );
  } finally {
    vi.unstubAllEnvs();
    store.close();
    await rm(base, { recursive: true, force: true });
  }
});
