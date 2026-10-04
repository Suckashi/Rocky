import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { RockyError } from "../../../packages/contracts/src/index.js";
import type { Store } from "./store.js";

/** A bounded report/cache quota. Never evict checkpoints, artifacts or formal skills. */
export class LearningQuota {
  readonly limit = z.coerce
    .number()
    .int()
    .min(1048576)
    .max(50 * 1024 ** 3)
    .parse(process.env.ROCKY_LEARNING_CACHE_BYTES ?? 1073741824);
  constructor(private readonly store: Store) {}
  async check(incomingBytes = 0, replacingId = "") {
    let bytes =
      Number(
        (
          this.store.db
            .prepare(
              "SELECT coalesce(sum(length(CAST(data AS BLOB))),0) AS bytes FROM learning_evaluations WHERE id!=?",
            )
            .get(replacingId) as { bytes: number }
        ).bytes,
      ) + incomingBytes;
    let count = 0;
    const ensure = () => {
      if (bytes > this.limit || count > 100000)
        throw new RockyError(
          "learning_quota",
          "Learning report/cache quota exhausted; no new evaluation calls are allowed. Retained evidence, checkpoints and published skills were not deleted.",
          429,
        );
    };
    const walk = async (path: string, depth: number): Promise<void> => {
      if (depth > 32)
        throw new RockyError(
          "learning_storage",
          "Learning cache directory is too deep",
          409,
        );
      const stat = await lstat(path);
      count++;
      ensure();
      if (
        stat.isSymbolicLink() ||
        (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1))
      )
        throw new RockyError(
          "learning_storage",
          "Learning cache contains a linked or special path",
          409,
        );
      if (stat.isFile()) {
        bytes += stat.size;
        ensure();
        return;
      }
      for (const name of await readdir(path))
        await walk(join(path, name), depth + 1);
    };
    ensure();
    try {
      await walk(join(this.store.root, "learning-evaluations"), 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return { bytes, limit: this.limit, policy: "stop_without_eviction" };
  }
}
