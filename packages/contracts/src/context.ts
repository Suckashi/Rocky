import { z } from "zod";
import { idSchema, sequenceSchema } from "./index.js";
export const contextItemSchema = z.strictObject({
  id: z.string().min(1).max(300),
  content: z.string(),
});
export const contextBatchSchema = z
  .strictObject({
    id: idSchema,
    workId: idSchema,
    runId: idSchema,
    sourceThreadId: idSchema.optional(),
    items: z.array(contextItemSchema),
    highWatermark: sequenceSchema,
    index: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    status: z.enum(["staged", "applied"]),
    checkpointId: idSchema.optional(),
  })
  .refine(
    (batch) =>
      batch.index <= batch.items.length &&
      batch.offset <= (batch.items[batch.index]?.content.length ?? 0) &&
      (batch.status !== "applied" ||
        (batch.checkpointId !== undefined &&
          batch.index === batch.items.length &&
          batch.offset === 0)),
    "Invalid context delivery state",
  );
export const contextChunkSchema = z.discriminatedUnion("done", [
  z.strictObject({
    done: z.literal(true),
    marker: z.string().max(1024),
    markerId: z.string().max(300),
  }),
  z.strictObject({
    done: z.literal(false),
    id: z.string().max(300),
    text: z
      .string()
      .refine((text) => new TextEncoder().encode(text).byteLength <= 8192),
    final: z.boolean(),
    nextIndex: z.number().int().nonnegative(),
    nextOffset: z.number().int().nonnegative(),
  }),
]);
export const contextReceiptSchema = z.strictObject({
  batchId: idSchema,
  checkpointId: idSchema,
  status: z.literal("applied"),
});
export type ContextBatch = z.infer<typeof contextBatchSchema>;
