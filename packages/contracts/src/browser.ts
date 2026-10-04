import { z } from "zod";
const originSchema = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.origin === value
    );
  }, "Supply an exact http(s) origin without path or credentials");
export const browserOriginsSchema = z.array(originSchema).min(1).max(20);
export const browserProfileSchema = z.strictObject({
  id: z.uuid(),
  environmentId: z.uuid(),
  workId: z.uuid(),
  revision: z.number().int().positive(),
  mode: z.enum(["native", "isolated"]),
  sharingPolicy: z.enum(["exclusive", "shared"]),
  authorizedWorkIds: z.array(z.uuid()).max(100).default([]),
  accountLabel: z.string().trim().min(1).max(120).nullable().default(null),
  allowedOrigins: browserOriginsSchema,
  state: z.enum([
    "closed",
    "starting",
    "ready",
    "taking_over",
    "owner",
    "unavailable",
    "unknown",
  ]),
  freshSnapshotRequired: z.boolean(),
  networkEnforcement: z.literal("application_only"),
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const browserControlSchema = z.strictObject({
  requestId: z.uuid(),
  profileRevision: z.number().int().positive(),
  action: z.enum(["open", "close", "take", "release"]),
});
export const browserSnapshotSchema = z.strictObject({
  snapshotId: z.uuid(),
  profileId: z.uuid(),
  environmentId: z.uuid(),
  pageId: z.uuid(),
  url: z.string().max(8192),
  navigationRevision: z.number().int().positive(),
  capturedAt: z.iso.datetime(),
  text: z.string().max(65536),
  imageSha256: z.string().regex(/^[a-f0-9]{64}$/),
  stale: z.boolean(),
});
export const browserNavigateSchema = z.strictObject({
  url: z.string().url().max(8192),
});
export const browserActionSchema = z.strictObject({
  snapshotId: z.uuid(),
  pageId: z.uuid(),
  navigationRevision: z.number().int().positive(),
  action: z.enum(["click", "fill", "press"]),
  role: z.enum([
    "button",
    "link",
    "textbox",
    "checkbox",
    "radio",
    "combobox",
    "option",
    "tab",
    "menuitem",
  ]),
  name: z.string().min(1).max(500),
  value: z.string().max(8192).optional(),
});
export type BrowserProfile = z.infer<typeof browserProfileSchema>;
export type BrowserSnapshot = z.infer<typeof browserSnapshotSchema>;
export const browserSharingSchema = z.discriminatedUnion("action", [
  z.strictObject({
    requestId: z.uuid(),
    profileRevision: z.number().int().positive(),
    action: z.literal("share").default("share"),
    accountLabel: z.string().trim().min(1).max(120),
  }),
  z.strictObject({
    requestId: z.uuid(),
    profileRevision: z.number().int().positive(),
    action: z.literal("revoke"),
  }),
]);
