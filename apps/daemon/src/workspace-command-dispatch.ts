import {
  RockyError,
  type Work,
} from "../../../packages/contracts/src/index.js";
import { Store } from "./store.js";
import { WorkspaceRegistry } from "./workspaces.js";
import { WorkspaceCommands } from "./workspace-commands.js";
import { NativeEnvironment } from "./native-environment.js";
import { OperationLedger } from "./operation-ledger.js";
import { authorizeOperation } from "./policy.js";
import { intentHash } from "./intent.js";

type Proposal = Awaited<ReturnType<WorkspaceCommands["prepare"]>>;

/** Daemon-only dispatch. Caller must also hold the Work workspace reservation.
 * No HTTP endpoint or model tool may call the raw NativeEnvironment directly.
 */
export class WorkspaceCommandDispatch {
  constructor(
    private readonly store: Store,
    private readonly workspaces: WorkspaceRegistry,
    private readonly operations: OperationLedger,
    private readonly assertConfiguration: (work: Work) => void,
  ) {}

  async execute(
    workId: string,
    callId: string,
    proposal: Proposal,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    let current = this.store.get(workId);
    const modelIdentity = intentHash(current.modelSelection ?? null);
    const fresh = await new WorkspaceCommands(this.workspaces).revalidate(
      current,
      proposal,
      signal,
    );
    // Re-read after filesystem awaits: a cancellation/revocation may have arrived.
    current = this.store.get(workId);
    if (
      current.status !== "running" ||
      current.mode !== "configured" ||
      intentHash(current.modelSelection ?? null) !== modelIdentity ||
      current.runId !== proposal.owner.runId ||
      current.executionSessionId !== proposal.owner.executionSessionId ||
      current.id !== proposal.owner.workId ||
      current.workspaceId !== fresh.workspace.id ||
      current.workspaceRevision !== fresh.workspace.revision
    )
      throw new RockyError(
        "operation_inactive",
        "Command Work scope is no longer active",
        409,
      );
    this.assertConfiguration(current);
    let operation = this.operations.prepare(
      current,
      callId,
      "workspace_command",
      fresh.args,
      fresh.fingerprint,
      fresh.targetIdentity,
    );
    authorizeOperation({
      owner: proposal.owner,
      resolvedOwner: {
        workId: current.id,
        runId: current.runId,
        executionSessionId: current.executionSessionId,
      },
      mode: current.runMode,
      effect: "critical",
      configurationAllowed: true,
      resourceAllowed: true,
      revoked: false,
      preparedTargetHash: proposal.targetIdentity,
      currentTargetHash: fresh.targetIdentity,
      policyRevision: 1,
      preparedPolicyRevision: 1,
      operationId: operation.id,
      intentFingerprint: fresh.fingerprint,
      synthetic: false,
      allowLocalNew: false,
      targetExists: true,
      approval: current.approval
        ? {
            status: current.approval.status,
            operationId: current.approval.operationId,
            intentFingerprint: current.approval.intentFingerprint,
          }
        : null,
    });
    if (operation.outcome === "succeeded") return operation.result!;
    if (operation.phase !== "prepared")
      throw new RockyError(
        "unknown_effect",
        "Prior command requires reconciliation; automatic re-execution is forbidden",
        409,
      );
    signal.throwIfAborted();
    operation = this.operations.transition(
      current,
      operation,
      "authorized",
      "not_executed",
    );
    operation = this.operations.transition(
      current,
      operation,
      "dispatched",
      "unknown",
      null,
      {
        destination: "native-workspace:" + fresh.workspace.id,
        isolation: "none",
      },
    );
    try {
      const result = await new NativeEnvironment().execute(
        fresh.command,
        signal,
      );
      const publicResult = this.store.publicEvidence({
        ...result,
        untrustedData: true,
        meaning:
          "Process execution receipt only; exit zero does not independently verify external effects.",
        isolation: "none",
        networkEnforcement: "application_only",
      });
      const serialized = JSON.stringify(publicResult);
      if (result.reason === "exited" && result.exitCode === 0) {
        this.operations.transition(
          current,
          operation,
          "settled",
          "succeeded",
          serialized,
          { result: publicResult },
        );
        return serialized;
      }
      this.operations.transition(
        current,
        operation,
        "settled",
        result.launched ? "unknown" : "failed_known_no_effect",
        null,
        { result: publicResult },
      );
      throw new RockyError(
        result.launched ? "unknown_effect" : "command_spawn_failed",
        result.launched
          ? "Command did not finish successfully; inspect effects before retrying"
          : "Command process could not be started",
        409,
      );
    } catch (error) {
      // Never reclassify a dispatched command as no-effect merely because it threw.
      const latest = this.operations.get(operation.id);
      if (latest?.phase === "dispatched")
        this.operations.transition(current, latest, "settled", "unknown");
      throw error;
    }
  }
}
