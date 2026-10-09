// delegate_to_opencode: hands a coding task to OpenCode in a worktree. Starting it is an
// outside action (the gate asks); OpenCode's own actions are approved one by one, and
// Rocky verifies the result. Nothing reaches the project until the user applies the job.
import { tool } from 'langchain';
import { z } from 'zod';
import { JobError, type JobRunner } from '../jobs/runner.ts';
import type { JobStore } from '../jobs/store.ts';
import type { ToolRegistry } from './registry.ts';

const ERRORS: Record<string, string> = {
  'no-project': 'No project folder is selected.',
  'not-a-git-repo':
    'The project folder is not a git repository; OpenCode jobs need one (they work in a git worktree). Tell the user.',
  'opencode-not-found':
    'OpenCode is not installed on this computer (npm i -g opencode-ai). Tell the user; do the task yourself only if they ask.',
  'model-not-configured': 'No model is configured.',
};

/** Starting a job is an outside action; looking jobs up reads Rocky's own data. */
export function addJobTools(
  tools: ToolRegistry,
  runner: JobRunner,
  jobs: JobStore,
  context: { threadId: string; runId: string },
): void {
  tools
    .add(createDelegateTool(runner, context), (args) => ({
      effect: {
        kind: 'delegate',
        agent: 'opencode',
        title: String(args['title'] ?? ''),
        task: String(args['task'] ?? ''),
      },
    }))
    .add(createCheckJobsTool(jobs, runner, context.threadId), () => ({
      none: true,
    }));
}

function createDelegateTool(
  runner: JobRunner,
  context: { threadId: string; runId: string },
) {
  return tool(
    async (input, config) => {
      const toolCallId = (config as { toolCall?: { id?: string } } | undefined)
        ?.toolCall?.id;
      try {
        const job = await runner.enqueue({
          threadId: context.threadId,
          runId: context.runId,
          ...(toolCallId ? { toolCallId } : {}),
          title: input.title,
          task: input.task,
        });
        const position = runner.position(job.id) ?? 0;
        return [
          `Job ${job.id} (${job.title}) ${position > 0 ? `is queued (position ${position})` : 'has started'} and runs in the background.`,
          'The user approves its actions and reviews the result on the Jobs page; you will not see the result in this turn.',
          'Tell the user it is running in the background and that they can keep chatting. Do not wait for it, claim a result, or promise to report back on your own:',
          'the result appears on the Jobs page, and you can look it up with check_jobs when the user asks.',
        ].join('\n');
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
        'The job runs in the background in a separate git worktree (one job at a time; others wait in a queue). The user approves its actions on the Jobs page; ' +
        'Rocky then checks the diff and runs the tests. Nothing is applied to the project until the user applies it on the Jobs page.',
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

/** check_jobs: the jobs started from this conversation, as Rocky sees them (read-only). */
export function createCheckJobsTool(
  jobs: JobStore,
  runner: JobRunner,
  threadId: string,
) {
  return tool(
    async () => {
      const mine = jobs
        .list()
        .filter((j) => j.threadId === threadId)
        .slice(0, 10);
      if (mine.length === 0)
        return 'No jobs were started from this conversation.';
      return mine
        .map((job) => {
          const r = job.result;
          const lines = [`Job ${job.id} (${job.title}): ${job.status}`];
          const position = runner.position(job.id);
          if (job.status === 'queued' && position)
            lines.push(`  queue position ${position}`);
          if (r) {
            lines.push(
              `  changed: ${r.changed.join(', ') || 'nothing'}`,
              ...(r.unapproved.length
                ? [`  changed WITHOUT approval: ${r.unapproved.join(', ')}`]
                : []),
              ...(r.mismatched.length
                ? [
                    `  differs from what was approved: ${r.mismatched.join(', ')}`,
                  ]
                : []),
              ...r.checks.map(
                (c) =>
                  `  Rocky ran ${c.argv.join(' ')}: exit ${c.exitCode ?? 'none'}`,
              ),
              ...(r.error ? [`  error: ${r.error.slice(0, 300)}`] : []),
            );
          }
          return lines.join('\n');
        })
        .join('\n');
    },
    {
      name: 'check_jobs',
      description:
        "Look up the OpenCode jobs started from this conversation: status (queued, running, verified, problems, ...), changed files and Rocky's test results. Read-only.",
      schema: z.object({}),
    },
  );
}
