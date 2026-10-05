// delegate_to_opencode: hands a coding task to OpenCode in a worktree. Starting it is an
// outside action (the gate asks); OpenCode's own actions are approved one by one, and
// Rocky verifies the result. Nothing reaches the project until the user applies the job.
import { tool } from 'langchain';
import { z } from 'zod';
import { JobError, type JobRunner } from '../jobs/runner.ts';
import type { Job } from '../jobs/store.ts';

const ERRORS: Record<string, string> = {
  'no-project': 'No project folder is selected.',
  'not-a-git-repo':
    'The project folder is not a git repository; OpenCode jobs need one (they work in a git worktree). Tell the user.',
  'opencode-not-found':
    'OpenCode is not installed on this computer (npm i -g opencode-ai). Tell the user; do the task yourself only if they ask.',
  'model-not-configured': 'No model is configured.',
};

export function jobReport(job: Job): string {
  const r = job.result;
  const lines = [
    `Job ${job.id} (${job.title}) finished with status "${job.status}".`,
  ];
  if (!r) return lines.join('\n');
  if (r.error) lines.push(`Error: ${r.error}`);
  if (r.summary) lines.push(`OpenCode's summary: ${r.summary}`);
  lines.push(
    r.changed.length
      ? `Changed files (in the job's worktree): ${r.changed.join(', ')}`
      : 'No files were changed.',
  );
  if (r.unapproved.length)
    lines.push(`Changed WITHOUT approval: ${r.unapproved.join(', ')}`);
  if (r.mismatched.length)
    lines.push(
      `Content differs from what was approved: ${r.mismatched.join(', ')}`,
    );
  for (const check of r.checks) {
    lines.push(
      `Rocky ran ${check.argv.join(' ')}: exit ${check.exitCode ?? 'none'}\n${check.output.slice(-1500)}`,
    );
  }
  if (r.warnings.includes('uncommitted-changes'))
    lines.push(
      'Note: the project had uncommitted changes; the worktree started from the last commit and does not include them.',
    );
  lines.push(
    'Nothing has been applied to the project yet. The user reviews the diff on the job page and applies or discards it. Report the result honestly, including any problems.',
  );
  return lines.join('\n');
}

export function createDelegateTool(
  runner: JobRunner,
  context: { threadId: string; runId: string; signal: AbortSignal },
) {
  return tool(
    async (input, config) => {
      const toolCallId = (config as { toolCall?: { id?: string } } | undefined)
        ?.toolCall?.id;
      try {
        const job = await runner.run(
          {
            threadId: context.threadId,
            runId: context.runId,
            ...(toolCallId ? { toolCallId } : {}),
            title: input.title,
            task: input.task,
          },
          context.signal,
        );
        return jobReport(job);
      } catch (error) {
        if (error instanceof JobError)
          return `Error: ${ERRORS[error.message] ?? error.message}`;
        throw error;
      }
    },
    {
      name: 'delegate_to_opencode',
      description:
        'Hand a coding task to OpenCode, an external coding agent, ONLY when the user explicitly asks for OpenCode (or to delegate). ' +
        'It works in a separate git worktree; the user approves its actions; Rocky then checks the diff and runs the tests. ' +
        'The result is not applied to the project until the user applies it on the job page.',
      schema: z.object({
        title: z.string().min(1).max(120).describe('Short name for the job'),
        task: z
          .string()
          .min(1)
          .max(8000)
          .describe(
            'Complete instructions for OpenCode, with the files and the expected result',
          ),
      }),
    },
  );
}
