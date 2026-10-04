import { z } from "zod";
import {
  skillCandidateDraftSchema,
  reflectionBindingSchema,
} from "./reflection.js";
import { learningScopeSchema } from "./learning.js";
export const candidateBaseSchema = z.strictObject({
  skillId: z.uuid(),
  revision: z.number().int().positive(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const candidateSchema = skillCandidateDraftSchema.extend({
  proposalId: z.uuid(),
  revision: z.number().int().positive(),
  candidateRevision: z.number().int().positive(),
  candidateHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceOutputId: z.uuid(),
  sourceWorkId: z.uuid(),
  binding: reflectionBindingSchema,
  scope: learningScopeSchema,
  base: candidateBaseSchema.nullable(),
  baseSelectionRevision: z.number().int().nonnegative(),
  files: z
    .array(
      z.strictObject({
        path: z.string(),
        blobRef: z.string(),
        sha256: z.string(),
      }),
    )
    .min(1)
    .max(128),
  packageHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum([
    "draft",
    "evaluating",
    "needs_review",
    "insufficient_evidence",
    "failed",
    "rejected",
    "withdrawn",
    "published",
    "quarantined",
  ]),
  evaluationId: z.uuid().nullable(),
  reason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  published: z
    .strictObject({
      skillId: z.uuid(),
      skillRevision: z.number().int().positive(),
      contentHash: z.string(),
    })
    .nullable(),
});
export type SkillCandidate = z.infer<typeof candidateSchema>;
export const candidateEditSchema = z.strictObject({
  requestId: z.uuid(),
  expectedRevision: z.number().int().positive(),
  candidateHash: z.string(),
  draft: skillCandidateDraftSchema,
  reason: z.string().trim().min(1).max(4000),
});
export const candidateCommandSchema = z
  .strictObject({
    requestId: z.uuid(),
    expectedRevision: z.number().int().positive(),
    candidateHash: z.string(),
    action: z.enum(["reject", "withdraw", "resubmit", "quarantine", "approve"]),
    evaluationId: z.uuid().optional(),
    baseRevision: z.number().int().positive().nullable().optional(),
    evaluationManifestHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    policyRevision: z.number().int().nonnegative().optional(),
  })
  .refine(
    (value) =>
      value.action !== "approve" ||
      (value.evaluationId &&
        value.baseRevision !== undefined &&
        value.evaluationManifestHash &&
        value.policyRevision !== undefined),
    "Publication requires exact base, evaluation manifest and policy revision",
  );
