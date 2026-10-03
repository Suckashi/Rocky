import { z } from "zod";
export const learningScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("user") }),
  z.strictObject({ kind: z.literal("project"), projectId: z.uuid() }),
]);
export const learningPolicySchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  mode: z.enum(["off", "propose"]),
  scopes: z.array(learningScopeSchema).max(100),
  updatedAt: z.string().datetime().nullable(),
});
export const learningPolicyCommandSchema = z
  .strictObject({
    requestId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    mode: z.enum(["off", "propose"]),
    scopes: z.array(learningScopeSchema).max(100),
    consent: z.literal(true).optional(),
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
  trigger: z.literal("manual_request"),
  goal: z.string().trim().min(1).max(2000),
  constraints: z.array(z.string().max(2000)).max(10),
  corrections: z.array(z.string().max(2000)).max(10),
  verification: z.array(z.string().max(2000)).max(10),
  failuresAndRepairs: z.array(z.string().max(2000)).max(10),
  preconditions: z.array(z.string().max(2000)).max(10),
  evidenceEventIds: z.array(z.uuid()).min(1).max(30),
});
