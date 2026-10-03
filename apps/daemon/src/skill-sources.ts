import { lstat, open, opendir, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve, parse, relative, sep } from "node:path";
import { RockyError } from "../../../packages/contracts/src/index.js";
import { validateSkillPackage } from "./skill-package.js";

const denied = () =>
  new RockyError(
    "skill_source",
    "Skill source changed, is linked, or exceeds package limits",
    422,
  );
const samePath = (a: string, b: string) =>
  process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
// Reject links in every path component, including .agents and skills themselves.
async function checked(path: string) {
  const absolute = resolve(path),
    root = parse(absolute).root;
  let current = root;
  for (const part of relative(root, absolute).split(sep).filter(Boolean)) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw denied();
  }
  if (!samePath(await realpath(absolute), absolute)) throw denied();
  return lstat(absolute, { bigint: true });
}

export async function snapshotSkillSource(root: string, name: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64)
    throw denied();
  const folder = join(root, name),
    files: Array<{ path: string; contentBase64: string }> = [];
  let total = 0,
    entries = 0;
  async function walk(path: string, prefix: string, depth: number) {
    if (depth > 16 || !(await checked(path)).isDirectory()) throw denied();
    const directory = await opendir(path);
    for await (const entry of directory) {
      if (++entries > 256) throw denied();
      const full = join(path, entry.name),
        portable = prefix + entry.name;
      const before = await checked(full);
      if (before.isDirectory()) await walk(full, portable + "/", depth + 1);
      else {
        if (
          !before.isFile() ||
          before.nlink !== 1n ||
          before.size > 1048576n ||
          files.length >= 128
        )
          throw denied();
        total += Number(before.size);
        if (total > 4194304) throw denied();
        const handle = await open(
          full,
          constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
        );
        try {
          const opened = await handle.stat({ bigint: true });
          if (
            opened.dev !== before.dev ||
            opened.ino !== before.ino ||
            opened.size !== before.size
          )
            throw denied();
          // Bounded read even if an external process grows the file after stat.
          const bytes = Buffer.alloc(Number(before.size) + 1);
          let length = 0;
          while (length < bytes.length) {
            const read = await handle.read(
              bytes,
              length,
              bytes.length - length,
              length,
            );
            if (!read.bytesRead) break;
            length += read.bytesRead;
          }
          const after = await checked(full);
          if (
            length !== Number(before.size) ||
            after.dev !== before.dev ||
            after.ino !== before.ino ||
            after.mtimeNs !== before.mtimeNs ||
            after.ctimeNs !== before.ctimeNs
          )
            throw denied();
          files.push({
            path: portable,
            contentBase64: bytes.subarray(0, length).toString("base64"),
          });
        } finally {
          await handle.close();
        }
      }
    }
    await checked(path);
  }
  await walk(folder, "", 0);
  const packageData = { directoryName: name, files };
  return { package: packageData, ...validateSkillPackage(packageData) };
}

export async function discoverSkillSources(root: string) {
  try {
    if (!(await checked(root)).isDirectory()) throw denied();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { items: [], truncated: false, available: false };
    throw error;
  }
  const items: Array<{
    name: string;
    state: "untrusted";
    metadata?: ReturnType<typeof validateSkillPackage>["metadata"];
    contentHash?: string;
    error?: string;
  }> = [];
  let truncated = false;
  const directory = await opendir(root);
  for await (const entry of directory) {
    if (items.length >= 50) {
      truncated = true;
      break;
    }
    try {
      const snapshot = await snapshotSkillSource(root, entry.name);
      items.push({
        name: entry.name,
        state: "untrusted",
        metadata: snapshot.metadata,
        contentHash: snapshot.contentHash,
      });
    } catch {
      items.push({
        name: entry.name,
        state: "untrusted",
        error: "Source is not a readable, valid, unlinked skill package",
      });
    }
  }
  return { items, truncated, available: true };
}
