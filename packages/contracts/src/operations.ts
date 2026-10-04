import { z } from "zod";

export const reconciliationCommandSchema = z.strictObject({
  requestId: z.uuid(),
  operationId: z.string().min(1).max(300),
  expectedRevision: z.number().int().positive(),
});
export const operationSummarySchema = z.strictObject({
  id: z.string().min(1).max(300),
  revision: z.number().int().positive(),
  tool: z.string(),
  phase: z.enum(["prepared", "authorized", "dispatched", "settled"]),
  outcome: z.enum([
    "not_executed",
    "succeeded",
    "failed_known_no_effect",
    "unknown",
  ]),
  canReconcile: z.boolean(),
  reconciliationQuery: z
    .object({
      kind: z.enum(["local_receipt", "mcp_resource", "unavailable"]),
      target: z.string().max(8192),
      serverId: z.string().optional(),
      configRevision: z.number().int().positive().optional(),
    })
    .optional(),
});
export const reconciliationReceiptSchema = z.strictObject({
  id: z.uuid(),
  requestId: z.uuid(),
  operationId: z.string().min(1).max(300),
  outcome: z.enum(["succeeded", "failed_known_no_effect", "unknown"]),
  evidenceRef: z.uuid(),
  observedAt: z.iso.datetime(),
  observationHash: z.string().regex(/^[a-f0-9]{64}$/),
  operationRevision: z.number().int().positive(),
});
export const retryReviewSchema = z.strictObject({
  effects: z
    .array(
      operationSummarySchema.extend({
        workId: z.uuid(),
        reconciliationReceiptId: z.uuid().optional(),
      }),
    )
    .max(1000),
});
