import { z } from "zod";
export const artifactPublishSchema = z.strictObject({
  requestId: z.uuid(),
  operationId: z.string().min(1).max(512),
  title: z.string().trim().min(1).max(120),
});
export const artifactPublishToolSchema = z.strictObject({
  writeCallId: z.string().min(1).max(256),
  title: z.string().trim().min(1).max(120),
});
export const artifactSchema = z.strictObject({
  id: z.uuid(),
  title: z.string().min(1).max(120),
  workId: z.uuid(),
  runId: z.uuid(),
  manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
  files: z
    .array(
      z.strictObject({
        id: z.uuid(),
        name: z.string().min(1).max(4096),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        mime: z.string().min(1).max(128),
        size: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(100),
  entry: z.uuid(),
  source: z.strictObject({
    workspaceId: z.uuid(),
    workspaceRevision: z.number().int().positive(),
    path: z.string().min(1).max(4096),
  }),
  verificationRefs: z.array(z.string().min(1).max(512)),
  createdAt: z.iso.datetime(),
});
export type Artifact = z.infer<typeof artifactSchema>;
