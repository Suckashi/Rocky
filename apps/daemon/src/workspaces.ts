import { lstat, realpath, open, opendir } from "node:fs/promises";
import { constants, type BigIntStats } from "node:fs";
import { resolve, relative, isAbsolute, parse, sep } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import type { Store } from "./store.js";
import {
  workspaceSchema,
  workspaceSaveSchema,
} from "../../../packages/contracts/src/workspaces.js";
import { RockyError } from "../../../packages/contracts/src/index.js";
import { intentHash } from "./intent.js";
import { resolveFileTarget, recheckFileTarget } from "./file-target.js";
const key = (path: string) =>
  process.platform === "win32" ? path.toLowerCase() : path;
const within = (root: string, path: string) => {
  const rel = relative(key(root), key(path));
  return (
    rel === "" ||
    (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep))
  );
};
const identity = (stat: BigIntStats) =>
  intentHash({
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    created: stat.birthtimeNs.toString(),
  });
const denied = () =>
  new RockyError(
    "workspace_denied",
    "Workspace path is unavailable or outside the authorized scope",
    403,
  );
const sensitive = (path: string) =>
  path
    .replaceAll("\\", "/")
    .split("/")
    .some(
      (part) =>
        /^(\.git|\.ssh|\.aws|\.azure|\.codex|\.agents|\.rocky.*|browser-profiles|credentials|secrets)$/i.test(
          part,
        ) ||
        /^\.env(?:\.|$)/i.test(part) ||
        /\.(sqlite|sqlite3|db)(?:-(?:wal|shm))?$/i.test(part),
    );
