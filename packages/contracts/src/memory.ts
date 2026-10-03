import { z } from "zod";
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
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const memorySearchSchema = z.strictObject({
  scope: memoryScopeSchema,
  query: z.string().trim().max(128).default(""),
  byteBudget: z.number().int().min(128).max(16384).default(4096),
});
export type Memory = z.infer<typeof memorySchema>;
