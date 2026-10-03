import { z } from "zod";
export const issueSchema = z.strictObject({
  requestId: z.uuid(),
  workId: z.uuid(),
  targetHash: z.string().regex(/^[a-f0-9]{64}$/),
  effect: z.enum(["known_read", "local_new"]),
  policyRevision: z.number().int().positive(),
  expiresAt: z.iso.datetime().nullable(),
  resource: z.literal("memory").optional(),
  memory: z
    .strictObject({
      scope: z.enum(["user", "project", "task"]),
      includePrivate: z.boolean(),
    })
    .optional(),
});
export const grantSchema = issueSchema.extend({
  id: z.uuid(),
  runId: z.uuid(),
  executionSessionId: z.uuid(),
  revision: z.number().int().positive(),
  revoked: z.boolean(),
});
export const revokeGrantSchema = z.strictObject({
  requestId: z.uuid(),
  expectedRevision: z.number().int().positive(),
});
export type Grant = z.infer<typeof grantSchema>;
