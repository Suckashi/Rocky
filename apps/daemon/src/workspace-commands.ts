import { open, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import {
  RockyError,
  type Work,
} from "../../../packages/contracts/src/index.js";
import { WorkspaceRegistry } from "./workspaces.js";
import { intentHash } from "./intent.js";
import {
  nativeCommandSchema,
  nativeExecutionEnvironment,
} from "./native-environment.js";

// Cwd is daemon-owned from the registered Work workspace, never model supplied.
export const workspaceCommandSchema = nativeCommandSchema.omit({ cwd: true });

async function executableIdentity(path: string) {
  const canonicalPath = await realpath(path);
  const file = await open(
    canonicalPath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.size > 268435456n)
      throw new RockyError(
        "command_executable",
        "Executable must be a regular file no larger than 256 MiB",
        422,
      );
    const hash = createHash("sha256"),
      buffer = Buffer.alloc(65536);
    let size = 0;
    for (;;) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > 268435456)
        throw new RockyError(
          "command_executable",
          "Executable changed while preparing",
          409,
        );
      hash.update(buffer.subarray(0, bytesRead));
    }
    const after = await file.stat({ bigint: true });
    if (
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      BigInt(size) !== before.size
    )
      throw new RockyError(
        "command_executable",
        "Executable changed while preparing",
        409,
      );
    return {
      canonicalPath,
      sha256: hash.digest("hex"),
      size,
      device: before.dev.toString(),
      inode: before.ino.toString(),
      created: before.birthtimeNs.toString(),
      modified: before.mtimeNs.toString(),
    };
  } finally {
    await file.close();
  }
}

/** Prepare/revalidate exact command consent; this does not itself authorize dispatch. */
export class WorkspaceCommands {
  constructor(private readonly registry: WorkspaceRegistry) {}
  async prepare(work: Work, input: unknown, signal: AbortSignal) {
    signal.throwIfAborted();
    if (
      work.mode !== "configured" ||
      work.runMode !== "normal" ||
      !work.workspaceId ||
      !work.workspaceRevision
    )
      throw new RockyError(
        "workspace_scope",
        "Native commands require a normal configured Work with a registered workspace",
        403,
      );
    const args = workspaceCommandSchema.parse(input);
    const workspace = await this.registry.root(
      work.workspaceId,
      work.workspaceRevision,
    );
    const executable = await executableIdentity(args.executable);
    signal.throwIfAborted();
    const command = {
      ...args,
      executable: executable.canonicalPath,
      cwd: workspace.root,
    };
    const owner = {
      workId: work.id,
      runId: work.runId,
      executionSessionId: work.executionSessionId,
    };
    const environmentHash = intentHash(nativeExecutionEnvironment());
    return {
      owner,
      args,
      workspace,
      command,
      executable,
      environmentHash,
      // Claim the whole workspace for opaque commands, not a guessed output file.
      targetIdentity: intentHash({
        nativeWorkspace: workspace.id,
        rootIdentity: workspace.rootIdentity,
      }),
      fingerprint: intentHash({
        owner,
        args,
        workspace,
        executable,
        environmentHash,
        modelSelection: work.modelSelection ?? null,
        policyRevision: 1,
        mode: "native",
        isolation: "none",
        networkEnforcement: "application_only",
      }),
    };
  }
  async revalidate(
    work: Work,
    proposal: Awaited<ReturnType<WorkspaceCommands["prepare"]>>,
    signal: AbortSignal,
  ) {
    const fresh = await this.prepare(work, proposal.args, signal);
    if (fresh.fingerprint !== proposal.fingerprint)
      throw new RockyError(
        "stale_approval",
        "Native command identity changed; a fresh exact approval is required",
        409,
      );
    return fresh;
  }
}