export class WorkspaceRegistry {
  constructor(private readonly store: Store) {}
  list() {
    return (
      this.store.db
        .prepare("SELECT data FROM workspaces ORDER BY id")
        .all() as { data: string }[]
    ).map((row) => workspaceSchema.parse(JSON.parse(row.data)));
  }
  get(id: string) {
    const found = this.list().find((w) => w.id === id);
    if (!found) throw new RockyError("not_found", "Workspace not found", 404);
    return found;
  }
  private async canonical(input: string) {
    try {
      return await this.resolveRoot(input);
    } catch (error) {
      if (error instanceof RockyError) throw error;
      throw denied();
    }
  }
  private async resolveRoot(input: string) {
    if (
      !isAbsolute(input) ||
      /^[/\\]{2}/.test(input) ||
      /[\x00-\x1f]/.test(input)
    )
      throw denied();
    const candidate = resolve(input),
      root = parse(candidate).root;
    if (key(candidate) === key(root) || key(candidate) === key(homedir()))
      throw denied();
    let current = root;
    for (const part of relative(root, candidate).split(sep).filter(Boolean)) {
      current = resolve(current, part);
      const stat = await lstat(current, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw denied();
    }
    const canonical = await realpath(candidate),
      stat = await lstat(canonical, { bigint: true });
    if (
      within(this.store.root, canonical) ||
      sensitive(canonical) ||
      (process.env.SystemRoot && within(process.env.SystemRoot, canonical))
    )
      throw denied();
    return { root: canonical, rootIdentity: identity(stat) };
  }
  async save(input: unknown) {
    const command = workspaceSaveSchema.parse(input),
      hash = intentHash(command);
    const receipt = this.store.db
      .prepare("SELECT intent,data FROM workspace_receipts WHERE request_id=?")
      .get(command.requestId) as { intent: string; data: string } | undefined;
    if (receipt) {
      if (receipt.intent !== hash)
        throw new RockyError(
          "idempotency_conflict",
          "Workspace request changed",
          409,
        );
      return workspaceSchema.parse(JSON.parse(receipt.data));
    }
    const resolved = await this.canonical(command.root),
      now = new Date().toISOString();
    return this.store.transaction(() => {
      const repeated = this.store.db
        .prepare(
          "SELECT intent,data FROM workspace_receipts WHERE request_id=?",
        )
        .get(command.requestId) as { intent: string; data: string } | undefined;
      if (repeated) {
        if (repeated.intent !== hash)
          throw new RockyError(
            "idempotency_conflict",
            "Workspace request changed",
            409,
          );
        return workspaceSchema.parse(JSON.parse(repeated.data));
      }
      const old = this.list().find((w) => w.id === command.id);
      if ((old?.revision ?? 0) !== command.expectedRevision)
        throw new RockyError(
          "stale_workspace",
          "Workspace revision changed",
          409,
        );
      if (
        this.list().some(
          (w) => w.id !== command.id && key(w.root) === key(resolved.root),
        )
      )
        throw new RockyError(
          "duplicate_workspace",
          "Canonical root is already registered",
          409,
        );
      if (
        old &&
        this.store
          .list()
          .some(
            (w) =>
              w.workspaceId === old.id &&
              !["completed", "failed", "cancelled", "interrupted"].includes(
                w.status,
              ),
          )
      )
        throw new RockyError(
          "workspace_busy",
          "Workspace is reserved by unfinished Work",
          409,
        );
      const data = workspaceSchema.parse({
        id: command.id,
        name: command.name,
        ...resolved,
        revision: (old?.revision ?? 0) + 1,
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
      });
      this.store.db
        .prepare(
          "INSERT INTO workspaces VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET root_key=excluded.root_key,data=excluded.data",
        )
        .run(data.id, key(data.root), JSON.stringify(data));
      this.store.db
        .prepare("INSERT INTO workspace_receipts VALUES(?,?,?)")
        .run(command.requestId, hash, JSON.stringify(data));
      return data;
    });
  }
  async root(id: string, revision: number) {
    const workspace = this.get(id);
    if (workspace.revision !== revision)
      throw new RockyError(
        "stale_workspace",
        "Workspace revision changed",
        409,
      );
    const current = await this.canonical(workspace.root);
    if (
      current.rootIdentity !== workspace.rootIdentity ||
      key(current.root) !== key(workspace.root)
    )
      throw new RockyError(
        "workspace_changed",
        "Workspace root identity changed",
        409,
      );
    return workspace;
  }
  check(root: string, path: string) {
    if (sensitive(path) || within(this.store.root, resolve(root, path)))
      throw denied();
  }
  async read(
    id: string,
    revision: number,
    path: string,
    expectedHash?: string,
  ) {
    const workspace = await this.root(id, revision);
    this.check(workspace.root, path);
    const target = await resolveFileTarget(workspace.root, path);
    if (!target.exists || target.size! > 1048576)
      throw new RockyError(
        "workspace_preview_limit",
        "Text preview requires an existing file no larger than 1 MiB",
        422,
      );
    if (expectedHash && expectedHash !== target.contentHash)
      throw new RockyError("file_changed", "File revision changed", 409);
    const file = await open(
      target.canonicalPath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const stat = await file.stat({ bigint: true });
      if (!stat.isFile() || stat.nlink !== 1n || stat.size > 1048576n)
        throw denied();
      const chunks: Buffer[] = [],
        buffer = Buffer.alloc(65536);
      let size = 0;
      for (;;) {
        const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        size += bytesRead;
        if (size > 1048576) throw denied();
        chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
      }
      const bytes = Buffer.concat(chunks),
        hash = createHash("sha256").update(bytes).digest("hex");
      await recheckFileTarget(target);
      await this.root(id, revision);
      if (hash !== target.contentHash)
        throw new RockyError("file_changed", "File changed during read", 409);
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (text.includes("\0")) throw Error();
      } catch {
        throw new RockyError(
          "binary_preview_unavailable",
          "Only UTF-8 text preview is supported",
          422,
        );
      }
      return {
        workspaceId: id,
        workspaceRevision: revision,
        path: target.relativePath,
        sha256: hash,
        size,
        text,
      };
    } finally {
      await file.close();
    }
  }
  async files(id: string, revision: number, path = "") {
    const workspace = await this.root(id, revision);
    this.check(workspace.root, path);
    let directory = workspace.root;
    if (path) {
      const parts = path.replaceAll("\\", "/").split("/");
      if (
        isAbsolute(path) ||
        parts.some(
          (p) =>
            !p ||
            p === "." ||
            p === ".." ||
            /[\x00-\x1f:]/.test(p) ||
            /[. ]$/.test(p),
        )
      )
        throw denied();
      for (const part of parts) {
        directory = resolve(directory, part);
        const stat = await lstat(directory, { bigint: true });
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw denied();
      }
    }
    const directoryIdentity = identity(
      await lstat(directory, { bigint: true }),
    );
    const entries: { name: string; kind: "directory" | "file" }[] = [];
    let scanned = 0,
      truncated = false;
    const dir = await opendir(directory);
    for await (const entry of dir) {
      if (++scanned > 2000 || entries.length >= 200) {
        truncated = true;
        break;
      }
      if (sensitive(entry.name) || entry.isSymbolicLink()) continue;
      if (within(this.store.root, resolve(directory, entry.name))) continue;
      if (entry.isDirectory() || entry.isFile())
        entries.push({
          name: entry.name,
          kind: entry.isDirectory() ? "directory" : "file",
        });
    }
    await this.root(id, revision);
    if (
      identity(await lstat(directory, { bigint: true })) !==
        directoryIdentity ||
      !within(workspace.root, await realpath(directory))
    )
      throw denied();
    return {
      workspaceId: id,
      workspaceRevision: revision,
      path,
      entries,
      truncated,
    };
  }
}
