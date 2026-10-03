import { z } from "zod";
import { homedir } from "node:os";
import { join } from "node:path";
import { discoverSkillSources, snapshotSkillSource } from "./skill-sources.js";
import { parseDocument } from "yaml";
import { replacementDiff } from "./write-diff.js";
import { Store } from "./store.js";
import { WorkspaceRegistry } from "./workspaces.js";
import { validateSkillPackage } from "./skill-package.js";
import { intentHash } from "./intent.js";
import { RockyError } from "../../../packages/contracts/src/index.js";
import type { Work } from "../../../packages/contracts/src/index.js";

const importSchema = z
  .object({
    requestId: z.uuid(),
    id: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    scope: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("user") }).strict(),
      z.object({ kind: z.literal("project"), projectId: z.uuid() }).strict(),
    ]),
    source: z
      .object({
        type: z.enum(["manual", "global", "project"]),
        reference: z.string().trim().min(1).max(2048),
        license: z.string().trim().min(1).max(4096),
      })
      .strict(),
    package: z.unknown(),
  })
  .strict();
type Snapshot = ReturnType<typeof validateSkillPackage>;
// Native middleware deduplicates by name. Preserve the portable package and
// qualify only its runtime metadata view with the registry identity (max64).
function runtimeName(name: string, id: string) {
  return `${name.slice(0, 27).replace(/-+$/, "")}-${id}`;
}
const selectionSchema = z
  .object({
    requestId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    skillRevision: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    action: z.enum(["publish", "deactivate", "quarantine"]),
  })
  .strict();
