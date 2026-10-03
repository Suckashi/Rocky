import { dirname, join, basename } from "node:path";
import { workspaceWorktreeSchema } from "../../../packages/contracts/src/workspaces.js";
import {
  RockyError,
  type Work,
} from "../../../packages/contracts/src/index.js";
import { WorkspaceRegistry } from "./workspaces.js";
import { GitWorktree } from "./git-worktree.js";
import { intentHash } from "./intent.js";

export class WorkspaceWorktrees {
  constructor(private readonly registry: WorkspaceRegistry) {}
  async prepare(work: Work, input: unknown, signal?: AbortSignal) {
    if (
      work.mode !== "configured" ||
      work.runMode !== "normal" ||
      !work.workspaceId ||
      !work.workspaceRevision
    )
      throw new RockyError(
        "workspace_scope",
        "A registered workspace is required",
        403,
      );
    const args = workspaceWorktreeSchema.parse(input);
    const workspace = await this.registry.root(
      work.workspaceId,
      work.workspaceRevision,
    );
    const destination = join(
      dirname(workspace.root),
      "rocky-worktree-" + work.runId,
    );
    this.registry.check(dirname(destination), basename(destination));
    const git = await new GitWorktree().prepare(
      workspace.root,
      destination,
      "codex/rocky-" + work.runId,
      signal,
    );
    return {
      args,
      workspace,
      git,
      target: git.target,
      targetIdentity: intentHash({ canonicalPath: git.target.canonicalPath }),
      fingerprint: intentHash({
        workId: work.id,
        runId: work.runId,
        executionSessionId: work.executionSessionId,
        workspace,
        git: { ...git, target: git.target.fingerprint },
        modelSelection: work.modelSelection ?? null,
        policyRevision: 1,
      }),
      registrationId: work.runId,
      requestId: work.executionSessionId,
    };
  }
  async dispatch(
    prepared: Awaited<ReturnType<WorkspaceWorktrees["prepare"]>>,
    signal: AbortSignal,
  ) {
    await this.registry.root(
      prepared.workspace.id,
      prepared.workspace.revision,
    );
    const receipt = await new GitWorktree().create(prepared.git, signal);
    // A failure to register after Git dispatch must remain unknown, never replayed.
    const registered = await this.registry.save({
      id: prepared.registrationId,
      requestId: prepared.requestId,
      expectedRevision: 0,
      name: "Worktree " + prepared.registrationId.slice(0, 8),
      root: receipt.root,
    });
    return {
      ...receipt,
      workspaceId: registered.id,
      workspaceRevision: registered.revision,
      sourceWorkspaceId: prepared.workspace.id,
      sourceWorkspaceRevision: prepared.workspace.revision,
      readPermissionGranted: false,
      currentWorkWorkspaceChanged: false,
    };
  }
}
