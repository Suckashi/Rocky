import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

export const RESULT_TRANSFER_LIMIT = 2 * 1024 * 1024;
export const resultPayloadSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("model_result"), message: z.unknown() }),
  z.strictObject({ kind: z.literal("tool_result"), result: z.unknown() }),
  z.strictObject({ kind: z.literal("run_result"), result: z.unknown() }),
]);
export const resultTransferSchemas = [
  z.strictObject({
    kind: z.literal("result_begin"),
    transferId: z.uuid(),
    resultKind: z.enum(["model_result", "tool_result", "run_result"]),
    bytes: z.number().int().min(1).max(RESULT_TRANSFER_LIMIT),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.strictObject({
    kind: z.literal("result_chunk"),
    transferId: z.uuid(),
    index: z.number().int().nonnegative(),
    data: z
      .string()
      .min(4)
      .max(32768)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  }),
  z.strictObject({ kind: z.literal("result_commit"), transferId: z.uuid() }),
] as const;
export type ResultPayload = z.infer<typeof resultPayloadSchema>;
export type ResultFrame = z.infer<(typeof resultTransferSchemas)[number]>;
export function frameResult(payload: ResultPayload): ResultFrame[] {
  const bytes = Buffer.from(JSON.stringify(resultPayloadSchema.parse(payload)));
  if (bytes.length > RESULT_TRANSFER_LIMIT)
    throw Error("Result exceeds transfer limit");
  const transferId = randomUUID(),
    frames: ResultFrame[] = [
      {
        kind: "result_begin",
        transferId,
        resultKind: payload.kind,
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
      kind: "result_chunk",
      transferId,
      index,
      data: bytes.subarray(offset, offset + 24576).toString("base64"),
    });
  frames.push({ kind: "result_commit", transferId });
  return frames;
}
/** One receiver per capability-owned channel. Never delivers a partial result. */
export class ResultTransferAssembler {
  private readonly transfers = new Map<
    string,
    {
      requestId: string;
      kind: ResultPayload["kind"];
      bytes: number;
      digest: string;
      size: number;
      index: number;
      chunks: Buffer[];
      touched: number;
    }
  >();
  has(requestId: string) {
    return [...this.transfers.values()].some(
      (transfer) => transfer.requestId === requestId,
    );
  }
  clear(requestId?: string) {
    if (requestId) {
      for (const [id, transfer] of this.transfers)
        if (transfer.requestId === requestId) this.transfers.delete(id);
    } else this.transfers.clear();
  }
  ingest(requestId: string, frame: ResultFrame): ResultPayload | undefined {
    const active = this.transfers.get(frame.transferId);
    if (active && Date.now() - active.touched > 30000) {
      this.transfers.delete(frame.transferId);
      throw Error("Result transfer expired");
    }
    if (frame.kind === "result_begin") {
      if (
        active ||
        [...this.transfers.values()].some((t) => t.requestId === requestId)
      )
        throw Error("Duplicate result transfer");
      for (const [id, t] of this.transfers)
        if (Date.now() - t.touched > 30000) this.transfers.delete(id);
      if (
        this.transfers.size >= 8 ||
        [...this.transfers.values()].reduce(
          (n, t) => n + t.bytes,
          frame.bytes,
        ) >
          8 * 1024 * 1024
      )
        throw Error("Result transfer capacity exceeded");
      this.transfers.set(frame.transferId, {
        requestId,
        kind: frame.resultKind,
        bytes: frame.bytes,
        digest: frame.digest,
        size: 0,
        index: 0,
        chunks: [],
        touched: Date.now(),
      });
      return;
    }
    if (!active || active.requestId !== requestId)
      throw Error("Result transfer ownership changed");
    if (frame.kind === "result_chunk") {
      const bytes = Buffer.from(frame.data, "base64");
      if (
        frame.index !== active.index ||
        bytes.toString("base64") !== frame.data ||
        active.size + bytes.length > active.bytes
      )
        throw Error("Invalid result chunk");
      active.chunks.push(bytes);
      active.size += bytes.length;
      active.index++;
      active.touched = Date.now();
      return;
    }
    this.transfers.delete(frame.transferId);
    const bytes = Buffer.concat(active.chunks);
    if (
      active.size !== active.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== active.digest
    )
      throw Error("Incomplete result transfer");
    const payload = resultPayloadSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    if (payload.kind !== active.kind) throw Error("Result kind changed");
    return payload;
  }
}
