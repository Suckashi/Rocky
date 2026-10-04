import { z } from "zod";
import { modelSelectionSchema } from "./index.js";
import { modelBudgetSchema } from "./model-budget.js";
import { reflectionBindingSchema } from "./reflection.js";
export const reflectionSubmissionSchema = z.strictObject({
  requestId: z.uuid(),
  binding: reflectionBindingSchema,
  modelSelection: modelSelectionSchema,
  modelBudget: modelBudgetSchema.default({
    maxCalls: 12,
    maxTokens: null,
    maxMicroUsd: null,
    pricing: null,
  }),
});
