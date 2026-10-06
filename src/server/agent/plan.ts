// propose_plan: for larger tasks Rocky offers 1–3 ways to do it before starting. The user
// picks one (its listed commands become approved, exactly as written), asks for changes,
// or rejects. The gate middleware handles the call; the tool body never runs.
import { tool } from 'langchain';
import { z } from 'zod';
import { splitPosix } from '../effects/commands.ts';
import type { Effect, PlanOption } from '../effects/types.ts';
import type { ToolEffect } from './workspace.ts';

/** A command as argv, or as a command line Rocky splits (one plain command only). */
const command = z.union([
  z.array(z.string().max(1000)).min(1).max(50),
  z.string().min(1).max(2000),
]);

const option = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().max(2000).default(''),
  steps: z.array(z.string().max(500)).max(20).default([]),
  commands: z
    .array(command)
    .max(20)
    .default([])
    .describe(
      'Commands this option runs in the project root, e.g. [["npm","test"]]',
    ),
});

/** Command lines become argv; anything with operators or that cannot be parsed is dropped. */
function toArgv(c: string[] | string): string[] | undefined {
  if (Array.isArray(c)) return c;
  // On Windows a backslash in a command line is a path separator.
  const parsed = splitPosix(c.trim(), {
    literalBackslash: process.platform === 'win32',
  });
  return parsed?.length === 1 && parsed[0]!.length ? parsed[0] : undefined;
}

export const planSchema = z.object({
  title: z.string().min(1).max(200),
  options: z.array(option).min(1).max(3),
});

export function planEffect(args: Record<string, unknown>): ToolEffect {
  const parsed = planSchema.safeParse(args);
  if (!parsed.success)
    return {
      error: `Error: invalid plan (${parsed.error.issues.map((i) => i.message).join('; ')}). Give 1 to 3 options, each with a title, summary, steps and commands as argv arrays.`,
    };
  const options: PlanOption[] = parsed.data.options.map((o) => ({
    title: o.title,
    summary: o.summary,
    steps: o.steps,
    commands: o.commands.flatMap((c) => {
      const argv = toArgv(c);
      return argv ? [argv] : [];
    }),
  }));
  const effect: Effect = { kind: 'plan', title: parsed.data.title, options };
  return { effect };
}

export function chosenPlanMessage(option: PlanOption, index: number): string {
  return [
    `The user chose option ${index + 1}: ${option.title}.`,
    option.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
    option.commands.length
      ? `These commands are approved for this conversation exactly as listed (run them with run_command in the project root): ${option.commands.map((c) => JSON.stringify(c)).join(', ')}. Anything else still goes through approval.`
      : 'No commands were pre-approved; other actions still go through approval.',
    'Carry out this option now.',
  ].join('\n');
}

export function createPlanTool() {
  return tool(async () => 'Error: plans are handled by Rocky.', {
    name: 'propose_plan',
    description:
      'Before a larger or ambiguous task (several files, several steps, or more than one reasonable approach), propose 1 to 3 options and wait for the user to choose. ' +
      'Do not use it for small, clear tasks such as a one-line fix or answering a question. ' +
      'List in each option the commands it will run (argv arrays); choosing the option approves exactly those.',
    schema: planSchema,
  });
}
