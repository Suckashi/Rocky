import { z } from "zod";
import { mcpCallSchema } from "./mcp-runtime.js";
export const trackingConfigSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  mapping: mcpCallSchema,
  statusPath: z
    .array(
      z
        .string()
        .min(1)
        .max(120)
        .refine(
          (value) => !["__proto__", "constructor", "prototype"].includes(value),
        ),
    )
    .min(1)
    .max(12),
  followupStatuses: z.array(z.string().min(1).max(200)).max(20),
  followupInstruction: z.string().trim().min(1).max(2000),
  pollSeconds: z.number().int().min(60).max(86400).default(300),
  cooldownSeconds: z.number().int().min(60).max(86400).default(900),
  maxPolls: z.number().int().min(1).max(1000).default(100),
  maxFollowups: z.number().int().min(0).max(20).default(3),
  enabled: z.boolean(),
  confirmReadOnly: z.literal(true),
});
export const trackingSaveSchema = z.strictObject({
  requestId: z.uuid(),
  id: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  workId: z.uuid(),
  config: trackingConfigSchema,
});
export const trackedWorkSchema = z.strictObject({
  id: z.uuid(),
  workId: z.uuid(),
  revision: z.number().int().positive(),
  config: trackingConfigSchema,
  toolIdentity: z.record(z.string(), z.unknown()),
  state: z.enum([
    "paused",
    "ready",
    "polling",
    "unsupported",
    "unknown",
    "exhausted",
  ]),
  polls: z.number().int().nonnegative(),
  followups: z.number().int().nonnegative(),
  nextAt: z.iso.datetime(),
  lastFollowupAt: z.iso.datetime().nullable(),
  lastStatus: z.string().nullable(),
  lastFingerprint: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type TrackedWork = z.infer<typeof trackedWorkSchema>;
