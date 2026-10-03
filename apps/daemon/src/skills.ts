import { z } from "zod";
import { Store } from "./store.js";
import { WorkspaceRegistry } from "./workspaces.js";
import { validateSkillPackage } from "./skill-package.js";
import { intentHash } from "./intent.js";
import { RockyError } from "../../../packages/contracts/src/index.js";

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
  get(id: string, revision: number) {
    z.uuid().parse(id);
    z.number().int().positive().parse(revision);
    const row = this.store.db
      .prepare("SELECT data FROM skill_revisions WHERE id=? AND revision=?")
      .get(id, revision) as { data: string } | undefined;
    if (!row)
      throw new RockyError("skill_missing", "Skill revision not found", 404);
    const record = JSON.parse(row.data) as SkillRevision;
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
