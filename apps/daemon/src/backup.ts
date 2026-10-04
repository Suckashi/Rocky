import { DatabaseSync, backup as backupSqlite } from "node:sqlite";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  realpath,
  mkdir,
  readdir,
  open,
  readFile,
  writeFile,
  unlink,
} from "node:fs/promises";
import {
  resolve,
  join,
  dirname,
  relative,
  parse,
  sep,
  isAbsolute,
} from "node:path";
import { z } from "zod";
import { acquireWriterLock } from "./writer-lock.js";
import { Store } from "./store.js";
import { OperationLedger } from "./operation-ledger.js";
import { STORE_SCHEMA_VERSION, GRAPH_FORMAT } from "./storage-metadata.js";
const manifestSchema = z.strictObject({
  format: z.literal(1),
  productId: z.literal("rocky"),
  createdAt: z.iso.datetime(),
  schemaVersion: z.number().int().min(1).max(STORE_SCHEMA_VERSION),
  graphFormat: z.literal(GRAPH_FORMAT),
  engine: z.strictObject({
    node: z.string(),
    modulesAbi: z.string(),
    sqlite: z.string(),
    platform: z.string(),
    arch: z.string(),
  }),
  fileCount: z.number().int().min(1).max(100000),
  totalBytes: z
    .number()
    .int()
    .nonnegative()
    .max(50 * 1024 ** 3),
  files: z
    .array(
      z.strictObject({
        path: z.string().min(1).max(2048),
        bytes: z
          .number()
          .int()
          .nonnegative()
          .max(10 * 1024 ** 3),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .max(100000),
});
const canonical = (path: string) =>
  process.platform === "win32" ? path.toLowerCase() : path;
const fail = (message: string): never => {
  throw Error(message);
};
async function checked(path: string) {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of relative(current, absolute).split(sep).filter(Boolean)) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink())
      fail("Linked backup/restore paths are not supported");
  }
  if (canonical(await realpath(absolute)) !== canonical(absolute))
    fail("Canonical backup path changed");
  return lstat(absolute, { bigint: true });
}
function portable(path: string) {
  if (
    !path ||
    isAbsolute(path) ||
    path.includes("\\") ||
    path
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[:\x00-\x1f]/.test(part) ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  )
    fail("Unsafe backup manifest path");
  return path;
}
function separate(a: string, b: string) {
  for (const [parent, child] of [
    [a, b],
    [b, a],
  ]) {
    const path = relative(canonical(parent!), canonical(child!));
    if (
      !path ||
      (!path.startsWith(".." + sep) && path !== ".." && !isAbsolute(path))
    )
      fail("Source and destination must be separate directories");
  }
}
async function emptyTarget(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (!(await checked(path)).isDirectory() || (await readdir(path)).length)
    fail("Destination must be a new empty directory");
}
async function ownedManifest(root: string) {
  await checked(root);
  const path = join(root, "manifest.json");
  const stat = await checked(path);
  if (!stat.isFile() || stat.size > 65536n || stat.nlink !== 1n)
    fail("Invalid Rocky manifest");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  if (manifest.productId !== "rocky" || manifest.schemaVersion !== 1)
    fail("Not a supported Rocky data directory; no database was read");
  return manifest;
}
async function inventory(root: string, skip: Set<string>) {
  const files: string[] = [];
  let entries = 0;
  async function walk(directory: string, prefix: string, depth: number) {
    if (depth > 64) fail("Backup directory depth exceeds limit");
    await checked(directory);
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (++entries > 100000) fail("Backup entry limit exceeded");
      const path = portable(prefix + item.name);
      if (skip.has(path)) continue;
      const stat = await checked(join(root, path));
      if (stat.isDirectory())
        await walk(join(root, path), path + "/", depth + 1);
      else if (
        stat.isFile() &&
        stat.nlink === 1n &&
        stat.size <= BigInt(10 * 1024 ** 3)
      )
        files.push(path);
      else fail("Backup contains a linked, special or oversized file");
    }
  }
  await walk(root, "", 0);
  return files.sort();
}
async function copyOrHash(source: string, destination?: string) {
  const before = await checked(source);
  if (
    !before.isFile() ||
    before.nlink !== 1n ||
    before.size > BigInt(10 * 1024 ** 3)
  )
    fail("Invalid backup file");
  const input = await open(
    source,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  let output: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const opened = await input.stat({ bigint: true });
    if (opened.dev !== before.dev || opened.ino !== before.ino)
      fail("Source file changed before reading");
    if (destination) {
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await checked(dirname(destination));
      output = await open(
        destination,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
    }
    const hash = createHash("sha256"),
      buffer = Buffer.alloc(1024 * 1024);
    let bytes = 0;
    while (true) {
      const result = await input.read(buffer, 0, buffer.length, bytes);
      if (!result.bytesRead) break;
      bytes += result.bytesRead;
      if (BigInt(bytes) > before.size) fail("Source grew during backup");
      hash.update(buffer.subarray(0, result.bytesRead));
      if (output) {
        let written = 0;
        while (written < result.bytesRead)
          written += (
            await output.write(buffer, written, result.bytesRead - written)
          ).bytesWritten;
      }
    }
    const after = await checked(source);
    if (
      bytes !== Number(before.size) ||
      after.ino !== before.ino ||
      after.dev !== before.dev ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs
    )
      fail("Source changed during backup");
    if (output) await output.sync();
    return { bytes, sha256: hash.digest("hex") };
  } finally {
    await input.close();
    await output?.close();
  }
}
function databaseVersion(db: DatabaseSync) {
  const version = (
    db.prepare("PRAGMA user_version").get() as { user_version: number }
  ).user_version;
  if (version < 1 || version > STORE_SCHEMA_VERSION)
    fail("Unsupported Rocky database schema");
  const check = db.prepare("PRAGMA integrity_check").all();
  if (check.length !== 1 || Object.values(check[0]!)[0] !== "ok")
    fail("SQLite integrity check failed");
  return version;
}
export async function createBackup(
  sourceInput: string,
  destinationInput: string,
) {
  const source = resolve(sourceInput),
    destination = resolve(destinationInput);
  separate(source, destination);
  await ownedManifest(source);
  if (
    (await readdir(source)).some((name) =>
      [
        "rocky-backup.json",
        ".restore-incomplete",
        ".backup-incomplete",
      ].includes(name),
    )
  )
    fail("Source is a backup or incomplete restore");
  const domainPath = join(source, "domain.sqlite");
  await checked(domainPath);
  for (const name of [
    "writer-lock.sqlite",
    "writer-lock.sqlite-journal",
    "writer-lock.sqlite-wal",
    "writer-lock.sqlite-shm",
    "daemon.lock",
  ]) {
    try {
      const stat = await checked(join(source, name));
      if (!stat.isFile() || stat.nlink !== 1n) fail("Unsafe writer lock file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const release = acquireWriterLock(source);
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(domainPath, {
      readOnly: true,
      allowExtension: false,
    });
    const schemaVersion = databaseVersion(db);
    if (
      schemaVersion >= 29 &&
      db
        .prepare(
          "SELECT 1 FROM browser_profiles WHERE json_extract(data,'$.state') NOT IN ('closed','configured','unavailable') LIMIT 1",
        )
        .get()
    )
      fail(
        "Close or resolve all Rocky browser profiles before a complete backup",
      );
    await emptyTarget(destination);
    await writeFile(
      join(destination, ".backup-incomplete"),
      "Incomplete Rocky backup; never activate this directory",
      { flag: "wx", mode: 0o600 },
    );
    const skip = new Set([
      "daemon.lock",
      "writer-lock.sqlite",
      "writer-lock.sqlite-journal",
      "writer-lock.sqlite-wal",
      "writer-lock.sqlite-shm",
      "domain.sqlite-wal",
      "domain.sqlite-shm",
      "graph-checkpoints.sqlite-wal",
      "graph-checkpoints.sqlite-shm",
    ]);
    const paths = await inventory(source, skip),
      files: z.infer<typeof manifestSchema>["files"] = [];
    let totalBytes = 0;
    for (const path of paths) {
      const target = join(destination, path);
      let record: { bytes: number; sha256: string };
      if (["domain.sqlite", "graph-checkpoints.sqlite"].includes(path)) {
        const snapshotSource: DatabaseSync =
          path === "domain.sqlite"
            ? db
            : new DatabaseSync(join(source, path), {
                readOnly: true,
                allowExtension: false,
              });
        try {
          await backupSqlite(snapshotSource, target);
          // Seal the owned snapshot without WAL sidecars before hashing it.
          // Read-only verification must not mutate the backup inventory.
          const snapshot = new DatabaseSync(target, { allowExtension: false });
          try {
            snapshot.exec("PRAGMA journal_mode=DELETE");
          } finally {
            snapshot.close();
          }
          record = await copyOrHash(target);
        } finally {
          if (snapshotSource !== db) snapshotSource.close();
        }
      } else record = await copyOrHash(join(source, path), target);
      totalBytes += record.bytes;
      if (totalBytes > 50 * 1024 ** 3) fail("Backup total byte limit exceeded");
      files.push({ path, ...record });
    }
    const manifest = manifestSchema.parse({
      format: 1,
      productId: "rocky",
      createdAt: new Date().toISOString(),
      schemaVersion,
      graphFormat: GRAPH_FORMAT,
      engine: {
        node: process.version,
        modulesAbi: process.versions.modules,
        sqlite: process.versions.sqlite ?? "unknown",
        platform: process.platform,
        arch: process.arch,
      },
      fileCount: files.length,
      totalBytes,
      files,
    });
    const text = JSON.stringify(manifest, null, 2);
    if (Buffer.byteLength(text) > 16 * 1024 ** 2)
      fail("Backup manifest exceeds size limit");
    await writeFile(join(destination, "rocky-backup.json"), text, {
      flag: "wx",
      mode: 0o600,
    });
    await unlink(join(destination, ".backup-incomplete"));
    return {
      productId: "rocky",
      destination,
      fileCount: files.length,
      totalBytes,
      schemaVersion,
    };
  } finally {
    db?.close();
    release();
  }
}
export async function verifyBackup(rootInput: string) {
  const root = resolve(rootInput);
  await checked(root);
  const path = join(root, "rocky-backup.json"),
    stat = await checked(path);
  if (stat.size > BigInt(16 * 1024 ** 2) || !stat.isFile())
    fail("Invalid backup manifest size");
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(path, "utf8")),
  );
  if (
    manifest.fileCount !== manifest.files.length ||
    manifest.totalBytes !==
      manifest.files.reduce((sum, file) => sum + file.bytes, 0)
  )
    fail("Backup manifest counts differ");
  const names = manifest.files.map((file) => portable(file.path));
  if (
    new Set(names.map((path) => path.toLowerCase())).size !== names.length ||
    !names.includes("manifest.json") ||
    !names.includes("domain.sqlite") ||
    names.some((name) =>
      [
        "daemon.lock",
        "writer-lock.sqlite",
        "rocky-backup.json",
        ".restore-incomplete",
        ".backup-incomplete",
      ].includes(name),
    )
  )
    fail("Invalid backup file inventory");
  const actual = await inventory(root, new Set(["rocky-backup.json"]));
  if (JSON.stringify(actual) !== JSON.stringify([...names].sort()))
    fail("Backup contains missing or unexpected files");
  for (const file of manifest.files) {
    const observed = await copyOrHash(join(root, file.path));
    if (observed.bytes !== file.bytes || observed.sha256 !== file.sha256)
      fail("Backup file checksum mismatch: " + file.path);
  }
  await ownedManifest(root);
  const db = new DatabaseSync(join(root, "domain.sqlite"), {
    readOnly: true,
    allowExtension: false,
  });
  try {
    if (databaseVersion(db) !== manifest.schemaVersion)
      fail("Backup database schema differs from manifest");
  } finally {
    db.close();
  }
  return manifest;
}
export async function restoreBackup(
  sourceInput: string,
  destinationInput: string,
) {
  const source = resolve(sourceInput),
    destination = resolve(destinationInput);
  separate(source, destination);
  const manifest = await verifyBackup(source); // Validate everything before writing the destination.
  await emptyTarget(destination);
  await writeFile(
    join(destination, ".restore-incomplete"),
    "Restore is incomplete; do not start Rocky",
    { flag: "wx", mode: 0o600 },
  );
  for (const file of manifest.files) {
    const copied = await copyOrHash(
      join(source, file.path),
      join(destination, file.path),
    );
    if (copied.sha256 !== file.sha256 || copied.bytes !== file.bytes)
      fail("Backup changed during restore");
  }
  const store = new Store(destination, { restoreRecovery: true });
  try {
    for (const work of store.list())
      if (["queued", "running", "waiting_approval"].includes(work.status)) {
        work.status = "blocked";
        work.error =
          "Restored from backup; review prior effects and start an explicit new Work. Nothing was replayed.";
        if (work.approval?.status === "pending")
          work.approval.status = "expired";
        work.revision++;
        new OperationLedger(store).finishUndispatched(work, "restarted", () => {
          store.save(work, work.revision - 1);
          store.event(work, "rocky.work.updated", { work });
          store.event(work, "rocky.store.restored", {
            backupCreatedAt: manifest.createdAt,
            effectsReplayed: false,
          });
        });
      }
    store.transaction(() => {
      store.db.exec(
        "UPDATE capability_grants SET data=json_set(data,'$.revoked',json('true'),'$.revision',json_extract(data,'$.revision')+1) WHERE json_extract(data,'$.revoked')=0; UPDATE routines SET data=json_set(data,'$.config.enabled',json('false'),'$.revision',json_extract(data,'$.revision')+1); UPDATE tracked_works SET data=json_set(data,'$.config.enabled',json('false'),'$.revision',json_extract(data,'$.revision')+1); UPDATE learning_policy SET data=json_set(data,'$.mode','off','$.scopes',json('[]'),'$.automation',null,'$.revision',json_extract(data,'$.revision')+1); UPDATE environments SET data=json_set(data,'$.state','unknown','$.error','Restored environment requires explicit inspection','$.revision',json_extract(data,'$.revision')+1); UPDATE browser_profiles SET data=json_set(data,'$.state','closed','$.freshSnapshotRequired',json('true'),'$.revision',json_extract(data,'$.revision')+1);",
      );
    });
  } finally {
    store.close();
  }
  await unlink(join(destination, ".restore-incomplete"));
  return {
    productId: "rocky",
    destination,
    fileCount: manifest.fileCount,
    schemaVersion: STORE_SCHEMA_VERSION,
    effectsReplayed: false,
    grantsRevoked: true,
    automation: "disabled",
  };
}
