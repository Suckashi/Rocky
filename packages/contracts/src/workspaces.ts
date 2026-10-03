import { z } from "zod";
export const workspaceSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().trim().min(1).max(120),
  root: z.string().min(1).max(4096),
  revision: z.number().int().positive(),
  rootIdentity: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const workspaceSaveSchema = z.strictObject({
  requestId: z.uuid(),
  id: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  name: z.string().trim().min(1).max(120),
  root: z.string().min(1).max(4096),
});
export type Workspace = z.infer<typeof workspaceSchema>;
