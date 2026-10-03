import { z } from "zod";
import { RockyError } from "../../../packages/contracts/src/index.js";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const owner = z.strictObject({
  workId: z.uuid(),
  runId: z.uuid(),
  executionSessionId: z.uuid(),
});
const inputSchema = z.strictObject({
  owner,
  resolvedOwner: owner,
  mode: z.enum(["normal", "evaluation", "reflection", "unknown"]),
  effect: z.enum(["denied", "known_read", "local_new", "critical", "unknown"]),
  configurationAllowed: z.boolean(),
  resourceAllowed: z.boolean(),
  revoked: z.boolean(),
  preparedTargetHash: hash,
  currentTargetHash: hash,
  policyRevision: z.number().int().positive(),
  preparedPolicyRevision: z.number().int().positive(),
  operationId: z.string().min(1).max(300),
  intentFingerprint: hash,
  synthetic: z.boolean(),
  allowLocalNew: z.boolean(),
  targetExists: z.boolean(),
  approval: z
    .strictObject({
      status: z.enum(["pending", "approved", "rejected", "expired"]),
      operationId: z.string().optional(),
      intentFingerprint: hash,
    })
    .nullable(),
});
export type PolicyInput = z.infer<typeof inputSchema>;

/** Call only with daemon-resolved scope/classification, never MCP hints or model arguments. */
export function authorizeOperation(
  input: PolicyInput,
): "read" | "local_new" | "exact_consent" {
  const value = inputSchema.parse(input);
  const denied = () =>
    new RockyError(
      "tool_denied",
      "Operation is outside its current authorized scope",
      403,
    );
  if (
    value.revoked ||
    !value.configurationAllowed ||
    !value.resourceAllowed ||
    value.effect === "denied" ||
    value.mode === "unknown" ||
    Object.keys(value.owner).some(
      (key) =>
        value.owner[key as keyof typeof value.owner] !==
        value.resolvedOwner[key as keyof typeof value.owner],
    )
  )
    throw denied();
  if (
    value.preparedTargetHash !== value.currentTargetHash ||
    value.policyRevision !== value.preparedPolicyRevision
  )
    throw new RockyError(
      "target_changed",
      "Operation target or policy changed; prepare a fresh request",
      409,
    );
  if (
    value.mode !== "normal" &&
    !value.synthetic &&
    value.effect !== "known_read"
  )
    throw denied();
  if (value.effect === "known_read") return "read";
  if (
    value.effect === "local_new" &&
    value.allowLocalNew &&
    !value.targetExists
  )
    return "local_new";
  if (
    value.approval?.status !== "approved" ||
    value.approval.operationId !== value.operationId ||
    value.approval.intentFingerprint !== value.intentFingerprint
  )
    throw new RockyError(
      "approval_required",
      "Exact server approval required",
      403,
    );
  return "exact_consent";
}
