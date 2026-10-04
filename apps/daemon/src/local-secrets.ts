import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { RockyError } from "../../../packages/contracts/src/index.js";

const nameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/);
export const saveLocalSecretSchema = z.strictObject({
  requestId: z.string().min(1).max(200),
  name: nameSchema,
  value: z
    .string()
    .min(1)
    .max(8192)
    .refine((value) => !/[\r\n\0]/.test(value), "Single-line value required"),
});

/**
 * Optional, unencrypted local secrets file (spec §11). Values only ever flow into the
 * daemon environment; the API reports names, never values. Explicit process
 * environment variables always win over the file.
 */
export class LocalSecrets {
  readonly path: string;
  private readonly stored = new Map<string, string>();
  constructor(
    root: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    this.path = join(root, "secrets.env");
    if (!existsSync(this.path)) return;
    for (const line of readFileSync(this.path, "utf8").split(/\r?\n/)) {
      const match = /^([A-Za-z_][A-Za-z0-9_]{0,127})=(.*)$/.exec(line);
      if (!match) continue;
      this.stored.set(match[1]!, match[2]!);
      if (this.env[match[1]!] === undefined) this.env[match[1]!] = match[2]!;
    }
  }
  status() {
    return {
      path: this.path,
      encrypted: false,
      names: [...this.stored.keys()].sort(),
    };
  }
  save(input: unknown) {
    const parsed = saveLocalSecretSchema.safeParse(input);
    if (!parsed.success)
      throw new RockyError(
        "invalid_secret",
        "Use an environment-style name and a single-line value",
        400,
      );
    const { name, value } = parsed.data;
    if (this.env[name] !== undefined && !this.stored.has(name))
      throw new RockyError(
        "secret_in_environment",
        "This name is already set in the daemon environment",
        409,
      );
    this.stored.set(name, value);
    const temp = this.path + ".tmp";
    writeFileSync(
      temp,
      [...this.stored].map(([key, item]) => `${key}=${item}\n`).join(""),
      { mode: 0o600 },
    );
    renameSync(temp, this.path);
    this.env[name] = value;
    return { name, stored: true as const };
  }
}
