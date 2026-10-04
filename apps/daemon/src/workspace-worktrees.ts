import { dirname, join, basename } from "node:path";
import { mkdir } from "node:fs/promises";
import { resolveFileTarget, recheckFileTarget } from "./file-target.js";
import { workspaceWorktreeSchema } from "../../../packages/contracts/src/workspaces.js";
import {
  RockyError,
  type Work,
} from "../../../packages/contracts/src/index.js";
import { WorkspaceRegistry } from "./workspaces.js";
import { GitWorktree } from "./git-worktree.js";
import { intentHash } from "./intent.js";
import type { IsolatedEnvironments } from "./isolated-environment.js";

export class WorkspaceWorktrees {
  constructor(
    private readonly registry: WorkspaceRegistry,
    private readonly environments?: IsolatedEnvironments,
  ) {}
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
    const environmentTemplate = work.environmentId
      ? this.environments?.get(work.environmentId)
      : undefined;
    if (work.environmentId && !environmentTemplate)
      throw new RockyError(
        "environment_scope",
        "Environment template is unavailable",
        409,
      );
    if (work.environmentId && work.browserProfileId && args.useForCurrentWork)
      throw new RockyError(
        "browser_scope",
        "Start a separate Work without a browser binding to change this environment workspace; the existing browser scope cannot be silently moved",
        409,
      );
    const workspace = await this.registry.root(
      work.workspaceId,
      work.workspaceRevision,
    );
    const destination = join(
      dirname(workspace.root),
      (args.isolation === "directory"
        ? "rocky-workspace-"
        : "rocky-worktree-") + work.runId,
    );
    this.registry.check(dirname(destination), basename(destination));
    const git =
      args.isolation === "directory"
        ? {
            root: workspace.root,
            destination,
            branch: null,
            head: null,
            target: await resolveFileTarget(
              dirname(destination),
              basename(destination),
            ),
          }
        : await new GitWorktree().prepare(
            workspace.root,
            destination,
            "codex/rocky-" + work.runId,
            signal,
          );
    if (git.target.exists)
      throw new RockyError(
        "workspace_exists",
        "Isolated destination must be new",
        409,
      );
    return {
      args,
      environmentTemplate,
      workspace,
      git,
      target: git.target,
      targetIdentity: intentHash({ canonicalPath: git.target.canonicalPath }),
      fingerprint: intentHash({
        workId: work.id,
        runId: work.runId,
        executionSessionId: work.executionSessionId,
        workspace,
        environmentTemplate: environmentTemplate ?? null,
        git: { ...git, target: git.target.fingerprint },
        modelSelection: work.modelSelection ?? null,
        useForCurrentWork: args.useForCurrentWork === true,
        isolation: args.isolation ?? "worktree",
        grantRead:
          args.useForCurrentWork === true && work.workspaceRead === true,
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
    signal.throwIfAborted();
    let receipt: {
      root: string;
      sourceRoot: string;
      branch: string | null;
      head: string | null;
    };
    if (prepared.git.branch === null) {
      await recheckFileTarget(prepared.git.target);
      signal.throwIfAborted();
      await mkdir(prepared.git.destination, { recursive: false, mode: 0o700 });
      receipt = {
        root: prepared.git.destination,
        sourceRoot: prepared.git.root,
        branch: null,
        head: null,
      };
    } else receipt = await new GitWorktree().create(prepared.git, signal);
    // A failure to register after Git dispatch must remain unknown, never replayed.
    const registered = await this.registry.save({
      id: prepared.registrationId,
      requestId: prepared.requestId,
      expectedRevision: 0,
      name:
        (prepared.git.branch === null ? "Workspace " : "Worktree ") +
        prepared.registrationId.slice(0, 8),
      root: receipt.root,
    });
    let environmentId: string | undefined;
    if (prepared.environmentTemplate && prepared.args.useForCurrentWork) {
      if (
        this.environments!.get(prepared.environmentTemplate.id).revision !==
        prepared.environmentTemplate.revision
      )
        throw new RockyError(
          "environment_stale",
          "Environment template changed; inspect created workspace before retrying",
          409,
        );
      const environment = await this.environments!.create({
        requestId: prepared.registrationId,
        config: {
          ...prepared.environmentTemplate.config,
          workspaceId: registered.id,
          workspaceRevision: registered.revision,
        },
      });
      environmentId = environment.id;
    }
    return {
      ...receipt,
      ...(environmentId
        ? {
            environmentId,
            environmentState: "configured",
            environmentStartRequired: true,
          }
        : {}),
      isolation:
        prepared.git.branch === null
          ? ("directory" as const)
          : ("worktree" as const),
      workspaceId: registered.id,
      workspaceRevision: registered.revision,
      sourceWorkspaceId: prepared.workspace.id,
      sourceWorkspaceRevision: prepared.workspace.revision,
      readPermissionGranted: false,
      currentWorkWorkspaceChanged: false,
    };
  }
}
