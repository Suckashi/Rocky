import { z } from "zod";
import { modelBudgetSchema } from "./model-budget.js";
const selection = z.strictObject({
  connectionId: z.uuid(),
  revision: z.number().int().positive(),
});
export const learningAutomationSchema = z.strictObject({
  modelSelection: selection,
  reflectionBudget: modelBudgetSchema.refine(
    (value) => value.maxCalls <= 12,
    "Reflection has a twelve-call maximum",
  ),
  suiteId: z.uuid(),
  suiteRevision: z.number().int().positive(),
  suiteHash: z.string().regex(/^[a-f0-9]{64}$/),
  evaluationTarget: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("fixture") }),
    z.strictObject({
      mode: z.literal("configured"),
      modelSelection: selection,
    }),
  ]),
  maxEpisodesPerDay: z.number().int().min(1).max(20).default(3),
});
export const learningScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("user") }),
  z.strictObject({ kind: z.literal("project"), projectId: z.uuid() }),
]);
export const learningPolicySchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  mode: z.enum(["off", "propose"]),
  scopes: z.array(learningScopeSchema).max(100),
  updatedAt: z.string().datetime().nullable(),
  automation: learningAutomationSchema.nullable().optional(),
});
export const learningPolicyCommandSchema = z
  .strictObject({
    requestId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    mode: z.enum(["off", "propose"]),
    scopes: z.array(learningScopeSchema).max(100),
    consent: z.literal(true).optional(),
    automation: learningAutomationSchema.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === "propose" && (!value.consent || !value.scopes.length))
      ctx.addIssue({
        code: "custom",
        message:
          "Propose requires explicit owner consent and at least one scope",
      });
    if (value.mode === "off" && value.scopes.length)
      ctx.addIssue({
        code: "custom",
        message: "Off policy must have no allowed scopes",
      });
    const keys = value.scopes.map((scope) =>
      scope.kind === "user" ? "user" : scope.projectId,
    );
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({ code: "custom", message: "Duplicate Learning scope" });
  });

export const learningWorkConsentSchema = z.strictObject({
  workId: z.uuid(),
  revision: z.number().int().nonnegative(),
  private: z.boolean(),
  excluded: z.boolean(),
  sourceReuseAllowed: z.boolean(),
  updatedAt: z.string().datetime().nullable(),
});
export const learningWorkConsentCommandSchema = z.strictObject({
  requestId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  private: z.boolean(),
  excluded: z.boolean(),
  sourceReuseAllowed: z.boolean(),
});

export const learningEpisodeCommandSchema = z.strictObject({
  requestId: z.uuid(),
  workId: z.uuid(),
  expectedPolicyRevision: z.number().int().nonnegative(),
  expectedConsentRevision: z.number().int().positive(),
  trigger: z.enum([
    "manual_request",
    "user_correction",
    "verified_multistep",
    "repaired_failure",
  ]),
  goal: z.string().trim().min(1).max(2000),
  constraints: z.array(z.string().max(2000)).max(10),
  corrections: z.array(z.string().max(2000)).max(10),
  verification: z.array(z.string().max(2000)).max(10),
  failuresAndRepairs: z.array(z.string().max(2000)).max(10),
  preconditions: z.array(z.string().max(2000)).max(10),
  evidenceEventIds: z.array(z.uuid()).min(1).max(30),
});

export const learningEpisodeReviewSchema = z.strictObject({
  requestId: z.uuid(),
  expectedRevision: z.number().int().positive(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  decision: z.enum(["approve", "reject"]),
});
export const learningEpisodeEditSchema = z.strictObject({
  requestId: z.uuid(),
  expectedRevision: z.number().int().positive(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  summary: learningEpisodeCommandSchema.pick({
    goal: true,
    constraints: true,
    corrections: true,
    verification: true,
    failuresAndRepairs: true,
    preconditions: true,
  }),
});
