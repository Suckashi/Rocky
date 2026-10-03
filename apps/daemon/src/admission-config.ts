import { z } from "zod";

export const admissionConfigSchema = z.strictObject({
  mainSlots: z.literal(1).default(1),
  backgroundSlots: z.number().int().min(1).max(8).default(2),
  evaluationSlots: z.number().int().min(1).max(2).default(1),
  modelSlots: z.number().int().min(1).max(16).default(2),
  maxQueued: z.number().int().min(1).max(256).default(64),
  mainWallBudgetMs: z.number().int().min(100).max(14400000).default(1200000),
  backgroundWallBudgetMs: z
    .number()
    .int()
    .min(100)
    .max(14400000)
    .default(3600000),
  evaluationWallBudgetMs: z
    .number()
    .int()
    .min(100)
    .max(14400000)
    .default(1200000),
});

export function admissionConfigFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const fields = {
    mainSlots: "ROCKY_MAIN_SLOTS",
    backgroundSlots: "ROCKY_BACKGROUND_SLOTS",
    evaluationSlots: "ROCKY_EVALUATION_SLOTS",
    modelSlots: "ROCKY_MODEL_SLOTS",
    maxQueued: "ROCKY_MAX_QUEUED",
    mainWallBudgetMs: "ROCKY_MAIN_WALL_BUDGET_MS",
    backgroundWallBudgetMs: "ROCKY_BACKGROUND_WALL_BUDGET_MS",
    evaluationWallBudgetMs: "ROCKY_EVALUATION_WALL_BUDGET_MS",
  } as const;
  const input: Record<string, number> = {};
  for (const [field, key] of Object.entries(fields)) {
    const raw = env[key];
    if (raw === undefined) continue;
    if (!/^[1-9][0-9]*$/.test(raw)) throw Error(`Invalid ${key}`);
    input[field] = Number(raw);
  }
  return admissionConfigSchema.parse(input);
}
