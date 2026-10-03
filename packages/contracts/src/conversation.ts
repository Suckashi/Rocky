import { z } from "zod";
import {
  idSchema,
  revisionSchema,
  sequenceSchema,
  timestampSchema,
  workStatus,
} from "./index.js";
export const conversationSchema = z.strictObject({
  id: idSchema,
  assistantId: idSchema,
  kind: z.literal("main"),
  activeExecutionSessionId: idSchema.nullable(),
  revision: revisionSchema,
});
export const executionSessionSchema = z.strictObject({
  id: idSchema,
  conversationId: idSchema,
  workId: idSchema,
  kind: z.enum(["main", "background", "evaluation"]),
  graphThreadId: idSchema,
  sourceGraphThreadId: idSchema.optional(),
  workspaceId: idSchema.nullable(),
  workspaceRevision: revisionSchema.optional(),
  workspaceRead: z.boolean().optional(),
  generation: z.number().int().positive(),
  status: workStatus,
});
export const conversationMessageSchema = z.strictObject({
  id: z.string().min(1).max(200),
  sequence: sequenceSchema,
  conversationId: idSchema,
  workId: idSchema,
  runId: idSchema,
  executionSessionId: idSchema,
  role: z.enum(["user", "assistant"]),
  source: z.enum(["submission", "work_result", "steering"]),
  text: z.string(),
  status: workStatus,
  error: z.string().optional(),
  createdAt: timestampSchema,
});
export const conversationPageSchema = z.strictObject({
  conversation: conversationSchema,
  messages: z.array(conversationMessageSchema),
  nextCursor: sequenceSchema.nullable(),
});
export const conversationViewSchema = conversationSchema.extend({
  activeSession: executionSessionSchema.nullable(),
  messages: z.array(conversationMessageSchema).max(50),
  cursor: sequenceSchema,
  nextCursor: sequenceSchema.nullable(),
});
