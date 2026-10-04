import { z } from "zod";

export const environmentConfigSchema = z.strictObject({
  engineExecutable: z.string().min(1).max(4096),
  endpoint: z.enum([
    "unix:///var/run/docker.sock",
    "npipe:////./pipe/docker_engine",
  ]),
  image: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*@sha256:[a-f0-9]{64}$/),
  workspaceId: z.uuid(),
  workspaceRevision: z.number().int().positive(),
  memoryMiB: z.number().int().min(128).max(8192).default(512),
  cpus: z.number().min(0.25).max(8).default(1),
});
export const environmentCreateSchema = z.strictObject({
  requestId: z.uuid(),
  config: environmentConfigSchema,
});
export const environmentCommandSchema = z.strictObject({
  requestId: z.uuid(),
  expectedRevision: z.number().int().positive(),
  action: z.enum(["start", "stop", "inspect"]),
});
export const environmentSchema = z.strictObject({
  id: z.uuid(),
  revision: z.number().int().positive(),
  mode: z.literal("isolated"),
  config: environmentConfigSchema,
  state: z.enum([
    "configured",
    "starting",
    "running",
    "stopping",
    "stopped",
    "unavailable",
    "unknown",
  ]),
  containerId: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  engineVersion: z.string().max(200).nullable(),
  networkEnforcement: z.enum(["unverified", "container_none"]),
  compatibility: z.literal("unverified"),
  error: z.string().max(1000).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ComputerEnvironment = z.infer<typeof environmentSchema>;
export const computerCommandSchema = z.strictObject({
  executable: z
    .string()
    .min(2)
    .max(4096)
    .regex(/^\/(?!\/)[^\x00\r\n]+$/),
  args: z.array(z.string().max(8192)).max(128),
  timeoutMs: z.number().int().min(1).max(300000),
  maxOutputBytes: z.number().int().min(1).max(1048576),
});
