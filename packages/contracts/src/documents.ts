import { z } from "zod";
export const documentCreateSchema = z.strictObject({
  requestId: z.uuid(),
  artifactId: z.uuid(),
});
export const documentNewSchema = z.strictObject({
  requestId: z.uuid(),
  title: z.string().trim().min(1).max(120),
  content: z.string().max(65536),
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
  scope: z.strictObject({ workspaceId: z.uuid().optional() }),
  sourceArtifactId: z.uuid().optional(),
  sourceWorkId: z.uuid().optional(),
  sourceRunId: z.uuid().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const documentContentSchema = z.strictObject({
  document: documentSchema,
  content: z.string().max(65536),
});
export type RockyDocument = z.infer<typeof documentSchema>;
export const documentHistorySchema = z.strictObject({
  revisions: z.array(documentSchema).max(50),
  nextBefore: z.number().int().positive().nullable(),
});
export const documentWriteToolSchema = z.strictObject({
  id: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  title: z.string().trim().min(1).max(120),
  content: z.string().max(48000),
});
export const documentReadToolSchema = z.strictObject({
  id: z.uuid(),
  revision: z.number().int().positive().optional(),
});
