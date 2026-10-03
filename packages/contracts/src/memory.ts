import { z } from "zod";
export const memorySourceSchema = z.strictObject({
  kind: z.literal("document"),
  id: z.uuid(),
  revision: z.number().int().positive(),
});
export const memoryScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("user") }),
  z.strictObject({ kind: z.literal("project"), id: z.uuid() }),
  z.strictObject({ kind: z.literal("task"), id: z.uuid() }),
]);
export const memorySaveSchema = z.strictObject({
  requestId: z.uuid(),
  id: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  scope: memoryScopeSchema,
  content: z.string().trim().min(1).max(4096),
  status: z
    .enum(["unverified", "confirmed", "conflicted"])
    .default("unverified"),
  private: z.boolean().default(true),
  sources: z.array(memorySourceSchema).max(16).default([]),
});
export const memoryDeleteSchema = z.strictObject({
  requestId: z.uuid(),
  expectedRevision: z.number().int().positive(),
});
export const memorySchema = z.strictObject({
  id: z.uuid(),
  scope: memoryScopeSchema,
  content: z.string().min(1).max(4096),
  status: z.enum(["unverified", "confirmed", "conflicted"]),
  private: z.boolean(),
  revision: z.number().int().positive(),
  locked: z.literal(true),
  userEdited: z.literal(true),
  source: z.literal("owner"),
  sources: z.array(memorySourceSchema).max(16).default([]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const memorySearchSchema = z.strictObject({
  scope: memoryScopeSchema,
  query: z.string().trim().max(128).default(""),
  byteBudget: z.number().int().min(128).max(16384).default(4096),
  tokenBudget: z.number().int().min(2).max(16384).default(8192),
});
export type Memory = z.infer<typeof memorySchema>;
export const memoryReadToolSchema = z.strictObject({
  scope: z.enum(["user", "project", "task"]),
  includePrivate: z.boolean().default(false),
  query: z.string().trim().max(128).default(""),
  tokenBudget: z.number().int().min(2).max(16384).default(2048),
});
export const memoryReadGrantSchema = z.strictObject({
  requestId: z.uuid(),
  scope: z.enum(["user", "project", "task"]),
  includePrivate: z.boolean().default(false),
  expiresAt: z.iso.datetime().nullable().default(null),
});
