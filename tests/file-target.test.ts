import { test, expect } from "vitest";
import {
  mkdtemp,
  writeFile,
  mkdir,
  symlink,
  link,
  rm,
  stat,
  utimes,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveFileTarget,
  recheckFileTarget,
} from "../apps/daemon/src/file-target.js";
test("T-008 real file target detects overwrite and new-file creation between prepare and dispatch", async () => {
  const root = await mkdtemp(join(tmpdir(), "rocky-target-"));
  try {
    await writeFile(join(root, "sample.txt"), "before");
    const target = await resolveFileTarget(root, "sample.txt");
    expect(target).toMatchObject({ exists: true, size: 6 });
    expect(await recheckFileTarget(target)).toEqual(target);
    const original = await stat(join(root, "sample.txt"));
    await writeFile(join(root, "sample.txt"), "after!");
    await utimes(join(root, "sample.txt"), original.atime, original.mtime);
    await expect(recheckFileTarget(target)).rejects.toThrow(
      "changed after preparation",
    );
    const missing = await resolveFileTarget(root, "new.txt");
    expect(missing.exists).toBe(false);
    await writeFile(join(root, "new.txt"), "created by another actor");
    await expect(recheckFileTarget(missing)).rejects.toThrow(
      "changed after preparation",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("T-008 target scope rejects traversal, device/ADS aliases, junction escape and hard links", async () => {
  const base = await mkdtemp(join(tmpdir(), "rocky-target-scope-")),
    root = join(base, "root"),
    outside = join(base, "outside");
  try {
    await mkdir(root);
    await mkdir(outside);
    await writeFile(join(outside, "private.txt"), "synthetic only");
    for (const path of [
      "../outside/private.txt",
      "/absolute",
      "C:\\other",
      "x/../a",
      "file:stream",
      "NUL.txt",
      "file.",
      "file ",
      "x//a",
    ])
      await expect(resolveFileTarget(root, path)).rejects.toThrow(
        "authorized root",
      );
    await symlink(
      outside,
      join(root, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(resolveFileTarget(root, "escape/private.txt")).rejects.toThrow(
      "authorized root",
    );
    await link(join(outside, "private.txt"), join(root, "hard.txt"));
    await expect(resolveFileTarget(root, "hard.txt")).rejects.toThrow(
      "authorized root",
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
test("T-008 target recheck rejects parent replaced with junction; portable separators resolve consistently", async () => {
  const base = await mkdtemp(join(tmpdir(), "rocky-target-parent-")),
    root = join(base, "root"),
    outside = join(base, "outside");
  try {
    await mkdir(join(root, "sub"), { recursive: true });
    await mkdir(outside);
    await writeFile(join(root, "sub", "sample.txt"), "synthetic");
    await writeFile(join(outside, "sample.txt"), "synthetic");
    const target = await resolveFileTarget(root, "sub/sample.txt");
    expect((await resolveFileTarget(root, "sub\\sample.txt")).fingerprint).toBe(
      target.fingerprint,
    );
    await rm(join(root, "sub"), { recursive: true });
    await symlink(
      outside,
      join(root, "sub"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(recheckFileTarget(target)).rejects.toThrow("authorized root");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
