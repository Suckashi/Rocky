import { z } from "zod";
import { environmentConfigSchema } from "./environments.js";
export const workspaceWorktreeSchema = z.strictObject({
  useForCurrentWork: z.boolean().optional(),
  isolation: z.enum(["worktree", "directory"]).optional(),
});
export const worktreePreviewSchema = z.strictObject({
  environmentTemplate: z
    .object({
      id: z.uuid(),
      revision: z.number().int().positive(),
      config: environmentConfigSchema,
    })
    .optional(),
  destination: z.string().min(1).max(4096),
  branch: z.string().min(1).max(128).nullable(),
  head: z
    .string()
    .regex(/^[a-f0-9]{40,64}$/)
    .nullable(),
  isolation: z.enum(["worktree", "directory"]).optional(),
  useForCurrentWork: z.boolean().optional(),
  grantRead: z.boolean().optional(),
});
export const workspaceWriteSchema = z.strictObject({
  path: z.string().min(1).max(4096),
  content: z.string().max(65536),
  expectedHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
});

export const writePreviewRequestSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  intentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
export const writePreviewSchema = z.strictObject({
  path: z.string().min(1).max(4096),
  previousHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  removedLines: z.number().int().nonnegative(),
  addedLines: z.number().int().nonnegative(),
  complete: z.boolean(),
  omittedRows: z.number().int().nonnegative(),
  previousHasBOM: z.boolean(),
  nextHasBOM: z.boolean(),
  previousLineEnding: z.enum(["none", "lf", "crlf", "cr", "mixed"]),
  nextLineEnding: z.enum(["none", "lf", "crlf", "cr", "mixed"]),
  previousEndsWithNewline: z.boolean(),
  nextEndsWithNewline: z.boolean(),
  rows: z
    .array(
      z.strictObject({
        kind: z.enum(["context", "remove", "add"]),
        text: z.string().max(8192),
        truncated: z.boolean(),
      }),
    )
    .max(500),
});
export const workspaceToolSchema = z.strictObject({
  path: z.string().max(4096).default(""),
});
export const workspaceReadToolSchema = z
  .strictObject({
    path: z.string().min(1).max(4096),
    offset: z.number().int().min(0).max(1048576).default(0),
    limit: z.number().int().min(1).max(65536).default(16384),
    expectedHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .refine((value) => value.offset === 0 || !!value.expectedHash, {
    message: "Continuation requires the original file hash",
  });
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
