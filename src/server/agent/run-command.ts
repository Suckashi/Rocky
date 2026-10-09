// run_command: Rocky's only way to run a program. argv, never a shell string; the gate
// middleware has already decided and left a pass for exactly this argv and cwd.
import { tool } from 'langchain';
import { z } from 'zod';
import type { Executor } from '../effects/execute.ts';
import { currentPass } from './backend.ts';
import type { ToolRegistry } from './registry.ts';
import { toolEffect } from './workspace.ts';

export function addRunCommandTool(
  tools: ToolRegistry,
  root: string,
  executor: Executor,
): void {
  tools.add(createRunCommandTool(root, executor), (args) =>
    toolEffect('run_command', args, root),
  );
}

function createRunCommandTool(root: string, executor: Executor) {
  return tool(
    async (input, config) => {
      const pass = currentPass.getStore();
      if (!pass) return 'Error: no approval for this command.';
      const mapped = toolEffect('run_command', input, root);
      if (!('effect' in mapped) || mapped.effect.kind !== 'command') {
        return 'error' in mapped ? mapped.error : 'Error: invalid command.';
      }
      const result = await executor.run(pass, mapped.effect, {
        timeoutMs: Math.min(input.timeout_seconds ?? 120, 600) * 1000,
        ...((config as { signal?: AbortSignal } | undefined)?.signal
          ? { signal: (config as { signal: AbortSignal }).signal }
          : {}),
      });
      const status = result.timedOut
        ? 'timed out and was stopped'
        : result.stopped
          ? 'was stopped'
          : `exited with code ${result.exitCode}`;
      return `The command ${status}.${result.truncated ? ' (output truncated to the last 64 KB)' : ''}\n${result.output}`;
    },
    {
      name: 'run_command',
      description:
        'Run one program in the project folder and return its exit code and output. Give the program and each argument ' +
        'as separate argv items (for example ["npm", "test"]); there is no shell, so pipes, redirects and && do not work. ' +
        'cwd is a project path like "/" or "/packages/app".',
      schema: z.object({
        argv: z
          .array(z.string())
          .min(1)
          .describe('Program and arguments, e.g. ["git", "status"]'),
        cwd: z
          .string()
          .optional()
          .describe('Project path to run in; default "/"'),
        timeout_seconds: z.number().int().positive().max(600).optional(),
      }),
    },
  );
}
