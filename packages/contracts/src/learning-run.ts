import { z } from "zod";
import { modelSelectionSchema } from "./index.js";
import { modelBudgetSchema } from "./model-budget.js";
import { reflectionBindingSchema } from "./reflection.js";
export const reflectionSubmissionSchema = z.strictObject({
  requestId: z.uuid(),
  binding: reflectionBindingSchema,
  modelSelection: modelSelectionSchema,
  modelBudget: modelBudgetSchema
    .refine(
      (value) => value.maxCalls <= 12,
      "Reflection is limited to twelve model calls",
    )
    .default({
      maxCalls: 12,
      maxTokens: null,
      maxMicroUsd: null,
      pricing: null,
    }),
});
