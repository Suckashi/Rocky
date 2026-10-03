import { Store } from "./store.js";
import { intentHash, canonicalIntent } from "./intent.js";
import {
  RockyError,
  type Work,
} from "../../../packages/contracts/src/index.js";

type Operation = {
  id: string;
  args_hash: string;
  outcome: string;
  result: string | null;
  phase: string;
  context: string | null;
  revision: number;
};
export class OperationLedger {
  constructor(private readonly store: Store) {}
  finishUndispatched(
    work: Work,
    reason: "stopped" | "restarted",
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
      after();
      return pending.length;
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
  ) {
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
    outcome: "not_executed" | "unknown" | "succeeded",
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
        ["unknown", "succeeded"].includes(outcome));
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
