import { z } from "zod";
export const documentCreateSchema = z.strictObject({
  requestId: z.uuid(),
  artifactId: z.uuid(),
});
export const documentSaveSchema = z.strictObject({
  requestId: z.uuid(),
  expectedRevision: z.number().int().positive(),
  title: z.string().trim().min(1).max(120),
  content: z.string().max(65536),
});
export const documentSchema = z.strictObject({
  id: z.uuid(),
  title: z.string().min(1).max(120),
  revision: z.number().int().positive(),
  contentBlobRef: z.string().regex(/^[a-f0-9]{64}$/),
  scope: z.strictObject({ workspaceId: z.uuid() }),
  sourceArtifactId: z.uuid(),
  sourceWorkId: z.uuid(),
  sourceRunId: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const documentContentSchema = z.strictObject({
  document: documentSchema,
  content: z.string().max(65536),
});
export type RockyDocument = z.infer<typeof documentSchema>;
