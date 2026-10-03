import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

export const MODEL_TRANSFER_LIMIT = 2 * 1024 * 1024;
export const modelRequestSchema = z.strictObject({
  kind: z.literal("model_request"),
  child: z.boolean(),
  purpose: z.literal("summary").optional(),
  messages: z.array(z.unknown()).max(4096),
  tools: z.array(z.unknown()).max(100).optional(),
});
export const modelTransferSchemas = [
  z.strictObject({
    kind: z.literal("model_begin"),
    transferId: z.uuid(),
    bytes: z.number().int().min(1).max(MODEL_TRANSFER_LIMIT),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.strictObject({
    kind: z.literal("model_chunk"),
    transferId: z.uuid(),
    index: z.number().int().nonnegative(),
    data: z
      .string()
      .min(4)
      .max(32768)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  }),
  z.strictObject({ kind: z.literal("model_commit"), transferId: z.uuid() }),
] as const;
export type ModelTransfer = z.infer<(typeof modelTransferSchemas)[number]>;
export type ModelRequest = z.infer<typeof modelRequestSchema>;

/** Private transport framing; does not split provider calls or create model slots. */
export function frameModelRequest(value: ModelRequest): ModelTransfer[] {
  const bytes = Buffer.from(JSON.stringify(modelRequestSchema.parse(value)));
  if (bytes.length > MODEL_TRANSFER_LIMIT)
    throw Error("Model request exceeds transfer limit");
  const transferId = randomUUID();
  const frames: ModelTransfer[] = [
    {
      kind: "model_begin",
      transferId,
      bytes: bytes.length,
      digest: createHash("sha256").update(bytes).digest("hex"),
    },
  ];
  for (
    let offset = 0, index = 0;
    offset < bytes.length;
    offset += 24576, index++
  )
    frames.push({
      kind: "model_chunk",
      transferId,
      index,
      data: bytes.subarray(offset, offset + 24576).toString("base64"),
    });
  frames.push({ kind: "model_commit", transferId });
  return frames;
}

/** One channel owns one assembler; capability/sequence checks happen before ingestion. */
export class ModelTransferAssembler {
  private readonly uploads = new Map<
    string,
    {
      id: string;
      expected: number;
      digest: string;
      size: number;
      index: number;
      chunks: Buffer[];
      touched: number;
    }
  >();
  clear(id?: string) {
    if (id) this.uploads.delete(id);
    else this.uploads.clear();
  }
  ingest(frame: ModelTransfer): ModelRequest | undefined {
    const active = this.uploads.get(frame.transferId);
    if (active && Date.now() - active.touched > 30000) {
      this.uploads.delete(frame.transferId);
      throw Error("Model transfer expired");
    }
    if (frame.kind === "model_begin") {
      if (active) throw Error("Model transfer already active");
      for (const [id, upload] of this.uploads)
        if (Date.now() - upload.touched > 30000) this.uploads.delete(id);
      if (
        this.uploads.size >= 8 ||
        [...this.uploads.values()].reduce(
          (total, upload) => total + upload.expected,
          frame.bytes,
        ) >
          8 * 1024 * 1024
      )
        throw Error("Model transfer capacity exceeded");
      this.uploads.set(frame.transferId, {
        id: frame.transferId,
        expected: frame.bytes,
        digest: frame.digest,
        size: 0,
        index: 0,
        chunks: [],
        touched: Date.now(),
      });
      return;
    }
    if (!active || active.id !== frame.transferId)
      throw Error("Model transfer ownership changed");
    if (frame.kind === "model_chunk") {
      const bytes = Buffer.from(frame.data, "base64");
      if (
        frame.index !== active.index ||
        bytes.toString("base64") !== frame.data ||
        active.size + bytes.length > active.expected
      )
        throw Error("Invalid model transfer chunk");
      active.chunks.push(bytes);
      active.size += bytes.length;
      active.index++;
      active.touched = Date.now();
      return;
    }
    this.uploads.delete(frame.transferId);
    const bytes = Buffer.concat(active.chunks);
    if (
      active.size !== active.expected ||
      createHash("sha256").update(bytes).digest("hex") !== active.digest
    )
      throw Error("Incomplete model transfer");
    return modelRequestSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
  }
}
