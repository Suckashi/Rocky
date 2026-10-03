import { lstat, realpath, open } from "node:fs/promises";
import { constants, type BigIntStats } from "node:fs";
import { createHash } from "node:crypto";
import {
  resolve,
  relative,
  isAbsolute,
  sep,
  basename,
  dirname,
} from "node:path";
import { intentHash } from "./intent.js";
import { RockyError } from "../../../packages/contracts/src/index.js";
const limit = 8 * 1024 * 1024;
const denied = () =>
  new RockyError(
    "target_denied",
    "Target must be a regular file within its authorized root",
    403,
  );
const identity = (stat: BigIntStats) => ({
  device: stat.dev.toString(),
  inode: stat.ino.toString(),
});
const version = (stat: BigIntStats) => ({
  ...identity(stat),
  size: stat.size.toString(),
  modified: stat.mtimeNs.toString(),
  changed: stat.ctimeNs.toString(),
  mode: stat.mode.toString(),
});
function within(root: string, path: string) {
  const part = relative(root, path);
  return part !== ".." && !part.startsWith(".." + sep) && !isAbsolute(part);
}
export type FileTarget = {
  root: string;
  relativePath: string;
  canonicalPath: string;
  exists: boolean;
  fingerprint: string;
  contentHash: string | null;
  size: number | null;
};

/** Trusted owner-selected root only. Snapshot/recheck is not a filesystem transaction or OS sandbox. */
export async function resolveFileTarget(
  authorizedRoot: string,
  inputPath: string,
): Promise<FileTarget> {
  try {
    const parts = inputPath.replaceAll("\\", "/").split("/");
    if (
      !inputPath ||
      isAbsolute(inputPath) ||
      parts.some(
        (p) =>
          !p ||
          p === "." ||
          p === ".." ||
          /[\x00-\x1f:]/.test(p) ||
          /[. ]$/.test(p) ||
          /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p),
      )
    )
      throw denied();
    const root = await realpath(authorizedRoot),
      rootStat = await lstat(root, { bigint: true });
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw denied();
    let candidate = root;
    for (const part of parts.slice(0, -1)) {
      candidate = resolve(candidate, part);
      const stat = await lstat(candidate, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw denied();
    }
    candidate = resolve(candidate, parts.at(-1)!);
    if (!within(root, candidate)) throw denied();
    const parent = await realpath(dirname(candidate));
    if (!within(root, parent)) throw denied();
    const parentStat = await lstat(parent, { bigint: true });
    let initial: BigIntStats | undefined;
    try {
      initial = await lstat(candidate, { bigint: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    let contentHash: string | null = null,
      size: number | null = null;
    if (initial) {
      if (
        !initial.isFile() ||
        initial.isSymbolicLink() ||
        initial.nlink !== 1n ||
        initial.size > BigInt(limit)
      )
        throw denied();
      const file = await open(
        candidate,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      try {
        const before = await file.stat({ bigint: true });
        if (
          !before.isFile() ||
          before.nlink !== 1n ||
          intentHash(version(before)) !== intentHash(version(initial))
        )
          throw denied();
        const hash = createHash("sha256"),
          buffer = Buffer.alloc(65536);
        let count = 0;
        for (;;) {
          const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
          if (!bytesRead) break;
          count += bytesRead;
          if (count > limit) throw denied();
          hash.update(buffer.subarray(0, bytesRead));
        }
        const after = await file.stat({ bigint: true });
        const named = await lstat(candidate, { bigint: true });
        if (
          named.isSymbolicLink() ||
          named.nlink !== 1n ||
          intentHash(version(before)) !== intentHash(version(after)) ||
          intentHash(version(after)) !== intentHash(version(named))
        )
          throw denied();
        candidate = await realpath(candidate);
        if (!within(root, candidate)) throw denied();
        contentHash = hash.digest("hex");
        size = count;
      } finally {
        await file.close();
      }
    } else candidate = resolve(parent, basename(candidate));
    const canonicalPath =
      process.platform === "win32" ? candidate.toLowerCase() : candidate;
    const fingerprint = intentHash({
      root: process.platform === "win32" ? root.toLowerCase() : root,
      rootIdentity: identity(rootStat),
      parentIdentity: identity(parentStat),
      canonicalPath,
      exists: !!initial,
      version: initial ? version(initial) : null,
      contentHash,
    });
    return {
      root,
      relativePath: relative(root, candidate),
      canonicalPath,
      exists: !!initial,
      fingerprint,
      contentHash,
      size,
    };
  } catch (error) {
    if (error instanceof RockyError) throw error;
    throw denied();
  }
}
export async function recheckFileTarget(target: FileTarget) {
  const current = await resolveFileTarget(target.root, target.relativePath);
  if (current.fingerprint !== target.fingerprint)
    throw new RockyError(
      "target_changed",
      "Target changed after preparation; fresh approval required",
      409,
    );
  return current;
}
