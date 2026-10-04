import { z } from "zod";
import { idSchema, revisionSchema } from "./index.js";

// URLs contain routing only. Secrets belong in daemon environment references.
export const endpointSchema = z
  .string()
  .max(2048)
  .transform((value, ctx) => {
    try {
      const url = new URL(value);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw Error();
      return url.href.replace(/\/+$/, "");
    } catch {
      ctx.addIssue({
        code: "custom",
        message:
          "Use an HTTP(S) endpoint without credentials, query or fragment",
      });
      return z.NEVER;
    }
  });
const envRef = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/);
export const proxySchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("direct") }),
  z.strictObject({ mode: z.literal("environment") }),
  z.strictObject({ mode: z.literal("explicit"), url: endpointSchema }),
]);
export const modelConfigSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(80),
    provider: z.enum([
      "openai-compatible",
      "openai",
      "anthropic",
      "ollama-compatible",
    ]),
    baseUrl: endpointSchema,
    modelId: z.string().trim().min(1).max(200),
    credentialRef: envRef.nullable().default(null),
    contextWindowTokens: z
      .number()
      .int()
      .min(1)
      .max(100000000)
      .nullable()
      .default(null),
    maxOutputTokens: z.number().int().min(1).max(1000000),
    requestTimeoutMs: z.number().int().min(1000).max(600000).optional(),
    firstTokenTimeoutMs: z.number().int().min(1000).max(600000).optional(),
    idleTimeoutMs: z.number().int().min(1000).max(600000).optional(),
    visionEnabled: z.boolean().default(false),
    proxy: proxySchema.default({ mode: "direct" }),
    caRef: envRef.nullable().default(null),
  })
  .refine(
    (c) =>
      c.contextWindowTokens === null ||
      c.maxOutputTokens <= c.contextWindowTokens,
    { message: "Output limit exceeds configured context window" },
  );
export const modelConnectionSchema = z.strictObject({
  id: idSchema,
  revision: revisionSchema,
  config: modelConfigSchema,
});
export const saveModelSchema = z.strictObject({
  requestId: idSchema,
  id: idSchema,
  expectedRevision: z.number().int().min(0),
  config: modelConfigSchema,
});
export const probeModelSchema = z.strictObject({
  requestId: idSchema,
  expectedRevision: revisionSchema,
});
const checkStatus = z.enum(["passed", "failed", "not_run"]);
export const modelProbeSchema = z.strictObject({
  id: idSchema,
  connectionId: idSchema,
  revision: revisionSchema,
  status: z.enum(["running", "completed", "failed", "interrupted"]),
  checks: z.strictObject({
    text: checkStatus,
    stream: checkStatus,
    tools: checkStatus,
    cancellation: checkStatus,
  }),
  requests: z.number().int().min(0).max(5),
  outputTokenLimitPerRequest: z.number().int().min(1).max(128),
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type ModelConfig = z.infer<typeof modelConfigSchema>;
export type ModelConnection = z.infer<typeof modelConnectionSchema>;
export type ModelProbe = z.infer<typeof modelProbeSchema>;
export const publicModelSchema = z.strictObject({
  id: idSchema,
  revision: revisionSchema,
  config: modelConfigSchema.transform(
    ({ credentialRef: _credential, caRef: _ca, ...config }) => config,
  ),
  credential: z.strictObject({
    configured: z.boolean(),
    available: z.boolean(),
  }),
  caConfigured: z.boolean(),
  probe: modelProbeSchema.nullable(),
});
export type PublicModel = z.infer<typeof publicModelSchema>;
