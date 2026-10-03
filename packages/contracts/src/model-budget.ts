import { z } from "zod";
const idSchema = z.uuid();
const count = z.number().int().min(0).max(1000000000);
export const modelBudgetSchema = z
  .strictObject({
    maxCalls: z.number().int().min(1).max(10000).default(48),
    maxTokens: count.nullable().default(null),
    maxMicroUsd: count.nullable().default(null),
    pricing: z
      .strictObject({
        inputMicroUsdPerMillion: count,
        outputMicroUsdPerMillion: count,
      })
      .nullable()
      .default(null),
  })
  .refine((b) => b.maxMicroUsd === null || b.pricing !== null, {
    message: "Cost limits require explicit pricing",
  });
export const tokenUsageSchema = z.strictObject({
  inputTokens: count,
  outputTokens: count,
});
export const modelReservationSchema = z.strictObject({
  requestId: idSchema,
  purpose: z.enum([
    "target",
    "subagent",
    "summary",
    "reflection",
    "generator",
    "grader",
  ]),
  inputTokenBound: count.nullable(),
  outputTokenBound: count.nullable(),
});
export type ModelBudget = z.infer<typeof modelBudgetSchema>;
export type TokenUsage = z.infer<typeof tokenUsageSchema>;
export const modelUsageEntrySchema = modelReservationSchema.extend({
  status: z.enum(["reserved", "settled"]),
  usage: tokenUsageSchema.nullable(),
});
const total = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const money = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const modelUsageSnapshotSchema = z.strictObject({
  runId: idSchema,
  budget: modelBudgetSchema,
  calls: z.number().int().min(0).max(10000),
  knownUsage: z.strictObject({ inputTokens: total, outputTokens: total }),
  unknownUsageCalls: z.number().int().min(0).max(10000),
  heldTokens: total,
  heldMicroUsd: money,
  knownEstimatedMicroUsd: money.nullable(),
  entries: z.array(modelUsageEntrySchema).max(10000),
});
