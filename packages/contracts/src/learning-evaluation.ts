import { z } from "zod";
import { candidateBaseSchema } from "./learning-candidates.js";
import { modelBudgetSchema } from "./model-budget.js";
export const evaluationBindingSchema = z.strictObject({
  evaluationId: z.uuid(),
  caseId: z.uuid(),
  variant: z.enum(["baseline", "current", "candidate"]),
  proposalId: z.uuid(),
  candidateRevision: z.number().int().positive(),
  candidateHash: z.string().regex(/^[a-f0-9]{64}$/),
  current: candidateBaseSchema.nullable(),
});
export const evaluationCaseSchema = z.strictObject({
  id: z.uuid(),
  revision: z.number().int().positive(),
  family: z.string().trim().min(1).max(128),
  sourceGroup: z.string().trim().min(1).max(128),
  split: z.enum(["train", "validation", "holdout"]),
  kind: z.enum(["sample_workflow", "coding"]),
  prompt: z.string().trim().min(1).max(8000),
  transport: z.enum(["stdio", "http"]),
  decision: z.enum(["approve", "reject"]),
  repetitions: z.number().int().min(3).max(10).default(3),
  required: z.boolean().default(true),
  negative: z.boolean().default(false),
  expected: z.strictObject({
    writes: z.number().int().min(0).max(10),
    childCompleted: z.boolean(),
    writeValue: z.string().max(4096).optional(),
    answerContains: z.array(z.string().min(1).max(256)).max(10).default([]),
  }),
});
export const evaluationSuiteCommandSchema = z.strictObject({
  requestId: z.uuid(),
  id: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  name: z.string().trim().min(1).max(120),
  primaryMetric: z.literal("task_success"),
  improvement: z.enum(["task_success", "model_calls", "tokens"]),
  minimumImprovement: z.number().positive().max(1000),
  cases: z.array(evaluationCaseSchema).min(1).max(100),
  modelBudget: modelBudgetSchema,
  maxRuns: z.number().int().min(1).max(300).default(60),
  maxModelCalls: z.number().int().min(1).max(10000).default(480),
  maxTokens: z.number().int().positive().max(100000000).default(2000000),
  wallBudgetMs: z.number().int().min(1000).max(14400000).default(3600000),
  reportByteBudget: z
    .number()
    .int()
    .min(65536)
    .max(1073741824)
    .default(1073741824),
});
export const evaluationStartSchema = z.strictObject({
  requestId: z.uuid(),
  expectedRevision: z.number().int().positive(),
  candidateHash: z.string(),
  suiteId: z.uuid(),
  suiteRevision: z.number().int().positive(),
  suiteHash: z.string().regex(/^[a-f0-9]{64}$/),
  target: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("fixture") }),
    z.strictObject({
      mode: z.literal("configured"),
      modelSelection: z.strictObject({
        connectionId: z.uuid(),
        revision: z.number().int().positive(),
      }),
    }),
  ]),
});
