import { open, rename, link, unlink, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { workspaceWriteSchema } from "../../../packages/contracts/src/workspaces.js";
import {
  RockyError,
  type Work,
} from "../../../packages/contracts/src/index.js";
import { WorkspaceRegistry } from "./workspaces.js";
import { resolveFileTarget, recheckFileTarget } from "./file-target.js";
import { intentHash } from "./intent.js";

export class WorkspaceWriteError extends Error {
  constructor(
    readonly outcome: "unknown" | "failed_known_no_effect",
    message: string,
  ) {
    super(message);
  }
}
export class WorkspaceWriter {
  constructor(private readonly registry: WorkspaceRegistry) {}
  async prepare(work: Work, input: unknown) {
    if (
      work.mode !== "configured" ||
      work.runMode !== "normal" ||
      !work.workspaceId ||
      !work.workspaceRevision
    )
      throw new RockyError(
        "workspace_scope",
        "No registered workspace is bound to this Work",
        403,
      );
    const args = workspaceWriteSchema.parse(input),
      bytes = Buffer.from(args.content, "utf8");
    if (bytes.length > 65536 || args.content.includes("\0"))
      throw new RockyError(
        "write_limit",
        "Write requires UTF-8 text no larger than 64KiB without NUL",
        422,
      );
    const workspace = await this.registry.root(
      work.workspaceId,
      work.workspaceRevision,
    );
    this.registry.check(workspace.root, args.path);
    const target = await resolveFileTarget(workspace.root, args.path);
    if (
      args.expectedHash !== target.contentHash ||
      (args.expectedHash === null && target.exists)
    )
      throw new RockyError(
        "target_changed",
        "File state changed; prepare a fresh proposal",
        409,
      );
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return {
      args,
      workspace,
      target,
      sha256,
      targetIdentity: intentHash({ canonicalPath: target.canonicalPath }),
      fingerprint: intentHash({
        workId: work.id,
        runId: work.runId,
        executionSessionId: work.executionSessionId,
        args,
        workspace,
        target: target.fingerprint,
        modelSelection: work.modelSelection ?? null,
        policyRevision: 1,
      }),
    };
  }
  async dispatch(
    prepared: Awaited<ReturnType<WorkspaceWriter["prepare"]>>,
    signal: AbortSignal,
  ) {
    const { target, args, workspace, sha256 } = prepared;
    let published = false,
      temporary: string | undefined;
    try {
      signal.throwIfAborted();
      await this.registry.root(workspace.id, workspace.revision);
      await recheckFileTarget(target);
      const mode = target.exists
        ? (await lstat(target.canonicalPath)).mode & 0o777
        : 0o600;
      const candidate = join(
        dirname(target.canonicalPath),
        `.rocky-write-${randomUUID()}.tmp`,
      );
      const file = await open(
        candidate,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      temporary = candidate;
      try {
        await file.writeFile(Buffer.from(args.content, "utf8"));
        await file.chmod(mode);
        await file.sync();
      } finally {
        await file.close();
      }
      signal.throwIfAborted();
      await this.registry.root(workspace.id, workspace.revision);
      await recheckFileTarget(target);
      signal.throwIfAborted();
      if (target.exists) {
        await rename(candidate, target.canonicalPath);
        temporary = undefined;
      } else {
        await link(candidate, target.canonicalPath);
        published = true;
        await unlink(candidate);
        temporary = undefined;
      }
      published = true;
      const result = await resolveFileTarget(
        workspace.root,
        target.relativePath,
      );
      await this.registry.root(workspace.id, workspace.revision);
      if (result.contentHash !== sha256)
        throw Error("Published file changed before confirmation");
      return {
        receiptId: randomUUID(),
        workspaceId: workspace.id,
        workspaceRevision: workspace.revision,
        path: target.relativePath,
        previousHash: target.contentHash,
        sha256,
        size: Buffer.byteLength(args.content, "utf8"),
        created: !target.exists,
      };
    } catch {
      let cleanupFailed = false;
      if (temporary)
        try {
          await unlink(temporary);
        } catch {
          cleanupFailed = true;
        }
      throw new WorkspaceWriteError(
        published || cleanupFailed ? "unknown" : "failed_known_no_effect",
        published || cleanupFailed
          ? "Write outcome requires reconciliation"
          : "File was not changed; proposal expired, cancelled or unavailable",
      );
    }
  }
}
