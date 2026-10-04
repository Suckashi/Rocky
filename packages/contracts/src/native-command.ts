import { isAbsolute } from "node:path";
import { z } from "zod";

/** Exact native command intent. cwd is supplied by the daemon from the Work workspace. */
export const workspaceCommandSchema = z.strictObject({
  executable: z.string().min(1).refine(isAbsolute),
  args: z.array(z.string().max(65536)).max(256),
  timeoutMs: z.number().int().min(1).max(300000),
  maxOutputBytes: z.number().int().min(1).max(1048576),
});
export const nativeCommandSchema = workspaceCommandSchema.extend({
  cwd: z.string().min(1).refine(isAbsolute),
});
export type NativeCommand = z.infer<typeof nativeCommandSchema>;
