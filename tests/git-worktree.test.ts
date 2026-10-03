import { test, expect } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  rename,
  cp,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GitWorktree } from "../apps/daemon/src/git-worktree.js";
const exec = promisify(execFile);
const env: NodeJS.ProcessEnv = {};
for (const name of ["PATH", "SystemRoot", "TEMP", "TMP"])
  if (process.env[name]) env[name] = process.env[name];
Object.assign(env, {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_ALLOW_PROTOCOL: "",
});
async function git(root: string, args: string[]) {
  return (
    await exec(
      "git",
      [
        "-c",
        "core.hooksPath=" +
          (process.platform === "win32" ? "NUL" : "/dev/null"),
        "-c",
        "commit.gpgSign=false",
        "-c",
        "user.name=Rocky fixture",
        "-c",
        "user.email=fixture@example.invalid",
        ...args,
      ],
      { cwd: root, env, windowsHide: true },
    )
  ).stdout.trim();
}
test.each([
  "create",
  "stale",
  "replaced",
  "existing",
  "filters",
  "cancel",
] as const)("real local Git worktree boundary: %s", async (mode) => {
  const base = await mkdtemp(join(tmpdir(), "rocky-git-fixture-")),
    root = join(base, "source"),
    templates = join(base, "templates"),
    destination = join(base, "result");
  await mkdir(root);
  await mkdir(templates);
  try {
    await git(root, ["init", "--template=" + templates, "-b", "main"]);
    await writeFile(join(root, "file.txt"), "COMMITTED_SOURCE\n");
    await git(root, ["add", "file.txt"]);
    await git(root, ["commit", "-m", "fixture initial"]);
    const head = await git(root, ["rev-parse", "HEAD"]);
    await writeFile(join(root, "file.txt"), "DIRTY_SOURCE_MUST_REMAIN\n");
    await writeFile(join(root, "untracked.txt"), "UNTRACKED_MUST_REMAIN");
    await mkdir(join(root, ".git", "hooks"));
    await writeFile(
      join(root, ".git", "hooks", "post-checkout"),
      "#!/bin/sh\nprintf dangerous > ../hook-ran.txt\n",
      { mode: 0o755 },
    );
    const adapter = new GitWorktree(),
      branch = "codex/rocky-" + randomUUID();
    if (mode === "filters") {
      await git(root, ["config", "filter.untrusted.smudge", "DO_NOT_EXECUTE"]);
      await expect(adapter.prepare(root, destination, branch)).rejects.toThrow(
        "filters",
      );
      return;
    }
    const prepared = await adapter.prepare(root, destination, branch);
    expect(prepared.head).toBe(head);
    if (mode === "stale") {
      await git(root, ["add", "file.txt"]);
      await git(root, ["commit", "-m", "new head"]);
      await expect(
        adapter.create(prepared, new AbortController().signal),
      ).rejects.toThrow("state changed");
      await expect(readFile(join(destination, "file.txt"))).rejects.toThrow();
    } else if (mode === "replaced") {
      await rename(join(root, ".git"), join(base, "original-git"));
      await cp(join(base, "original-git"), join(root, ".git"), {
        recursive: true,
      });
      expect((await adapter.prepare(root, destination, branch)).head).toBe(
        prepared.head,
      );
      await expect(
        adapter.create(prepared, new AbortController().signal),
      ).rejects.toThrow("state changed");
      await expect(readFile(join(destination, "file.txt"))).rejects.toThrow();
    } else if (mode === "existing") {
      await mkdir(destination);
      await writeFile(join(destination, "owner.txt"), "OWNER_FILE");
      await expect(
        adapter.create(prepared, new AbortController().signal),
      ).rejects.toThrow();
      expect(await readFile(join(destination, "owner.txt"), "utf8")).toBe(
        "OWNER_FILE",
      );
    } else if (mode === "cancel") {
      await expect(
        adapter.create(prepared, AbortSignal.abort()),
      ).rejects.toThrow();
      await expect(readFile(join(destination, "file.txt"))).rejects.toThrow();
    } else {
      const result = await adapter.create(
        prepared,
        new AbortController().signal,
      );
      expect(result).toMatchObject({ root: destination, branch, head });
      expect(await readFile(join(destination, "file.txt"), "utf8")).toBe(
        "COMMITTED_SOURCE\n",
      );
      expect(await readFile(join(root, "file.txt"), "utf8")).toBe(
        "DIRTY_SOURCE_MUST_REMAIN\n",
      );
      expect(await readFile(join(root, "untracked.txt"), "utf8")).toBe(
        "UNTRACKED_MUST_REMAIN",
      );
      expect(await git(root, ["branch", "--show-current"])).toBe("main");
      expect(await git(destination, ["branch", "--show-current"])).toBe(branch);
      await expect(readFile(join(base, "hook-ran.txt"))).rejects.toThrow();
      await git(root, [
        "-c",
        "core.hooksPath=" + join(root, ".git", "hooks"),
        "worktree",
        "add",
        "-b",
        "fixture-control",
        join(base, "control"),
        "HEAD",
      ]);
      expect(await readFile(join(base, "hook-ran.txt"), "utf8")).toBe(
        "dangerous",
      );
      await expect(
        adapter.create(prepared, new AbortController().signal),
      ).rejects.toThrow();
    }
    expect(await git(root, ["remote"])).toBe("");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
