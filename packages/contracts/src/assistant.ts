import { z } from "zod";
export const ROCKY_IDENTITY = {
  productId: "rocky",
  displayName: "Rocky",
  personaVersion: "1.0.0",
  avatarAssetId: "rocky-avatar-v1",
} as const;
export const assistantSchema = z
  .object({
    id: z.uuid(),
    productId: z.literal("rocky"),
    displayName: z.string().min(1).max(64),
    personaVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    avatarAssetId: z.literal("rocky-avatar-v1"),
  })
  .strict();
