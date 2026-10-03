import { mkdir, lstat, open, link, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { join, basename, extname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  artifactSchema,
  artifactPublishSchema,
} from "../../../packages/contracts/src/artifacts.js";
import { RockyError } from "../../../packages/contracts/src/index.js";
import { Store } from "./store.js";
import { WorkspaceRegistry } from "./workspaces.js";
import { OperationLedger } from "./operation-ledger.js";
import { intentHash } from "./intent.js";
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export class ArtifactStore {
  constructor(
    private readonly store: Store,
    private readonly workspaces: WorkspaceRegistry,
    private readonly operations: OperationLedger,
  ) {}
  list() {
    return (
      this.store.db
        .prepare("SELECT id FROM artifacts ORDER BY rowid DESC LIMIT 200")
        .all() as { id: string }[]
    ).map((row) => this.get(row.id));
  }
  get(id: string) {
    z.uuid().parse(id);
    const row = this.store.db
      .prepare("SELECT data FROM artifacts WHERE id=?")
      .get(id) as { data: string } | undefined;
    if (!row)
      throw new RockyError("artifact_missing", "Artifact not found", 404);
    const value = artifactSchema.parse(JSON.parse(row.data));
    const { manifestHash, ...manifest } = value;
    if (intentHash(manifest) !== manifestHash)
      throw new RockyError(
        "artifact_corrupt",
        "Artifact manifest integrity failed",
        409,
      );
    return value;
  }
  private async directory() {
    const path = join(this.store.root, "artifacts");
    await mkdir(path, { recursive: true });
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new RockyError(
        "artifact_store",
        "Artifact storage unavailable",
        409,
      );
    return path;
  }
  private async blob(hash: string, size: number) {
    const file = await open(
      join(await this.directory(), hash),
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size !== size || size > 1048576)
        throw new RockyError("artifact_corrupt", "Artifact size changed", 409);
      const chunks: Buffer[] = [];
      let total = 0;
      for (;;) {
        const buffer = Buffer.alloc(65536);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        total += bytesRead;
        if (total > size)
          throw new RockyError(
            "artifact_corrupt",
            "Artifact size changed",
            409,
          );
        chunks.push(buffer.subarray(0, bytesRead));
      }
      const bytes = Buffer.concat(chunks);
      if (bytes.length !== size || sha(bytes) !== hash)
        throw new RockyError(
          "artifact_corrupt",
          "Artifact content integrity failed",
          409,
        );
      return bytes;
    } finally {
      await file.close();
    }
  }
  async file(id: string, fileId: string) {
    const artifact = this.get(id),
      entry = artifact.files.find((f) => f.id === fileId);
    if (!entry)
      throw new RockyError(
        "artifact_file_missing",
        "Artifact file not found",
        404,
      );
    return {
      artifact,
      entry,
      bytes: await this.blob(entry.sha256, entry.size),
    };
  }
  async publish(workId: string, input: unknown) {
    const command = artifactPublishSchema.parse(input),
      hash = intentHash({ workId, ...command });
    const replay = () => {
      const row = this.store.db
        .prepare("SELECT intent FROM artifacts WHERE id=?")
        .get(command.requestId) as { intent: string } | undefined;
      if (!row) return;
      if (row.intent !== hash)
        throw new RockyError(
          "idempotency_conflict",
          "Artifact request changed",
          409,
        );
      return this.get(command.requestId);
    };
    const previous = replay();
    if (previous) return previous;
    const work = this.store.get(workId),
      operation = this.operations.get(command.operationId);
    const owner = operation?.context ? JSON.parse(operation.context) : null;
    if (
      !operation ||
      owner?.workId !== workId ||
      owner?.runId !== work.runId ||
      owner?.name !== "workspace_write" ||
      operation.outcome !== "succeeded" ||
      !operation.result ||
      !work.workspaceId ||
      !work.workspaceRevision
    )
      throw new RockyError(
        "artifact_source",
        "A confirmed workspace write receipt from this Work is required",
        409,
      );
    const receipt = z
      .object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })
      .parse(JSON.parse(operation.result));
    const source = await this.workspaces.read(
      work.workspaceId,
      work.workspaceRevision,
      receipt.path,
      receipt.sha256,
    );
    const bytes = Buffer.from(source.text, "utf8");
    if (sha(bytes) !== receipt.sha256)
      throw new RockyError("artifact_source", "Source bytes changed", 409);
    const directory = await this.directory(),
      stage = join(directory, ".staging-" + randomUUID());
    const handle = await open(stage, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      try {
        await link(stage, join(directory, receipt.sha256));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      await this.blob(receipt.sha256, bytes.length);
    } finally {
      await unlink(stage);
    }
    const name = basename(source.path),
      extension = extname(name).toLowerCase();
    const mime =
      extension === ".md"
        ? "text/markdown"
        : extension === ".html" || extension === ".htm"
          ? "text/html"
          : "text/plain";
    const manifest = {
      id: command.requestId,
      title: command.title,
      workId,
      runId: work.runId,
      files: [
        {
          id: command.requestId,
          name,
          sha256: receipt.sha256,
          mime,
          size: bytes.length,
        },
      ],
      entry: command.requestId,
      source: {
        workspaceId: work.workspaceId,
        workspaceRevision: work.workspaceRevision,
        path: source.path,
      },
      verificationRefs: [operation.id],
      createdAt: new Date().toISOString(),
    };
    const artifact = artifactSchema.parse({
      ...manifest,
      manifestHash: intentHash(manifest),
    });
    return this.store.transaction(() => {
      const repeated = replay();
      if (repeated) return repeated;
      this.store.db
        .prepare("INSERT INTO artifacts VALUES(?,?,?)")
        .run(artifact.id, hash, JSON.stringify(artifact));
      this.store.event(work, "rocky.artifact.published", { artifact });
      return artifact;
    });
  }
}
