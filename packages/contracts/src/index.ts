import { z } from "zod";
import { EventSchemas } from "@ag-ui/core/schemas";
import { modelBudgetSchema } from "./model-budget.js";
export const API_PREFIX = "/api/v1";
export const idSchema = z.uuid();
export const revisionSchema = z.number().int().positive();
export const sequenceSchema = z
  .string()
  .max(19)
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine(
    (value) =>
      value.length <= 19 &&
      /^(0|[1-9][0-9]*)$/.test(value) &&
      BigInt(value) <= 9223372036854775807n,
    "Sequence exceeds storage range",
  );
export const timestampSchema = z.iso.datetime();
export const modelSelectionSchema = z.strictObject({
  connectionId: idSchema,
  revision: revisionSchema,
});
export const workStatus = z.enum([
  "queued",
  "running",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
  "blocked",
  "interrupted",
]);
export const submissionSchema = z
  .object({
    requestId: idSchema,
    text: z.string().trim().min(1).max(8000),
    transport: z.enum(["stdio", "http"]).default("stdio"),
    mode: z.enum(["fixture", "configured"]),
    modelSelection: modelSelectionSchema.optional(),
    modelBudget: modelBudgetSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.mode === "configured") === (value.modelSelection !== undefined),
    {
      message: "Configured mode requires an explicit model connection revision",
    },
  );
export const decisionSchema = z
  .object({
    requestId: idSchema,
    expectedRevision: revisionSchema,
    intentFingerprint: z.string(),
    decision: z.enum(["approve", "reject"]),
  })
  .strict();
export const stopSchema = z
  .object({
    requestId: idSchema,
    runId: idSchema,
    executionSessionId: idSchema,
    expectedRevision: revisionSchema,
  })
  .strict();
export const approvalSchema = z
  .object({
    id: idSchema,
    revision: revisionSchema,
    intentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    tool: z.string().min(1),
    args: z.record(z.string(), z.unknown()),
    status: z.enum(["pending", "approved", "rejected", "expired"]),
  })
  .strict();
export const workSchema = z
  .object({
    id: idSchema,
    runId: idSchema,
    executionSessionId: idSchema,
    requestId: idSchema,
    text: z.string(),
    transport: z.enum(["stdio", "http"]),
    mode: z.enum(["fixture", "configured"]),
    modelSelection: modelSelectionSchema.optional(),
    modelBudget: modelBudgetSchema.optional(),
    runMode: z.enum(["normal", "evaluation", "unknown"]),
    status: workStatus,
    revision: revisionSchema,
    answer: z.string(),
    approval: approvalSchema.optional(),
    error: z.string().optional(),
    createdAt: timestampSchema,
  })
  .strict()
  .refine(
    (value) =>
      (value.mode === "configured") === (value.modelSelection !== undefined),
    { message: "Work model selection does not match its mode" },
  );
export const domainPayloadSchema = z
  .object({
    kind: z.literal("domain"),
    name: z.string().regex(/^rocky\.[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+$/),
    data: z.record(z.string(), z.unknown()),
  })
  .strict()
  .superRefine((payload, ctx) => {
    if (
      payload.name === "rocky.work.updated" &&
      !z.object({ work: workSchema }).strict().safeParse(payload.data).success
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid work projection",
        path: ["data"],
      });
    if (
      payload.name === "rocky.approval.required" &&
      !z.object({ approval: approvalSchema }).strict().safeParse(payload.data)
        .success
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid approval projection",
        path: ["data"],
      });
  });
export const publicEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: idSchema,
    sequence: sequenceSchema,
    timestamp: timestampSchema,
    workId: idSchema.optional(),
    runId: idSchema.optional(),
    segmentId: idSchema.optional(),
    executionSessionId: idSchema.optional(),
    subagentId: z.string().min(1).optional(),
    payload: z.union([
      domainPayloadSchema,
      z
        .object({
          kind: z.literal("agui"),
          event: z.custom<ReturnType<typeof EventSchemas.parse>>(
            (value) => EventSchemas.safeParse(value).success,
            "Invalid official AG-UI event",
          ),
        })
        .strict(),
    ]),
  })
  .strict();
export const snapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    cursor: sequenceSchema,
    works: z.array(workSchema),
    events: z.array(publicEventSchema),
  })
  .strict();
export const errorSchema = z
  .object({
    code: z.string().regex(/^[a-z][a-z0-9_]*$/),
    message: z.string(),
    retryable: z.boolean().optional(),
    requestId: idSchema.optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export const completionSchema = z
  .object({
    id: z.string().regex(/^work-result:[0-9a-f-]{36}$/),
    workId: idSchema,
    runId: idSchema,
    sequence: sequenceSchema,
    status: z.enum([
      "completed",
      "failed",
      "cancelled",
      "blocked",
      "interrupted",
    ]),
    text: z.string(),
    error: z.string().optional(),
    createdAt: timestampSchema,
  })
  .strict();
export const environmentSchema = z
  .object({ ROCKY_DATA_DIR: z.string().trim().min(1).optional() })
  .strict();
export type WorkStatus = z.infer<typeof workStatus>;
export type Approval = z.infer<typeof approvalSchema>;
export type Work = z.infer<typeof workSchema>;
export type PublicEvent = z.infer<typeof publicEventSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export class RockyError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
