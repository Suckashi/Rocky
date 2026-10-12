// Jobs API: list, detail (timeline, receipts, diff), apply to the project, discard.
import { existsSync } from 'node:fs';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Executor } from '../../effects/execute.ts';
import type { Gate } from '../../effects/gate.ts';
import type { ReceiptStore } from '../../effects/receipts.ts';
import { listsWorktree, repoRoot, samePath } from '../../external/worktree.ts';
import { applyJob, applyPlan, discardWorkspace } from '../../jobs/apply.ts';
import { jobThread, type JobRunner } from '../../jobs/runner.ts';
import type { Job, JobStore } from '../../jobs/store.ts';
import type { SettingsStore } from '../../store/settings.ts';
import { readBody } from '../body.ts';

/** Jobs from before ADR 0031 did not record their repository: the job's worktree must
 * belong to the current project's repository, and its paths are relative to that
 * repository's top folder (the project may be a subfolder of it). */
async function projectFor(
  job: Job,
  settings: SettingsStore,
): Promise<string | undefined> {
  const project = settings.project();
  if (!project || !job.worktree) return undefined;
  const top = await repoRoot(project).catch(() => undefined);
  return top && (await listsWorktree(top, job.worktree)) ? top : undefined;
}

/** The repository a job's work goes back to. A job records it (ADR 0031); its changes are
 * applied only while the current project is in that repository. */
async function applyTarget(
  job: Job,
  settings: SettingsStore,
): Promise<string | undefined> {
  if (!job.repo) return projectFor(job, settings);
  const project = settings.project();
  if (!project) return undefined;
  const top = await repoRoot(project).catch(() => undefined);
  return top && samePath(top, job.repo) ? job.repo : undefined;
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
  // Apply and discard of one job never run at the same time (a discard could remove the
  // worktree while an apply is still copying from it).
  const busy = new Set<string>();
  const exclusive = async (id: string, fn: () => Promise<Response>) => {
    if (busy.has(id)) return Response.json({ error: 'busy' }, { status: 409 });
    busy.add(id);
    try {
      return await fn();
    } finally {
      busy.delete(id);
    }
  };

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
      // An applied job whose worktree could not be removed: it can still be cleaned up.
      leftover:
        job.status === 'applied' &&
        job.worktree !== null &&
        existsSync(job.worktree),
      receipts: receipts.forThread(thread).filter((r) => ids.has(r.id)),
    });
  });

  app.get('/jobs/:id/apply', async (c) => {
    const job = jobs.get(c.req.param('id'));
    if (!job) return c.json({ error: 'not-found' }, 404);
    const repo = await applyTarget(job, settings);
    if (!repo) return c.json({ error: 'project-changed' }, 409);
    const plan = await applyPlan(job, repo);
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
    const repo = await applyTarget(job, settings);
    if (!repo) return c.json({ error: 'project-changed' }, 409);
    return exclusive(job.id, async () => {
      try {
        const result = await applyJob(
          { gate, executor, jobs },
          jobs.get(job.id)!,
          repo,
          body.items,
        );
        return result.ok ? c.json(result) : c.json(result, 409);
      } catch (error) {
        return c.json(
          {
            ok: false,
            error: error instanceof Error ? error.message : 'failed',
          },
          500,
        );
      }
    });
  });

  // Discards a finished job's work; for an applied job, removes the worktree its apply
  // could not (the job stays applied).
  app.post('/jobs/:id/discard', async (c) => {
    const id = c.req.param('id');
    if (!jobs.get(id)) return c.json({ error: 'not-found' }, 404);
    return exclusive(id, async () => {
      const job = jobs.get(id)!;
      const leftover =
        job.status === 'applied' &&
        job.worktree !== null &&
        existsSync(job.worktree);
      if (
        job.status === 'queued' ||
        job.status === 'running' ||
        job.status === 'discarded' ||
        (job.status === 'applied' && !leftover)
      )
        return c.json({ error: 'not-discardable' }, 409);
      // Cleaned up in the job's own repository, whatever project is open now.
      const repo = job.repo ?? (await projectFor(job, settings));
      if (repo) {
        try {
          await discardWorkspace(job, repo);
        } catch {
          // Still there (locked, a file in use): stay discardable so it can be tried again.
          return c.json({ error: 'discard-failed' }, 500);
        }
      }
      if (job.status !== 'applied') jobs.setStatus(job.id, 'discarded');
      return c.json({ ok: true });
    });
  });

  return app;
}
