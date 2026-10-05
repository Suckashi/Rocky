// Jobs API: list, detail (timeline, receipts, diff), apply to the project, discard.
import { realpathSync } from 'node:fs';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Executor } from '../../effects/execute.ts';
import type { Gate } from '../../effects/gate.ts';
import type { ReceiptStore } from '../../effects/receipts.ts';
import { git } from '../../external/worktree.ts';
import { applyJob, applyPlan, discardWorkspace } from '../../jobs/apply.ts';
import type { JobRunner } from '../../jobs/runner.ts';
import type { Job, JobStore } from '../../jobs/store.ts';
import type { SettingsStore } from '../../store/settings.ts';

const real = (p: string) => {
  try {
    return realpathSync.native(p);
  } catch {
    return p;
  }
};

/** The job's worktree must belong to the current project folder. */
async function projectFor(
  job: Job,
  settings: SettingsStore,
): Promise<string | undefined> {
  const project = settings.project();
  if (!project || !job.worktree) return undefined;
  try {
    const list = await git(project, 'worktree', 'list', '--porcelain');
    const trees = list
      .split('\n')
      .filter((l) => l.startsWith('worktree '))
      .map((l) => real(l.slice(9)).toLowerCase());
    return trees.includes(real(job.worktree).toLowerCase())
      ? project
      : undefined;
  } catch {
    return undefined;
  }
}

export function jobRoutes(deps: {
  jobs: JobStore;
  runner: JobRunner;
  gate: Gate;
  executor: Executor;
  receipts: ReceiptStore;
  settings: SettingsStore;
}): Hono {
  const { jobs, runner, gate, executor, receipts, settings } = deps;
  const app = new Hono();

  app.get('/jobs', (c) =>
    c.json({ available: runner.available(), jobs: jobs.list() }),
  );

  app.get('/jobs/:id', (c) => {
    const job = jobs.get(c.req.param('id'));
    if (!job) return c.json({ error: 'not-found' }, 404);
    const events = jobs.events(job.id);
    const ids = new Set(
      events.flatMap((e) =>
        e.type === 'permission' && e.receiptId ? [e.receiptId] : [],
      ),
    );
    return c.json({
      job,
      events,
      receipts: receipts.forThread(job.threadId).filter((r) => ids.has(r.id)),
    });
  });

  app.get('/jobs/:id/apply', async (c) => {
    const job = jobs.get(c.req.param('id'));
    if (!job) return c.json({ error: 'not-found' }, 404);
    const project = await projectFor(job, settings);
    if (!project) return c.json({ error: 'project-changed' }, 409);
    const plan = await applyPlan(job, project);
    return c.json({
      items: plan.map(({ effect, ...item }) => ({
        ...item,
        operation: effect.operation,
      })),
    });
  });

  app.post('/jobs/:id/apply', async (c) => {
    const parsed = z
      .object({
        items: z
          .array(
            z.object({ path: z.string(), contentHash: z.string() }).strict(),
          )
          .max(1000),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid-apply' }, 400);
    const job = jobs.get(c.req.param('id'));
    if (!job) return c.json({ error: 'not-found' }, 404);
    const project = await projectFor(job, settings);
    if (!project) return c.json({ error: 'project-changed' }, 409);
    try {
      const result = await applyJob(
        { gate, executor, jobs },
        job,
        project,
        parsed.data.items,
      );
      return result.ok ? c.json(result) : c.json(result, 409);
    } catch (error) {
      return c.json(
        { ok: false, error: error instanceof Error ? error.message : 'failed' },
        500,
      );
    }
  });

  app.post('/jobs/:id/discard', async (c) => {
    const job = jobs.get(c.req.param('id'));
    if (!job) return c.json({ error: 'not-found' }, 404);
    if (job.status === 'running' || job.status === 'applied')
      return c.json({ error: 'not-discardable' }, 409);
    const project = await projectFor(job, settings);
    if (project) await discardWorkspace(job, project);
    jobs.setStatus(job.id, 'discarded');
    return c.json({ ok: true });
  });

  return app;
}
