import { z } from "zod";
export const attachmentRefSchema = z.strictObject({
  id: z.uuid(),
  revision: z.literal(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const attachmentRefsSchema = z
  .array(attachmentRefSchema)
  .max(8)
  .refine(
    (items) => new Set(items.map((item) => item.id)).size === items.length,
    "Duplicate attachment",
  );
export const attachmentUploadSchema = z.strictObject({
  requestId: z.uuid(),
  name: z
    .string()
    .trim()
    .min(1)
    .max(180)
    .refine((value) => !/[\\/\x00-\x1f]/.test(value)),
  mimeType: z.enum(["text/plain", "text/markdown", "image/png", "image/jpeg"]),
  base64: z.string().min(4).max(2796204),
});
export const attachmentSchema = attachmentRefSchema.extend({
  name: z.string(),
  mimeType: attachmentUploadSchema.shape.mimeType,
  bytes: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  scan: z.literal("validated_reencoded"),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});
export const attachmentReadSchema = z.strictObject({ id: z.uuid().optional() });
export type AttachmentRef = z.infer<typeof attachmentRefSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
