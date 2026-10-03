import { z } from "zod";
import { randomUUID } from "node:crypto";
import { Store } from "./store.js";
import { OperationLedger } from "./operation-ledger.js";
import { intentHash } from "./intent.js";
import { RockyError } from "../../../packages/contracts/src/index.js";
import {
  reconciliationCommandSchema as commandSchema,
  reconciliationReceiptSchema,
} from "../../../packages/contracts/src/operations.js";
const observationSchema = z
  .strictObject({
    operationId: z.string(),
    intentHash: z.string().regex(/^[a-f0-9]{64}$/),
    outcome: z.enum(["succeeded", "failed_known_no_effect", "unknown"]),
    result: z.string().max(65536).nullable(),
    evidenceRef: z.uuid(),
    observedAt: z.iso.datetime(),
  })
  .refine((v) => (v.outcome === "succeeded") === (v.result !== null));
export type OperationObservation = z.infer<typeof observationSchema>;
/** Trusted adapter query seam only. No HTTP route accepts an outcome from a client. */
export class OperationReconciler {
  constructor(private readonly store: Store) {}
  async reconcile(
    workId: string,
    input: unknown,
    observe: (
      operationId: string,
      signal: AbortSignal,
    ) => Promise<OperationObservation>,
    signal: AbortSignal,
  ) {
    const command = commandSchema.parse(input),
      intent = intentHash({ workId, ...command });
    const prior = this.store.db
      .prepare(
        "SELECT intent,data FROM operation_reconciliations WHERE request_id=?",
      )
      .get(command.requestId) as { intent: string; data: string } | undefined;
    if (prior) {
      if (prior.intent !== intent)
        throw new RockyError(
          "reconciliation_conflict",
          "Reconciliation request changed",
          409,
        );
      return reconciliationReceiptSchema.parse(JSON.parse(prior.data));
    }
    const work = this.store.get(workId),
      ledger = new OperationLedger(this.store),
      operation = ledger.get(command.operationId);
    const context = operation?.context ? JSON.parse(operation.context) : null;
    if (
      !operation ||
      !context ||
      context.workId !== work.id ||
      context.runId !== work.runId ||
      context.executionSessionId !== work.executionSessionId
    )
      throw new RockyError(
        "operation_owner",
        "Operation does not belong to this Work",
        409,
      );
    if (
      operation.revision !== command.expectedRevision ||
      operation.outcome !== "unknown" ||
      !["dispatched", "settled"].includes(operation.phase)
    )
      throw new RockyError(
        "reconciliation_stale",
        "Operation is not an unknown result at this revision",
        409,
      );
    signal.throwIfAborted();
    const observation = observationSchema.parse(
      await observe(operation.id, signal),
    );
    signal.throwIfAborted();
    if (
      observation.operationId !== operation.id ||
      observation.intentHash !== operation.args_hash
    )
      throw new RockyError(
        "reconciliation_mismatch",
        "Observation does not match operation intent",
        409,
      );
    const current = this.store.get(work.id);
    if (
      current.runId !== work.runId ||
      current.executionSessionId !== work.executionSessionId
    )
      throw new RockyError("operation_owner", "Operation owner changed", 409);
    const receipt = reconciliationReceiptSchema.parse({
      id: randomUUID(),
      requestId: command.requestId,
      operationId: operation.id,
      outcome: observation.outcome,
      evidenceRef: observation.evidenceRef,
      observedAt: observation.observedAt,
      observationHash: intentHash(observation),
      operationRevision: operation.revision + 1,
    });
    return this.store.transaction(() => {
      const change = this.store.db
        .prepare(
          "UPDATE operations SET phase='settled',outcome=?,result=?,revision=revision+1 WHERE id=? AND revision=? AND outcome='unknown' AND context=?",
        )
        .run(
          observation.outcome,
          observation.result,
          operation.id,
          operation.revision,
          operation.context,
        );
      if (change.changes !== 1)
        throw new RockyError(
          "reconciliation_stale",
          "Operation changed while observing",
          409,
        );
      if (observation.outcome !== "unknown")
        this.store.db
          .prepare("DELETE FROM target_claims WHERE operation_id=?")
          .run(operation.id);
      this.store.db
        .prepare("INSERT INTO operation_reconciliations VALUES(?,?,?)")
        .run(command.requestId, intent, JSON.stringify(receipt));
      this.store.event(current, "rocky.operation.reconciled", receipt);
      return receipt;
    });
  }
}
