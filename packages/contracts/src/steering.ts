import { z } from "zod";
import { idSchema, revisionSchema, timestampSchema } from "./index.js";
export const steerCommandSchema = z.strictObject({
  requestId: idSchema,
  runId: idSchema,
  executionSessionId: idSchema,
  expectedRevision: revisionSchema,
  text: z.string().trim().min(1).max(8000),
});
export const steeringReceiptSchema = steerCommandSchema.extend({
  id: idSchema,
  workId: idSchema,
  status: z.enum(["accepted", "applied", "not_applied"]),
  createdAt: timestampSchema,
  reason: z.string().optional(),
  checkpointId: idSchema.optional(),
});
export type SteeringReceipt = z.infer<typeof steeringReceiptSchema>;
