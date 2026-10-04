import { z } from "zod";
import { modelBudgetSchema } from "./model-budget.js";
import { modelSelectionSchema } from "./index.js";
export const routineConfigSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120),
    prompt: z.string().trim().min(1).max(8000),
    timezone: z
      .string()
      .min(1)
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "IANA timezone required"),
    schedule: z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("cron"),
        expression: z
          .string()
          .trim()
          .min(1)
          .max(120)
          .refine(
            (value) => value.split(/\s+/).length === 5,
            "Use a five-field cron expression",
          ),
      }),
      z.strictObject({
        kind: z.literal("interval"),
        seconds: z.number().int().min(60).max(31536000),
      }),
    ]),
    misfirePolicy: z.enum(["skip", "coalesce-one"]).default("skip"),
    enabled: z.boolean().default(false),
    modelSelection: modelSelectionSchema,
    modelBudget: modelBudgetSchema,
    workspaceId: z.uuid().optional(),
    workspaceRevision: z.number().int().positive().optional(),
    workspaceRead: z.boolean().default(false),
  })
  .refine(
    (value) =>
      !!value.workspaceId === !!value.workspaceRevision &&
      (!value.workspaceRead || !!value.workspaceId),
    "Workspace scope requires an exact revision",
  );
export const routineSaveSchema = z.strictObject({
  requestId: z.uuid(),
  id: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  config: routineConfigSchema,
});
export const routineSchema = z.strictObject({
  id: z.uuid(),
  revision: z.number().int().positive(),
  config: routineConfigSchema,
  nextAt: z.iso.datetime().nullable(),
  lastOccurrenceKey: z.string().nullable(),
  lastWorkId: z.uuid().nullable(),
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Routine = z.infer<typeof routineSchema>;
export const routineOccurrenceSchema = z.strictObject({
  id: z.uuid(),
  routineId: z.uuid(),
  routineRevision: z.number().int().positive(),
  scheduledAt: z.iso.datetime(),
  occurrenceKey: z.string(),
  status: z.enum(["pending", "submitted", "skipped", "failed"]),
  workId: z.uuid().nullable(),
  error: z.string().nullable(),
  submission: z.record(z.string(), z.unknown()),
});
export const routineHistorySchema = z.strictObject({
  occurrences: z
    .array(routineOccurrenceSchema.omit({ submission: true }))
    .max(50),
  nextBefore: z.iso.datetime().nullable(),
});
