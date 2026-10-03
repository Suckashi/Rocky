import { Store } from "./store.js";
import { intentHash, canonicalIntent } from "./intent.js";
import {
  RockyError,
  type Work,
} from "../../../packages/contracts/src/index.js";

import { operationSummarySchema } from "../../../packages/contracts/src/operations.js";
import { reconciliationReceiptSchema } from "../../../packages/contracts/src/operations.js";
import type { retrySchema } from "../../../packages/contracts/src/index.js";

type Operation = {
  id: string;
  args_hash: string;
  outcome: string;
  result: string | null;
  phase: string;
  context: string | null;
  revision: number;
};
function effectArgsHash(name: string, args: Record<string, unknown>) {
  if (name !== "mcp_call" && name !== "mcp_data") return intentHash(args);
  const effect = { ...args };
  delete effect.registryRevision;
  // Reconnecting/discovery revision changes cannot authorize repeating a known effect.
  return intentHash(effect);
}
export class OperationLedger {
  constructor(private readonly store: Store) {}
  retryAncestors(work: Work) {
    const ancestors: Work[] = [],
      seen = new Set([work.id]);
    let id = work.retryOf;
    while (id) {
      if (seen.has(id) || ancestors.length >= 128)
        throw new RockyError(
          "retry_ancestry",
          "Invalid or excessive retry ancestry",
          409,
        );
      seen.add(id);
      const source = this.store.get(id);
      ancestors.push(source);
      id = source.retryOf;
    }
    return ancestors;
  }
  private priorOperations(work: Work) {
    return [work, ...this.retryAncestors(work)].flatMap((source) =>
      this.list(source.id).map((summary) => ({
        source,
        summary,
        operation: this.get(summary.id)!,
      })),
    );
  }
  retryReview(source: Work) {
    const effects = this.priorOperations(source).map(
      ({ source: owner, summary }) => {
        const reconciled = this.store.db
          .prepare(
            "SELECT data FROM operation_reconciliations WHERE json_extract(data,'$.operationId')=? AND json_extract(data,'$.operationRevision')=?",
          )
          .get(summary.id, summary.revision) as { data: string } | undefined;
        return {
          ...summary,
          workId: owner.id,
          ...(reconciled
            ? {
                reconciliationReceiptId: reconciliationReceiptSchema.parse(
                  JSON.parse(reconciled.data),
                ).id,
              }
            : {}),
        };
      },
    );
    if (effects.length > 1000)
      throw new RockyError(
        "retry_review_capacity",
        "Retry history exceeds review capacity",
        422,
      );
    return { effects };
  }
  validateRetry(
    source: Work,
    refs: ReturnType<typeof retrySchema.parse>["effectRefs"],
  ) {
    const operations = this.priorOperations(source);
    if (
      operations.some(
        ({ summary }) =>
          summary.outcome === "unknown" || summary.phase === "dispatched",
      )
    )
      throw new RockyError(
        "retry_unknown_effect",
        "Reconcile unknown prior effects before retry",
        409,
      );
    const known = operations.filter(
      ({ summary }) => summary.outcome !== "not_executed",
    );
    if (
      new Set(refs.map((r) => r.operationId)).size !== refs.length ||
      refs.length !== known.length
    )
      throw new RockyError(
        "retry_effect_refs",
        "Confirm the exact known prior effect receipts",
        409,
      );
    for (const { summary } of known) {
      const ref = refs.find((r) => r.operationId === summary.id);
      if (!ref || ref.expectedRevision !== summary.revision)
        throw new RockyError(
          "retry_effect_refs",
          "Prior effect receipt revision changed",
          409,
        );
      const reconciled = this.store.db
        .prepare(
          "SELECT data FROM operation_reconciliations WHERE json_extract(data,'$.operationId')=? AND json_extract(data,'$.operationRevision')=?",
        )
        .get(summary.id, summary.revision) as { data: string } | undefined;
      const receipt = reconciled
        ? reconciliationReceiptSchema.parse(JSON.parse(reconciled.data))
        : undefined;
      if (
        ref.reconciliationReceiptId !== receipt?.id ||
        (receipt && receipt.outcome !== summary.outcome)
      )
        throw new RockyError(
          "retry_effect_refs",
          "Reconciliation receipt does not match the current effect",
          409,
        );
    }
  }
  retryEvidence(work: Work) {
    return this.retryAncestors(work).map((source) => ({
      workId: source.id,
      status: source.status,
      answer:
        source.workspaceRead && !work.workspaceRead
          ? "Scoped workspace result omitted without fresh read scope"
          : source.answer,
      error: source.error,
      operations: this.list(source.id).map((summary) => ({
        ...summary,
        result:
          !work.workspaceRead &&
          ["workspace_info", "workspace_files", "workspace_read"].includes(
            summary.tool,
          )
            ? undefined
            : this.get(summary.id)?.result,
      })),
    }));
  }
  private assertRetryAllowed(
    work: Work,
    name: string,
    args: Record<string, unknown>,
  ) {
    for (const source of this.retryAncestors(work))
      for (const summary of this.list(source.id)) {
        if (summary.outcome === "unknown")
          throw new RockyError(
            "retry_unknown_effect",
            "Prior effect requires reconciliation",
            409,
          );
        if (summary.outcome !== "succeeded" || summary.tool !== name) continue;
        const context = JSON.parse(this.get(summary.id)!.context!);
        const argsHash =
          context.requestArgsHash ??
          (source.approval?.operationId === summary.id
            ? effectArgsHash(name, source.approval.args)
            : undefined);
        if (!argsHash || argsHash === effectArgsHash(name, args))
          throw new RockyError(
            "retry_replay_denied",
            "Retry cannot repeat a confirmed prior effect; use its receipt",
            409,
          );
      }
  }
  finishUndispatched(
    work: Work,
    reason: "stopped" | "restarted" | "wall_budget",
    after: () => void,
  ) {
    const owned = this.store.get(work.id);
    if (
      owned.runId !== work.runId ||
      owned.executionSessionId !== work.executionSessionId
    )
      throw new RockyError("operation_owner", "Operation context changed", 409);
    return this.store.transaction(() => {
      const pending = this.store.db
        .prepare(
          "SELECT * FROM operations WHERE json_extract(context,'$.workId')=? AND json_extract(context,'$.runId')=? AND json_extract(context,'$.executionSessionId')=? AND phase IN ('prepared','authorized') AND outcome='not_executed'",
        )
        .all(owned.id, owned.runId, owned.executionSessionId) as Operation[];
      for (const operation of pending) {
        this.store.db
          .prepare(
            "UPDATE operations SET phase='settled',revision=revision+1 WHERE id=? AND revision=?",
          )
          .run(operation.id, operation.revision);
        this.store.event(owned, "rocky.operation.not_executed", {
          operationId: operation.id,
          phase: "settled",
          effectOutcome: "not_executed",
          reason,
        });
      }
      // These daemon-owned tools can only read. Interrupted delivery is not an unknown mutation.
      const reads = this.store.db
        .prepare(
          "SELECT * FROM operations WHERE json_extract(context,'$.workId')=? AND json_extract(context,'$.runId')=? AND json_extract(context,'$.executionSessionId')=? AND phase='dispatched' AND outcome='unknown' AND json_extract(context,'$.name') IN ('workspace_info','workspace_files','workspace_read')",
        )
        .all(owned.id, owned.runId, owned.executionSessionId) as Operation[];
      for (const operation of reads) {
        this.store.db
          .prepare(
            "UPDATE operations SET phase='settled',outcome='failed_known_no_effect',revision=revision+1 WHERE id=? AND revision=?",
          )
          .run(operation.id, operation.revision);
        this.store.db
          .prepare("DELETE FROM target_claims WHERE operation_id=?")
          .run(operation.id);
        this.store.event(owned, "rocky.operation.failed_no_effect", {
          operationId: operation.id,
          phase: "settled",
          effectOutcome: "failed_known_no_effect",
          reason,
        });
      }
      after();
      return pending.length;
    });
  }
  list(workId: string) {
    const work = this.store.get(workId);
    const rows = this.store.db
      .prepare(
        "SELECT * FROM operations WHERE json_extract(context,'$.workId')=? AND json_extract(context,'$.runId')=? AND json_extract(context,'$.executionSessionId')=? ORDER BY rowid",
      )
      .all(work.id, work.runId, work.executionSessionId) as Operation[];
    return rows.map((row) => {
      const context = JSON.parse(row.context!);
      return operationSummarySchema.parse({
        id: row.id,
        revision: row.revision,
        tool: context.name,
        phase: row.phase,
        outcome: row.outcome,
        canReconcile:
          row.outcome === "unknown" && context.name === "write_sample",
      });
    });
  }
  get(id: string): Operation | undefined {
    return this.store.db
      .prepare("SELECT * FROM operations WHERE id=?")
      .get(id) as Operation | undefined;
  }
  prepare(
    work: Work,
    callId: string,
    name: string,
    args: Record<string, unknown>,
    fingerprint: string,
    targetIdentity: string = intentHash({ fixture: work.runId }),
  ) {
    this.assertRetryAllowed(work, name, args);
    if (!/^[a-f0-9]{64}$/.test(targetIdentity))
      throw new RockyError(
        "target_identity",
        "Canonical target identity required",
        400,
      );
    const owned = this.store.get(work.id);
    if (
      owned.runId !== work.runId ||
      owned.executionSessionId !== work.executionSessionId
    )
      throw new RockyError("operation_owner", "Operation context changed", 409);
    if (!callId || callId.length > 256)
      throw new RockyError(
        "operation_identity",
        "Tool call identity invalid",
        400,
      );
    const id = work.runId + ":" + callId;
    const context = canonicalIntent({
      workId: work.id,
      runId: work.runId,
      executionSessionId: work.executionSessionId,
      name,
      fingerprint,
      targetIdentity,
      requestArgsHash: effectArgsHash(name, args),
    });
    const hash = intentHash({ context, args });
    return this.store.transaction(() => {
      const prior = this.get(id);
      if (prior) {
        if (prior.args_hash !== hash || prior.context !== context)
          throw new RockyError(
            "operation_conflict",
            "Operation intent changed",
            409,
          );
        return prior;
      }
      this.store.db
        .prepare(
          "INSERT INTO operations(id,args_hash,outcome,result,phase,context,revision) VALUES(?,?,'not_executed',NULL,'prepared',?,1)",
        )
        .run(id, hash, context);
      this.store.event(work, "rocky.operation.prepared", {
        operationId: id,
        name,
      });
      return this.get(id)!;
    });
  }
  transition(
    work: Work,
    operation: Operation,
    phase: "authorized" | "dispatched" | "settled",
    outcome:
      "not_executed" | "unknown" | "succeeded" | "failed_known_no_effect",
    result: string | null = null,
    evidence: Record<string, unknown> = {},
    after?: () => void,
  ) {
    const valid =
      (operation.phase === "prepared" &&
        phase === "settled" &&
        outcome === "not_executed") ||
      (operation.phase === "prepared" &&
        phase === "authorized" &&
        outcome === "not_executed") ||
      (operation.phase === "authorized" &&
        phase === "dispatched" &&
        outcome === "unknown") ||
      (operation.phase === "dispatched" &&
        phase === "settled" &&
        ["unknown", "succeeded", "failed_known_no_effect"].includes(outcome));
    if (!valid || (outcome === "succeeded") !== (result !== null))
      throw new RockyError(
        "operation_transition",
        "Invalid operation transition",
        409,
      );
    const owned = this.store.get(work.id);
    const context = operation.context ? JSON.parse(operation.context) : null;
    if (
      !context ||
      context.workId !== owned.id ||
      context.runId !== owned.runId ||
      context.executionSessionId !== owned.executionSessionId ||
      work.executionSessionId !== owned.executionSessionId
    )
      throw new RockyError("operation_owner", "Operation context changed", 409);
    if (phase !== "settled" && owned.status !== "running")
      throw new RockyError(
        "operation_inactive",
        "Operation work is not running",
        409,
      );
    return this.store.transaction(() => {
      if (phase === "dispatched") {
        if (!context.targetIdentity)
          throw new RockyError(
            "target_identity",
            "Operation has no canonical target identity",
            409,
          );
        const claimed = this.store.db
          .prepare("INSERT OR IGNORE INTO target_claims VALUES(?,?)")
          .run(context.targetIdentity, operation.id);
        if (claimed.changes !== 1)
          throw new RockyError(
            "target_busy",
            "Target has an active or unreconciled operation",
            409,
          );
      }
      const changed = this.store.db
        .prepare(
          "UPDATE operations SET phase=?,outcome=?,result=?,revision=revision+1 WHERE id=? AND revision=? AND phase=? AND args_hash=? AND context=?",
        )
        .run(
          phase,
          outcome,
          result,
          operation.id,
          operation.revision,
          operation.phase,
          operation.args_hash,
          operation.context,
        );
      if (changed.changes !== 1)
        throw new RockyError(
          "operation_conflict",
          "Operation revision changed",
          409,
        );
      if (phase === "settled" && outcome !== "unknown")
        this.store.db
          .prepare("DELETE FROM target_claims WHERE operation_id=?")
          .run(operation.id);
      this.store.event(
        owned,
        "rocky.operation." + (phase === "settled" ? outcome : phase),
        {
          ...evidence,
          operationId: operation.id,
          name: context.name,
          phase,
          effectOutcome: outcome,
        },
      );
      after?.();
      return this.get(operation.id)!;
    });
  }
}
