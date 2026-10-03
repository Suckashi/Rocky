import { z } from "zod";
export const mcpLifecycleCommandSchema = z.strictObject({
  requestId: z.uuid(),
  expectedRevision: z.number().int().min(0),
});
export const mcpStateSchema = z.strictObject({
  serverId: z.string(),
  configRevision: z.number().int().min(0),
  status: z.enum([
    "disabled",
    "configured",
    "starting",
    "ready",
    "failed",
    "stopping",
  ]),
  pid: z.number().int().positive().nullable(),
  registryRevision: z.number().int().min(0),
  toolsCount: z.number().int().min(0).max(1000),
  updatedAt: z.iso.datetime(),
  error: z.string().nullable(),
  diagnostics: z.array(z.string().max(8192)).max(16),
});
export type McpState = z.infer<typeof mcpStateSchema>;
export const mcpDiscoverSchema = z.strictObject({
  serverId: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,63}$/)
    .optional(),
  registryRevision: z.number().int().min(1).optional(),
  offset: z.number().int().min(0).max(1000).default(0),
});
export const mcpCallSchema = z.strictObject({
  serverId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  registryRevision: z.number().int().min(1),
  toolName: z.string().min(1).max(256),
  arguments: z.record(z.string(), z.unknown()),
});
