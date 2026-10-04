import { z } from "zod";
import { endpointSchema, proxySchema } from "./models.js";
const serverId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const envName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/);
const ordinaryEnvName = envName.refine(
  (name) =>
    !/(?:token|secret|password|credential|api_?key|authorization|cookie)/i.test(
      name,
    ),
  "Use an environment reference for credentials",
);
const stdioServer = z.strictObject({
  command: z.string().trim().min(1).max(2048),
  args: z
    .array(
      z
        .string()
        .max(8192)
        .refine(
          (arg) =>
            !/^--?(?:token|api[-_]?key|password|secret|authorization)(?:=|$)/i.test(
              arg,
            ),
          "Use credential references instead of secret command arguments",
        ),
    )
    .max(64)
    .default([]),
  cwd: z.string().min(1).max(2048).optional(),
  env: z.record(ordinaryEnvName, z.string().max(8192)).default({}),
  enabled: z.boolean().default(false),
});
const httpServer = z.strictObject({
  url: endpointSchema,
  enabled: z.boolean().default(false),
});
const timeouts = {
  startupTimeoutMs: z.number().int().min(100).max(120000).default(30000),
  toolTimeoutMs: z.number().int().min(100).max(300000).default(60000),
  receiptUriTemplate: z
    .string()
    .min(1)
    .max(2048)
    .refine(
      (value) =>
        value.includes("{operationId}") && value.includes("{intentHash}"),
      "Receipt URI must bind operationId and intentHash",
    )
    .optional(),
};
const extension = z.discriminatedUnion("transport", [
  z.strictObject({
    transport: z.literal("stdio"),
    envAllowlist: z
      .array(ordinaryEnvName)
      .max(64)
      .default(["PATH", "SystemRoot", "TEMP", "TMP"]),
    envRefs: z.record(envName, envName).default({}),
    ...timeouts,
  }),
  z.strictObject({
    transport: z.literal("streamable-http"),
    bearerTokenEnvVar: envName.optional(),
    headerRefs: z
      .record(
        z
          .string()
          .regex(/^[A-Za-z][A-Za-z0-9-]{0,63}$/)
          .refine(
            (name) =>
              !/^(host|content-length|cookie|connection|mcp-session-id|mcp-protocol-version)$/i.test(
                name,
              ),
            "Protocol and session headers are controlled by the client",
          ),
        envName,
      )
      .default({}),
    networkPolicyId: z.string().min(1).max(128),
    proxy: proxySchema.optional(),
    caRef: envName.optional(),
    ...timeouts,
  }),
]);
export const mcpConfigSchema = z
  .strictObject({
    mcpServers: z.record(serverId, z.union([stdioServer, httpServer])),
    "x-rocky": z.strictObject({
      version: z.literal(1),
      servers: z.record(serverId, extension),
    }),
  })
  .superRefine((config, ctx) => {
    const ids = Object.keys(config.mcpServers),
      options = config["x-rocky"].servers;
    if (ids.length > 256 || JSON.stringify(config).length > 131072)
      ctx.addIssue({
        code: "custom",
        message: "MCP configuration exceeds supported size",
      });
    for (const id of new Set([...ids, ...Object.keys(options)])) {
      const server = config.mcpServers[id],
        option = options[id];
      if (
        !server ||
        !option ||
        "command" in server !== (option.transport === "stdio")
      )
        ctx.addIssue({
          code: "custom",
          path: ["x-rocky", "servers", id],
          message: "Each server requires matching Rocky transport metadata",
        });
      if (
        option?.transport === "streamable-http" &&
        option.bearerTokenEnvVar &&
        Object.keys(option.headerRefs).some(
          (name) => name.toLowerCase() === "authorization",
        )
      )
        ctx.addIssue({
          code: "custom",
          message: "Use one Authorization reference",
        });
    }
  });
export type McpConfig = z.infer<typeof mcpConfigSchema>;
export const mcpConfigSnapshotSchema = z.strictObject({
  revision: z.number().int().min(0),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  config: mcpConfigSchema,
});
export const saveMcpConfigSchema = z.strictObject({
  requestId: z.uuid(),
  expectedRevision: z.number().int().min(0),
  config: mcpConfigSchema,
});
export const emptyMcpConfig = (): McpConfig => ({
  mcpServers: {},
  "x-rocky": { version: 1, servers: {} },
});
