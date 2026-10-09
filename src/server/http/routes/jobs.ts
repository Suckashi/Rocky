// Jobs API: list, detail (timeline, receipts, diff), apply to the project, discard.
import { realpathSync } from 'node:fs';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Executor } from '../../effects/execute.ts';
import type { Gate } from '../../effects/gate.ts';
import type { ReceiptStore } from '../../effects/receipts.ts';
import { git } from '../../external/worktree.ts';
import { applyJob, applyPlan, discardWorkspace } from '../../jobs/apply.ts';
import { jobThread, type JobRunner } from '../../jobs/runner.ts';
import type { Job, JobStore } from '../../jobs/store.ts';
import type { SettingsStore } from '../../store/settings.ts';
import { readBody } from '../body.ts';

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

/** A job that stopped running: its result is final. */
const DONE = new Set<Job['status']>([
  'verified',
  'problems',
  'failed',
  'stopped',
  'interrupted',
]);

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
    c.json({
      available: runner.available(),
      jobs: jobs.list().map((job) => ({
        ...job,
        position: runner.position(job.id) ?? null,
        waiting: gate.pending(jobThread(job.id)).length,
      })),
    }),
  );

  // For the rail badge and notifications: what is running, what waits for the user, and
  // what finished lately (the page notifies once per job it saw finish).
  app.get('/jobs/summary', (c) => {
    const all = jobs.list();
    const active = all.filter(
      (j) => j.status === 'queued' || j.status === 'running',
    );
    const since = Date.now() - 24 * 60 * 60 * 1000;
    return c.json({
      running: active.filter((j) => j.status === 'running').length,
      queued: active.filter((j) => j.status === 'queued').length,
      waiting: active.reduce(
        (n, j) => n + gate.pending(jobThread(j.id)).length,
        0,
      ),
      finished: all
        .filter((j) => DONE.has(j.status) && (j.finishedAt ?? 0) >= since)
        .map((j) => ({ id: j.id, title: j.title, status: j.status })),
    });
  });

  // The jobs a conversation started, for the cards in that conversation. Applied and
  // discarded jobs are settled and left out.
  app.get('/threads/:id/jobs', (c) =>
    c.json({
      jobs: jobs
        .forThread(c.req.param('id'))
        .filter((j) => j.status !== 'applied' && j.status !== 'discarded')
        .map((j) => {
          const checks = j.result?.checks ?? [];
          return {
            id: j.id,
            title: j.title,
            status: j.status,
            position: runner.position(j.id) ?? null,
            waiting: gate.pending(jobThread(j.id)).length,
            changed: j.result?.changed.length ?? 0,
            checksPassed: checks.length
              ? checks.every((ch) => ch.exitCode === 0)
              : null,
            finishedAt: j.finishedAt,
          };
        }),
    }),
  );

  app.post('/jobs/:id/cancel', (c) =>
    runner.cancel(c.req.param('id'))
      ? c.json({ ok: true })
      : c.json({ error: 'not-running' }, 409),
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
    const thread = jobThread(job.id);
    return c.json({
      job,
      events,
      position: runner.position(job.id) ?? null,
      pending: gate.pending(thread),
      receipts: receipts.forThread(thread).filter((r) => ids.has(r.id)),
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
    const body = await readBody(
      c,
      z
        .object({
          items: z
            .array(
              z.object({ path: z.string(), contentHash: z.string() }).strict(),
            )
            .max(1000),
        })
        .strict(),
    );
    if (!body) return c.json({ error: 'invalid-apply' }, 400);
    const job = jobs.get(c.req.param('id'));
    if (!job) return c.json({ error: 'not-found' }, 404);
    const project = await projectFor(job, settings);
    if (!project) return c.json({ error: 'project-changed' }, 409);
    try {
      const result = await applyJob(
        { gate, executor, jobs },
        job,
        project,
        body.items,
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
    if (
      job.status === 'queued' ||
      job.status === 'running' ||
      job.status === 'applied'
    )
      return c.json({ error: 'not-discardable' }, 409);
    const project = await projectFor(job, settings);
    if (project) await discardWorkspace(job, project);
    jobs.setStatus(job.id, 'discarded');
    return c.json({ ok: true });
  });

  return app;
}
