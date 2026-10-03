import { z } from "zod";
export const mcpDataResultSchema = z.strictObject({
  kind: z.literal("mcp_data_result"),
  dataKind: z.enum(["resource", "prompt"]),
  result: z.unknown(),
});
export type McpDataResult = z.infer<typeof mcpDataResultSchema>;
export const mcpDeliverySchema = z.strictObject({
  kind: z.literal("mcp_result"),
  source: z.strictObject({
    serverId: z.string().min(1).max(64),
    configRevision: z.number().int().positive(),
    registryRevision: z.number().int().positive(),
    toolName: z.string().min(1).max(256),
    schemaHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  result: z.unknown(),
  dataKind: z.enum(["resource", "prompt"]).optional(),
});
export const runtimeToolReplySchema = z.union([z.string(), mcpDeliverySchema]);
export type McpDelivery = z.infer<typeof mcpDeliverySchema>;