type SkillSelection = {
  id: string;
  revision: number;
  skillRevision: number;
  contentHash: string;
  state: "published" | "inactive" | "quarantined";
  updatedAt: string;
};
type CatalogItem = {
  id: string;
  revision: number;
  contentHash: string;
  name: string;
  description: string;
  scope: SkillRevision["scope"];
};
type SkillCatalog = {
  workId: string;
  runId: string;
  items: CatalogItem[];
  version: string;
};
type SkillRevision = {
  id: string;
  revision: number;
  scope: z.infer<typeof importSchema>["scope"];
  source: z.infer<typeof importSchema>["source"];
  state: "untrusted";
  contentHash: string;
  metadata: Snapshot["metadata"];
  totalBytes: number;
  files: Array<Omit<Snapshot["files"][number], "contentBase64">>;
  createdAt: string;
};
export class SkillRegistry {
  constructor(
    private store: Store,
    private workspaces: WorkspaceRegistry,
  ) {}
  private async sourceRoot(input: unknown) {
    const scope = importSchema.shape.scope.parse(input);
    if (scope.kind === "user") return join(homedir(), ".agents", "skills");
    const registered = this.workspaces.get(scope.projectId);
    const workspace = await this.workspaces.root(
      registered.id,
      registered.revision,
    );
    return join(workspace.root, ".agents", "skills");
  }
  async discover(input: unknown) {
    const command = z
      .object({ scope: importSchema.shape.scope })
      .strict()
      .parse(input);
    return discoverSkillSources(await this.sourceRoot(command.scope));
  }
  async sourceSnapshot(input: unknown) {
    const command = z
      .object({
        scope: importSchema.shape.scope,
        name: z.string(),
        expectedHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .parse(input);
    const root = await this.sourceRoot(command.scope);
    const snapshot = await snapshotSkillSource(root, command.name);
    if (snapshot.contentHash !== command.expectedHash)
      throw new RockyError(
        "skill_source_changed",
        "Source changed since discovery; discover and review again",
        409,
      );
    return {
      package: snapshot.package,
      contentHash: snapshot.contentHash,
      scope: command.scope,
      source: {
        type: command.scope.kind === "user" ? "global" : "project",
        reference: join(root, command.name),
      },
      state: "untrusted",
    };
  }
  import(input: unknown) {
    const command = importSchema.parse(input);
    const snapshot = validateSkillPackage(command.package);
    const intent = intentHash({ ...command, package: snapshot.contentHash });
    return this.store.transaction(() => {
      const prior = this.store.db
        .prepare(
          "SELECT intent,result FROM skill_import_receipts WHERE request_id=?",
        )
        .get(command.requestId) as
        { intent: string; result: string } | undefined;
      if (prior) {
        if (prior.intent !== intent)
          throw new RockyError(
            "idempotency_conflict",
            "Skill import changed",
            409,
          );
        return JSON.parse(prior.result) as SkillRevision;
      }
      if (command.scope.kind === "project")
        this.workspaces.get(command.scope.projectId);
      const row = this.store.db
        .prepare("SELECT data FROM skill_heads WHERE id=?")
        .get(command.id) as { data: string } | undefined;
      const head = row ? (JSON.parse(row.data) as SkillRevision) : undefined;
      if ((head?.revision ?? 0) !== command.expectedRevision)
        throw new RockyError("stale_skill", "Skill revision changed", 409);
      if (head && intentHash(head.scope) !== intentHash(command.scope))
        throw new RockyError("skill_scope", "Skill scope cannot change", 409);
      // Content is stored once per hash. Only registry commands may select active revisions later.
      const data = JSON.stringify(snapshot);
      const existing = this.store.db
        .prepare("SELECT data FROM skill_packages WHERE hash=?")
        .get(snapshot.contentHash) as { data: string } | undefined;
      if (existing && existing.data !== data)
        throw new RockyError(
          "skill_integrity",
          "Package hash conflicts with stored data",
          409,
        );
      this.store.db
        .prepare("INSERT OR IGNORE INTO skill_packages VALUES(?,?)")
        .run(snapshot.contentHash, data);
      const revision: SkillRevision = {
        id: command.id,
        revision: command.expectedRevision + 1,
        scope: command.scope,
        source: command.source,
        state: "untrusted",
        contentHash: snapshot.contentHash,
        metadata: snapshot.metadata,
        totalBytes: snapshot.totalBytes,
        files: snapshot.files.map(({ path, bytes, sha256 }) => ({
          path,
          bytes,
          sha256,
        })),
        createdAt: new Date().toISOString(),
      };
      const result = JSON.stringify(revision);
      this.store.db
        .prepare("INSERT INTO skill_revisions VALUES(?,?,?)")
        .run(command.id, revision.revision, result);
      this.store.db
        .prepare(
          "INSERT INTO skill_heads VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        )
        .run(command.id, result);
      this.store.db
        .prepare("INSERT INTO skill_import_receipts VALUES(?,?,?)")
        .run(command.requestId, intent, result);
      return revision;
    });
  }
  list() {
    return (
      this.store.db
        .prepare("SELECT data FROM skill_heads ORDER BY id LIMIT 200")
        .all() as { data: string }[]
    ).map((row) => JSON.parse(row.data) as SkillRevision);
  }
  diff(id: string, from: number, to: number, path?: string) {
    const before = this.get(id, from),
      after = this.get(id, to);
    const old = new Map(before.package.files.map((file) => [file.path, file]));
    const next = new Map(after.package.files.map((file) => [file.path, file]));
    const files = [...new Set([...old.keys(), ...next.keys()])]
      .sort()
      .flatMap((path) => {
        const a = old.get(path),
          b = next.get(path);
        return a?.sha256 === b?.sha256
          ? []
          : [
              {
                path,
                status: !a ? "added" : !b ? "removed" : "modified",
                previousHash: a?.sha256 ?? null,
                nextHash: b?.sha256 ?? null,
                previousBytes: a?.bytes ?? 0,
                nextBytes: b?.bytes ?? 0,
              },
            ];
      });
    let preview: ReturnType<typeof replacementDiff> | null = null;
    let binary = false;
    if (path !== undefined) {
      z.string().min(1).max(512).parse(path);
      if (!old.has(path) && !next.has(path))
        throw new RockyError(
          "skill_file",
          "File not present in either revision",
          404,
        );
      const decode = (file: Snapshot["files"][number] | undefined) => {
        if (!file) return "";
        const bytes = Buffer.from(file.contentBase64, "base64"),
          text = bytes.toString("utf8");
        if (!Buffer.from(text).equals(bytes) || text.includes("\0"))
          return null;
        if (this.store.publicEvidence(text) !== text)
          throw new RockyError(
            "skill_content",
            "Protected content cannot be diffed",
            403,
          );
        return text;
      };
      const a = decode(old.get(path)),
        b = decode(next.get(path));
      binary = a === null || b === null;
      if (!binary) preview = replacementDiff(a!, b!);
    }
    return {
      from,
      to,
      previousHash: before.revision.contentHash,
      nextHash: after.revision.contentHash,
      files,
      path: path ?? null,
      binary,
      preview,
    };
  }
  freeze(work: Work): SkillCatalog {
    if (!this.store.db.isTransaction)
      throw new RockyError(
        "skill_transaction",
        "Catalog freeze requires admission transaction",
        500,
      );
    const existing = this.catalog(work.id);
    if (existing) {
      if (existing.runId !== work.runId)
        throw new RockyError(
          "skill_catalog",
          "Catalog belongs to another run",
          409,
        );
      return existing;
    }
    const items: CatalogItem[] = [];
    if (work.mode === "configured" && work.runMode === "normal") {
      const rows = this.store.db
        .prepare("SELECT data FROM skill_selections ORDER BY id")
        .all() as { data: string }[];
      for (const row of rows) {
        const selected = JSON.parse(row.data) as SkillSelection;
        if (selected.state !== "published") continue;
        const revision = this.revision(selected.id, selected.skillRevision);
        if (
          revision.scope.kind === "project" &&
          revision.scope.projectId !== work.workspaceId
        )
          continue;
        if (
          this.store.db
            .prepare("SELECT 1 FROM skill_quarantine WHERE id=? AND hash=?")
            .get(selected.id, selected.contentHash)
        )
          continue;
        if (revision.contentHash !== selected.contentHash)
          throw new RockyError(
            "skill_integrity",
            "Selected skill hash changed",
            409,
          );
        this.get(selected.id, selected.skillRevision);
        items.push({
          id: selected.id,
          revision: selected.skillRevision,
          contentHash: selected.contentHash,
          name: revision.metadata.name,
          description: revision.metadata.description,
          scope: revision.scope,
        });
      }
    }
    const catalog: SkillCatalog = {
      workId: work.id,
      runId: work.runId,
      items,
      version: intentHash(items),
    };
    this.store.db
      .prepare("INSERT INTO skill_catalogs VALUES(?,?)")
      .run(work.id, JSON.stringify(catalog));
    return catalog;
  }
  catalog(workId: string): SkillCatalog | null {
    z.uuid().parse(workId);
    const row = this.store.db
      .prepare("SELECT data FROM skill_catalogs WHERE work_id=?")
      .get(workId) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as SkillCatalog) : null;
  }
  readForWork(work: Work, skillId: string) {
    const current = this.store.get(work.id);
    const catalog = this.catalog(work.id);
    if (
      current.runId !== work.runId ||
      current.executionSessionId !== work.executionSessionId ||
      current.status !== "running" ||
      catalog?.runId !== work.runId
    )
      throw new RockyError(
        "skill_scope",
        "Skill read requires this running Work",
        403,
      );
    const item = catalog.items.find((item) => item.id === skillId);
    if (!item)
      throw new RockyError(
        "skill_scope",
        "Skill is outside the frozen catalog",
        403,
      );
    if (
      this.store.db
        .prepare("SELECT 1 FROM skill_quarantine WHERE id=? AND hash=?")
        .get(item.id, item.contentHash)
    )
      throw new RockyError(
        "skill_quarantined",
        "Skill revision was quarantined",
        403,
      );
    const result = this.get(item.id, item.revision);
    if (result.revision.contentHash !== item.contentHash)
      throw new RockyError("skill_integrity", "Frozen skill hash changed", 409);
    return result;
  }
  selection(id: string): SkillSelection | null {
    z.uuid().parse(id);
    const row = this.store.db
      .prepare("SELECT data FROM skill_selections WHERE id=?")
      .get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as SkillSelection) : null;
  }
  assertToolsAllowed(work: Work) {
    const revoked = this.store.db
      .prepare(
        "SELECT 1 FROM events e JOIN skill_quarantine q ON q.id=json_extract(e.data,'$.payload.data.skillId') AND q.hash=json_extract(e.data,'$.payload.data.contentHash') WHERE json_extract(e.data,'$.runId')=? AND json_extract(e.data,'$.payload.name')='rocky.skill.loaded' LIMIT 1",
      )
      .get(work.runId);
    if (revoked)
      throw new RockyError(
        "skill_revoked",
        "A skill loaded by this Work was quarantined; stop and start a new Work with a reviewed catalog",
        403,
      );
  }
  backend(work: Work, input: unknown) {
    const command = z
      .object({
        operation: z.enum(["sources", "list", "read"]),
        path: z.string().max(1024).optional(),
        metadata: z.boolean().default(false),
      })
      .strict()
      .parse(input);
    const current = this.store.get(work.id);
    if (
      current.runId !== work.runId ||
      current.executionSessionId !== work.executionSessionId ||
      current.status !== "running"
    )
      throw new RockyError(
        "skill_scope",
        "Skill backend requires active execution",
        403,
      );
    const catalog = this.catalog(work.id);
    if (command.operation === "sources")
      return (catalog?.items ?? []).map(
        (item) => `/skills/${item.id}/${runtimeName(item.name, item.id)}/`,
      );
    const path = command.path ?? "";
    if (
      !path.startsWith("/") ||
      path.includes("\\") ||
      path.includes("\0") ||
      path.split("/").some((part) => part === "." || part === "..")
    )
      throw new RockyError("skill_path", "Invalid skill path", 403);
    // CompositeBackend strips its /skills/ mount prefix.
    const [, id, name, ...parts] = path.split("/");
    if (!id || !name)
      throw new RockyError("skill_path", "Skill identity path required", 403);
    const result = this.readForWork(work, id);
    if (name !== runtimeName(result.revision.metadata.name, id))
      throw new RockyError(
        "skill_path",
        "Skill path does not match catalog",
        403,
      );
    const relative = parts.join("/");
    if (command.operation === "list") {
      const prefix =
        relative && !relative.endsWith("/") ? relative + "/" : relative;
      const entries = new Map<
        string,
        { path: string; is_dir: boolean; size?: number }
      >();
      for (const file of result.package.files) {
        if (!file.path.startsWith(prefix)) continue;
        const rest = file.path.slice(prefix.length),
          first = rest.split("/")[0]!;
        const is_dir = rest.includes("/");
        const entryPath = `/${id}/${name}/${prefix}${first}${is_dir ? "/" : ""}`;
        entries.set(entryPath, {
          path: entryPath,
          is_dir,
          ...(!is_dir ? { size: file.bytes } : {}),
        });
      }
      return [...entries.values()];
    }
    const file = result.package.files.find((file) => file.path === relative);
    if (!file) throw new RockyError("skill_file", "Skill file not found", 404);
    const text = Buffer.from(file.contentBase64, "base64").toString("utf8");
    if (this.store.publicEvidence(text) !== text)
      throw new RockyError(
        "skill_content",
        "Protected skill content cannot be delivered",
        403,
      );
    if (command.metadata) {
      if (relative !== "SKILL.md")
        throw new RockyError(
          "skill_path",
          "Metadata discovery only reads SKILL.md",
          403,
        );
      const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(
        text,
      );
      if (!match)
        throw new RockyError(
          "skill_integrity",
          "Skill frontmatter missing",
          409,
        );
      const document = parseDocument(match[1]!);
      document.set("name", name);
      // Discovery needs metadata only. Body reads retain original exact bytes.
      return {
        contentBase64: Buffer.from(`---\n${document.toString()}---\n`).toString(
          "base64",
        ),
        createdAt: result.revision.createdAt,
      };
    }
    if (!command.metadata)
      this.store.event(current, "rocky.skill.loaded", {
        skillId: id,
        revision: result.revision.revision,
        contentHash: result.revision.contentHash,
        path: relative,
      });
    return {
      contentBase64: file.contentBase64,
      createdAt: result.revision.createdAt,
    };
  }
  select(id: string, input: unknown) {
    z.uuid().parse(id);
    const command = selectionSchema.parse(input);
    const intent = intentHash({ id, ...command });
    return this.store.transaction(() => {
      const prior = this.store.db
        .prepare(
          "SELECT intent,result FROM skill_selection_receipts WHERE request_id=?",
        )
        .get(command.requestId) as
        { intent: string; result: string } | undefined;
      if (prior) {
        if (prior.intent !== intent)
          throw new RockyError(
            "idempotency_conflict",
            "Skill selection changed",
            409,
          );
        return JSON.parse(prior.result) as SkillSelection;
      }
      const current = this.selection(id);
      if ((current?.revision ?? 0) !== command.expectedRevision)
        throw new RockyError(
          "stale_skill_selection",
          "Skill selection revision changed",
          409,
        );
      const revision =
        command.action === "publish"
          ? this.get(id, command.skillRevision).revision
          : this.revision(id, command.skillRevision);
      if (revision.contentHash !== command.contentHash)
        throw new RockyError(
          "stale_skill_hash",
          "Reviewed skill hash does not match",
          409,
        );
      if (
        command.action !== "publish" &&
        current &&
        (current.skillRevision !== command.skillRevision ||
          current.contentHash !== command.contentHash)
      )
        throw new RockyError(
          "stale_skill_selection",
          "Deactivate or quarantine must target the current selection",
          409,
        );
      if (command.action === "publish") {
        const blocked = this.store.db
          .prepare("SELECT 1 FROM skill_quarantine WHERE id=? AND hash=?")
          .get(id, command.contentHash);
        if (blocked)
          throw new RockyError(
            "skill_quarantined",
            "Quarantined package cannot be published",
            409,
          );
      }
      if (command.action === "quarantine") {
        this.store.db
          .prepare("INSERT OR IGNORE INTO skill_quarantine VALUES(?,?)")
          .run(id, command.contentHash);
        for (const work of this.store.list()) {
          if (!["queued", "running", "waiting_approval"].includes(work.status))
            continue;
          const affected = this.catalog(work.id)?.items.some(
            (item) =>
              item.id === id && item.contentHash === command.contentHash,
          );
          if (affected)
            this.store.event(work, "rocky.skill.revoked", {
              skillId: id,
              contentHash: command.contentHash,
              skillRevision: command.skillRevision,
              reason: "owner_quarantine",
            });
        }
      }
      const result: SkillSelection = {
        id,
        revision: command.expectedRevision + 1,
        skillRevision: command.skillRevision,
        contentHash: command.contentHash,
        state:
          command.action === "publish"
            ? "published"
            : command.action === "deactivate"
              ? "inactive"
              : "quarantined",
        updatedAt: new Date().toISOString(),
      };
      const data = JSON.stringify(result);
      this.store.db
        .prepare(
          "INSERT INTO skill_selections VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        )
        .run(id, data);
      this.store.db
        .prepare("INSERT INTO skill_selection_receipts VALUES(?,?,?)")
        .run(command.requestId, intent, data);
      return result;
    });
  }
  private revision(id: string, revision: number) {
    z.uuid().parse(id);
    z.number().int().positive().parse(revision);
    const row = this.store.db
      .prepare("SELECT data FROM skill_revisions WHERE id=? AND revision=?")
      .get(id, revision) as { data: string } | undefined;
    if (!row)
      throw new RockyError("skill_missing", "Skill revision not found", 404);
    return JSON.parse(row.data) as SkillRevision;
  }
  get(id: string, revision: number) {
    const record = this.revision(id, revision);
    const stored = this.store.db
      .prepare("SELECT data FROM skill_packages WHERE hash=?")
      .get(record.contentHash) as { data: string } | undefined;
    if (!stored)
      throw new RockyError("skill_integrity", "Skill package missing", 409);
    const parsed = JSON.parse(stored.data) as Snapshot;
    const snapshot = validateSkillPackage({
      directoryName: record.metadata.name,
      files: parsed.files.map(({ path, contentBase64 }) => ({
        path,
        contentBase64,
      })),
    });
    if (
      snapshot.contentHash !== record.contentHash ||
      JSON.stringify(snapshot) !== stored.data
    )
      throw new RockyError(
        "skill_integrity",
        "Skill package integrity check failed",
        409,
      );
    return { revision: record, package: snapshot };
  }
}
