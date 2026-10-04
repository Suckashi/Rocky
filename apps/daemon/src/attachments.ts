import { createHash, randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import {
  attachmentSchema,
  attachmentUploadSchema,
  attachmentRefsSchema,
  type Attachment,
  type AttachmentRef,
} from "../../../packages/contracts/src/attachments.js";
import {
  RockyError,
  type Work,
} from "../../../packages/contracts/src/index.js";
import type { Store } from "./store.js";
import { SteeringStore } from "./steering.js";
const sha = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
export class Attachments {
  private decoding = false;
  constructor(private readonly store: Store) {}
  get(id: string) {
    const row = this.store.db
      .prepare("SELECT data,bytes FROM attachments WHERE id=?")
      .get(id) as { data: string; bytes: Uint8Array } | undefined;
    if (!row)
      throw new RockyError(
        "attachment_missing",
        "Attachment is unavailable",
        404,
      );
    const metadata = attachmentSchema.parse(JSON.parse(row.data)),
      bytes = Buffer.from(row.bytes);
    if (sha(bytes) !== metadata.sha256 || bytes.length !== metadata.bytes)
      throw new RockyError(
        "attachment_integrity",
        "Attachment integrity check failed",
        409,
      );
    return { metadata, bytes };
  }
  validate(refs: AttachmentRef[]) {
    for (const ref of attachmentRefsSchema.parse(refs))
      if (this.get(ref.id).metadata.sha256 !== ref.sha256)
        throw new RockyError(
          "attachment_revision",
          "Attachment hash changed",
          409,
        );
  }
  bound(work: Work): Attachment[] {
    const refs = [
      ...(work.attachments ?? []),
      ...new SteeringStore(this.store)
        .list(work.id)
        .filter((item) => item.status === "applied")
        .flatMap((item) => item.attachments ?? []),
    ];
    return [
      ...new Map(
        refs.map((ref) => {
          const item = this.get(ref.id).metadata;
          if (item.sha256 !== ref.sha256)
            throw new RockyError(
              "attachment_integrity",
              "Bound attachment changed",
              409,
            );
          return [item.id, item] as const;
        }),
      ).values(),
    ];
  }
  read(work: Work, id?: string, vision = false) {
    const items = this.bound(work);
    if (!id) return { untrustedData: true, items };
    if (!items.some((item) => item.id === id))
      throw new RockyError(
        "attachment_scope",
        "Attachment is not bound to this Work",
        403,
      );
    const { metadata, bytes } = this.get(id);
    if (metadata.mimeType.startsWith("image/") && !vision)
      return {
        untrustedData: true,
        attachment: metadata,
        unavailable:
          "Selected model does not accept images; no visual interpretation was performed",
      };
    return {
      untrustedData: true,
      attachment: metadata,
      ...(metadata.mimeType.startsWith("image/")
        ? {
            image: `data:${metadata.mimeType};base64,${bytes.toString("base64")}`,
          }
        : { text: bytes.toString("utf8") }),
    };
  }
  async upload(input: unknown) {
    const command = attachmentUploadSchema.parse(input),
      original = Buffer.from(command.base64, "base64");
    if (
      original.toString("base64") !== command.base64 ||
      original.length > 2097152
    )
      throw new RockyError(
        "attachment_size",
        "Invalid base64 or attachment exceeds 2 MiB",
        413,
      );
    const intent = sha(
      JSON.stringify({
        name: command.name,
        mimeType: command.mimeType,
        sha256: sha(original),
      }),
    );
    const replay = () => {
      const row = this.store.db
        .prepare(
          "SELECT intent,attachment_id FROM attachment_receipts WHERE request_id=?",
        )
        .get(command.requestId) as
        { intent: string; attachment_id: string } | undefined;
      if (row && row.intent !== intent)
        throw new RockyError(
          "idempotency_conflict",
          "Attachment upload changed",
          409,
        );
      return row ? this.get(row.attachment_id).metadata : undefined;
    };
    const prior = replay();
    if (prior) return prior;
    let bytes = original,
      dimensions: { width: number; height: number } | undefined;
    if (command.mimeType.startsWith("image/")) {
      if (this.decoding)
        throw new RockyError(
          "attachment_busy",
          "Another attachment is being scanned",
          429,
        );
      this.decoding = true;
      try {
        const result = await new Promise<{
          bytes: Uint8Array;
          width: number;
          height: number;
        }>((resolve, reject) => {
          const worker = new Worker(
            new URL("./attachment-codec.mjs", import.meta.url),
            {
              workerData: { bytes, mimeType: command.mimeType },
              resourceLimits: {
                maxOldGenerationSizeMb: 192,
                maxYoungGenerationSizeMb: 16,
              },
            },
          );
          const timer = setTimeout(() => {
            void worker.terminate();
            reject(
              new RockyError(
                "attachment_timeout",
                "Image scan exceeded deadline",
                422,
              ),
            );
          }, 10000);
          worker.once("message", (value) => {
            clearTimeout(timer);
            void worker.terminate();
            if (value.error)
              reject(new RockyError("attachment_invalid", value.error, 422));
            else resolve(value);
          });
          worker.once("error", (error) => {
            clearTimeout(timer);
            reject(
              new RockyError(
                "attachment_invalid",
                error instanceof Error ? error.message : "Image worker failed",
                422,
              ),
            );
          });
          worker.once("exit", () => {
            clearTimeout(timer);
            reject(
              new RockyError(
                "attachment_invalid",
                "Image scanner terminated without a usable result",
                422,
              ),
            );
          });
        });
        bytes = Buffer.from(result.bytes);
        dimensions = { width: result.width, height: result.height };
      } finally {
        this.decoding = false;
      }
    } else {
      if (original.length > 65536)
        throw new RockyError(
          "attachment_size",
          "Text attachment exceeds 64 KiB",
          413,
        );
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(original);
      } catch {
        throw new RockyError(
          "attachment_encoding",
          "Text must be valid UTF-8",
          422,
        );
      }
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))
        throw new RockyError(
          "attachment_invalid",
          "Binary controls are not allowed in text",
          422,
        );
      bytes = Buffer.from(text);
    }
    const metadata = attachmentSchema.parse({
      id: randomUUID(),
      revision: 1,
      sha256: sha(bytes),
      name: command.name,
      mimeType: command.mimeType,
      bytes: bytes.length,
      createdAt: new Date().toISOString(),
      scan: "validated_reencoded",
      ...dimensions,
    });
    return this.store.transaction(() => {
      const previous = replay();
      if (previous) return previous;
      this.store.db
        .prepare("INSERT INTO attachments VALUES(?,?,?)")
        .run(metadata.id, JSON.stringify(metadata), bytes);
      this.store.db
        .prepare("INSERT INTO attachment_receipts VALUES(?,?,?)")
        .run(command.requestId, intent, metadata.id);
      return metadata;
    });
  }
}
