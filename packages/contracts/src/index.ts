import { z } from "zod";
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
    requestId: z.uuid(),
    text: z.string().trim().min(1).max(8000),
    transport: z.enum(["stdio", "http"]).default("stdio"),
    mode: z.literal("fixture"),
  })
  .strict();
export const decisionSchema = z
  .object({
    requestId: z.uuid(),
    expectedRevision: z.number().int().positive(),
    intentFingerprint: z.string(),
    decision: z.enum(["approve", "reject"]),
  })
  .strict();
export type WorkStatus = z.infer<typeof workStatus>;
export type Approval = {
  id: string;
  revision: number;
  intentFingerprint: string;
  tool: string;
  args: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "expired";
};
export type Work = {
  id: string;
  runId: string;
  requestId: string;
  text: string;
  transport: "stdio" | "http";
  mode: "fixture";
  runMode: "normal" | "evaluation";
  status: WorkStatus;
  revision: number;
  answer: string;
  approval?: Approval;
  error?: string;
  createdAt: string;
};
export type PublicEvent = {
  schemaVersion: 1;
  id: string;
  sequence: string;
  timestamp: string;
  workId: string;
  runId: string;
  name: string;
  data: Record<string, unknown>;
};
export class RockyError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
