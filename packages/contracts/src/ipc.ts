import { z } from "zod";
import {
  idSchema,
  sequenceSchema,
  errorSchema,
  publicEventSchema,
} from "./index.js";

// Wire contract only. Run ownership and capability verification belong to T-009's daemon broker.
export const ipcMessageSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: idSchema,
    runId: idSchema,
    executionSessionId: idSchema,
    runCapability: z.string().regex(/^[a-f0-9]{64}$/),
    sequence: sequenceSchema,
    payload: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("tool_request"),
          logicalToolCallId: z.string().min(1).max(256),
          tool: z.string().min(1).max(128),
          args: z.record(z.string(), z.unknown()),
        })
        .strict(),
      z
        .object({ kind: z.literal("tool_result"), result: z.unknown() })
        .strict(),
      z
        .object({
          kind: z.literal("cancel"),
          reason: z.enum(["owner_stop", "shutdown", "timeout"]),
        })
        .strict(),
      z.object({ kind: z.literal("event"), event: publicEventSchema }).strict(),
      z.object({ kind: z.literal("error"), error: errorSchema }).strict(),
    ]),
  })
  .strict();

export function parseIpcMessage(wire: string) {
  if (wire.length > 65536 || new TextEncoder().encode(wire).byteLength > 65536)
    throw new Error("IPC message exceeds 65536 bytes");
  return ipcMessageSchema.parse(JSON.parse(wire));
}
