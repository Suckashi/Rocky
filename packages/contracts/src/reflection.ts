import { z } from "zod";
const text = z.string().trim().min(1).max(4000),
  lines = z.array(text).max(40);
export const reflectionBindingSchema = z.strictObject({
  episodeId: z.uuid(),
  episodeRevision: z.number().int().positive(),
  episodeHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const skillCandidateDraftSchema = z.strictObject({
  name: z
    .string()
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: text,
  goal: text,
  preconditions: lines,
  triggers: lines,
  steps: lines.min(1),
  stopConditions: lines,
  verification: lines.min(1),
  evidenceRefs: z.array(z.uuid()).min(1).max(30),
  requiredCapabilities: lines,
  knownLimitations: lines,
});
export const reflectionToolSchemas = {
  read_learning_episode: z.strictObject({}),
  list_allowed_skills: z.strictObject({}),
  read_skill_revision: z.strictObject({
    skillId: z.uuid(),
    revision: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  propose_skill_create: z.strictObject({
    candidate: skillCandidateDraftSchema,
  }),
  propose_skill_patch: z.strictObject({
    base: z.strictObject({
      skillId: z.uuid(),
      revision: z.number().int().positive(),
      contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    }),
    reason: text,
    changes: skillCandidateDraftSchema
      .partial()
      .refine((value) => Object.keys(value).length > 0, "Empty patch"),
  }),
  mark_no_learning: z.strictObject({ reason: text }),
};
