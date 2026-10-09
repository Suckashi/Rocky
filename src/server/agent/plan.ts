// propose_plan ends plan mode (ADR 0019): while plan mode is on Rocky only reads, then
// offers 1–3 ways to do the task. The user picks one (plan mode turns off and the work
// starts), asks for changes, or rejects. The gate middleware handles the call; the tool
// body never runs. Outside plan mode the tool is not offered.
import { tool } from 'langchain';
import { z } from 'zod';
import type { Effect, PlanOption } from '../effects/types.ts';
import type { ToolEffect } from './workspace.ts';

const option = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().max(2000).default(''),
  steps: z.array(z.string().max(500)).max(20).default([]),
});

export const planSchema = z.object({
  title: z.string().min(1).max(200),
  options: z.array(option).min(1).max(3),
});

export function planEffect(args: Record<string, unknown>): ToolEffect {
  const parsed = planSchema.safeParse(args);
  if (!parsed.success)
    return {
      error: `Error: invalid plan (${parsed.error.issues.map((i) => i.message).join('; ')}). Give 1 to 3 options, each with a title, summary and steps.`,
    };
  const options: PlanOption[] = parsed.data.options.map((o) => ({
    title: o.title,
    summary: o.summary,
    steps: o.steps,
  }));
  const effect: Effect = { kind: 'plan', title: parsed.data.title, options };
  return { effect };
}

export function chosenPlanMessage(option: PlanOption, index: number): string {
  return [
    `The user chose option ${index + 1}: ${option.title}.`,
    option.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
    'Plan mode is now off. Carry out this option now; actions still follow the approval mode.',
  ].join('\n');
}

/** Added to the system prompt while plan mode is on. */
export const PLAN_MODE_PROMPT =
  'Plan mode is on: the user wants a plan before any change. Only read and search (files, documents, memory, read-only tools); writing files, running commands and other changes are refused. ' +
  'When you understand the task, call propose_plan with 1 to 3 options (title, summary, steps) and wait. ' +
  'If the user asks for changes, revise and call propose_plan again. Answer plain questions without a plan.';

export function createPlanTool() {
  return tool(async () => 'Error: plans are handled by Rocky.', {
    name: 'propose_plan',
    description:
      'Plan mode only: present 1 to 3 ways to do the task and wait for the user to choose one. Choosing an option ends plan mode so you can start the work.',
    schema: planSchema,
  });
}
