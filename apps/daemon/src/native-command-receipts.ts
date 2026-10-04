import { mkdir, open, rename, unlink, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { intentHash } from "./intent.js";
import type { OperationObservation } from "./operation-reconciler.js";
import { RockyError } from "../../../packages/contracts/src/index.js";

const receiptSchema = z.strictObject({
  operationId: z.string().min(1).max(300),
  intentHash: z.string().regex(/^[a-f0-9]{64}$/),
  evidenceRef: z.uuid(),
  observedAt: z.iso.datetime(),
  result: z.strictObject({
    reason: z.enum([
      "exited",
      "spawn_failed",
      "cancelled",
      "timed_out",
      "output_limit",
      "termination_unconfirmed",
    ]),
    launched: z.boolean(),
    exitCode: z.number().int().nullable(),
    signal: z.string().nullable(),
    stdout: z.string().max(1048576),
    stderr: z.string().max(1048576),
    outputTruncated: z.boolean(),
    untrustedData: z.literal(true),
    meaning: z.string().max(1000),
    isolation: z.literal("none"),
    networkEnforcement: z.literal("application_only"),
  }),
});
const envelopeSchema = z.strictObject({
  receipt: receiptSchema,
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
});
const checksumOf = (receipt: z.infer<typeof receiptSchema>) =>
  createHash("sha256")
    .update("rocky.native-receipt.v1\n")
    .update(JSON.stringify(receipt))
    .digest("hex");

/** Durable process receipt, independent of the domain transaction that settles its effect.
 * Missing/incomplete receipt never proves failure or authorizes re-execution.
 */
export class NativeCommandReceipts {
  private readonly directory: string;
  constructor(root: string) {
    this.directory = join(root, "native-command-receipts");
  }
  private path(id: string) {
    return join(this.directory, intentHash(id) + ".json");
  }
  async save(operation: { id: string; args_hash: string }, result: unknown) {
    const receipt = receiptSchema.parse({
      operationId: operation.id,
      intentHash: operation.args_hash,
      evidenceRef: randomUUID(),
      observedAt: new Date().toISOString(),
      result,
    });
    const envelope = JSON.stringify({ receipt, checksum: checksumOf(receipt) });
    if (Buffer.byteLength(envelope) > 2097152)
      throw new RockyError(
        "receipt_limit",
        "Native receipt exceeds storage limit",
        413,
      );
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if ((await lstat(this.directory)).isSymbolicLink())
      throw new RockyError("receipt_path", "Receipt directory is linked", 409);
    const temporary = join(this.directory, randomUUID() + ".tmp");
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(envelope);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      // The operation dispatch fence permits only one execution/receipt writer.
      await rename(temporary, this.path(operation.id));
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    return receipt;
  }
  async observe(
    operation: { id: string; args_hash: string },
    signal: AbortSignal,
  ): Promise<OperationObservation> {
    const unknown = (details: string): OperationObservation => ({
      operationId: operation.id,
      intentHash: operation.args_hash,
      outcome: "unknown",
      result: null,
      evidenceRef: randomUUID(),
      observedAt: new Date().toISOString(),
      details,
    });
    signal.throwIfAborted();
    try {
      if ((await lstat(this.directory)).isSymbolicLink())
        throw Error("Linked receipt directory");
      const path = this.path(operation.id),
        before = await lstat(path, { bigint: true });
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        before.nlink !== 1n ||
        before.size > 2097152n
      )
        throw Error("Invalid receipt file");
      const handle = await open(
        path,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      let text: string;
      try {
        const stat = await handle.stat({ bigint: true });
        if (stat.ino !== before.ino || stat.dev !== before.dev)
          throw Error("Receipt identity changed");
        const bytes = Buffer.alloc(Number(before.size) + 1);
        let length = 0;
        while (length < bytes.length) {
          signal.throwIfAborted();
          const result = await handle.read(
            bytes,
            length,
            bytes.length - length,
            length,
          );
          if (!result.bytesRead) break;
          length += result.bytesRead;
        }
        const after = await handle.stat({ bigint: true });
        if (
          length !== Number(before.size) ||
          before.mtimeNs !== after.mtimeNs ||
          before.ctimeNs !== after.ctimeNs
        )
          throw Error("Receipt changed while reading");
        text = bytes.subarray(0, length).toString("utf8");
      } finally {
        await handle.close();
      }
      const { receipt, checksum } = envelopeSchema.parse(JSON.parse(text));
      if (
        checksumOf(receipt) !== checksum ||
        receipt.operationId !== operation.id ||
        receipt.intentHash !== operation.args_hash
      )
        throw Error("Receipt binding mismatch");
      signal.throwIfAborted();
      const outcome = !receipt.result.launched
        ? "failed_known_no_effect"
        : receipt.result.reason === "exited" && receipt.result.exitCode === 0
          ? "succeeded"
          : "unknown";
      // Keep the exact journal; bound only the public reconciliation projection.
      while (Buffer.byteLength(JSON.stringify(receipt.result)) > 48000) {
        receipt.result.stdout = receipt.result.stdout.slice(
          0,
          Math.floor(receipt.result.stdout.length / 2),
        );
        receipt.result.stderr = receipt.result.stderr.slice(
          0,
          Math.floor(receipt.result.stderr.length / 2),
        );
        receipt.result.outputTruncated = true;
      }
      return {
        operationId: operation.id,
        intentHash: operation.args_hash,
        outcome,
        result: outcome === "succeeded" ? JSON.stringify(receipt.result) : null,
        evidenceRef: receipt.evidenceRef,
        observedAt: receipt.observedAt,
        details:
          "Observed durable process receipt. Process success does not independently verify every external effect.",
      };
    } catch (error) {
      signal.throwIfAborted();
      return unknown(
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "No durable native receipt is available; command was not replayed."
          : "Native receipt could not be verified; command was not replayed.",
      );
    }
  }
}
