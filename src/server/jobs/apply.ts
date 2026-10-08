// Applying a job: copy the worktree's changes into the project. The user sees the plan
// first; each file is a write through the gate (bound to the plan's content hash) and the
// executor, so it has a receipt and snapshots and can be restored like any other turn.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Executor } from '../effects/execute.ts';
import type { Gate } from '../effects/gate.ts';
import { contentHash } from '../effects/hash.ts';
import { asContent } from '../effects/snapshots.ts';
import type { Effect } from '../effects/types.ts';
import { changedFiles, git, removeWorktree } from '../external/worktree.ts';
import type { Job, JobStore } from './store.ts';

type WriteEffect = Extract<Effect, { kind: 'write' }>;

export interface ApplyItem {
  /** Repo-relative path, forward slashes. */
  path: string;
  effect: WriteEffect;
  contentHash: string;
  /** The project's file changed after the job started; applying overwrites that change. */
  modifiedSince: boolean;
  before: string | null;
  after: string | null;
}

/** The run id an applied job's writes are recorded under (restorable as one turn). */
export const applyRunId = (jobId: string) => `apply:${jobId}`;

async function baseContent(
  project: string,
  base: string,
  path: string,
): Promise<string | null> {
  try {
    return await git(project, 'show', `${base}:${path}`);
  } catch {
    return null;
  }
}

export async function applyPlan(
  job: Job,
  project: string,
): Promise<ApplyItem[]> {
  if (!job.worktree || !job.baseCommit) return [];
  const items: ApplyItem[] = [];
  for (const path of await changedFiles(job.worktree, job.baseCommit)) {
    const source = join(job.worktree, path);
    const target = join(project, ...path.split('/'));
    const afterBlob = existsSync(source) ? readFileSync(source) : null;
    const after = afterBlob ? asContent(afterBlob) : null;
    const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
    const effect: WriteEffect =
      after === null
        ? { kind: 'write', path: target, operation: 'delete' }
        : {
            kind: 'write',
            path: target,
            operation: current === null ? 'create' : 'edit',
            ...after,
          };
    items.push({
      path,
      effect,
      contentHash: contentHash(effect),
      modifiedSince:
        current !== (await baseContent(project, job.baseCommit, path)),
      before: current,
      after: after && !after.encoding ? after.content : null,
    });
  }
  return items;
}

export type ApplyResult =
  | { ok: true; applied: string[] }
  | {
      ok: false;
      error: 'not-applicable' | 'content-changed' | 'denied';
      path?: string;
    };

export async function applyJob(
  deps: { gate: Gate; executor: Executor; jobs: JobStore },
  job: Job,
  project: string,
  seen: { path: string; contentHash: string }[],
): Promise<ApplyResult> {
  if (job.status !== 'verified' && job.status !== 'problems')
    return { ok: false, error: 'not-applicable' };
  const plan = await applyPlan(job, project);
  const same =
    plan.length === seen.length &&
    plan.every((item, i) => item.path === seen[i]?.path);
  if (!same) return { ok: false, error: 'content-changed' };
  const applied: string[] = [];
  for (const [i, item] of plan.entries()) {
    const result = deps.gate.userAction(
      item.effect,
      { threadId: job.threadId, runId: applyRunId(job.id), actor: 'user' },
      seen[i]!.contentHash,
    );
    if (!result.allowed) {
      return {
        ok: false,
        error:
          result.message === 'content-changed' ? 'content-changed' : 'denied',
        path: item.path,
      };
    }
    deps.executor.write(result.pass, item.effect);
    applied.push(item.path);
  }
  deps.jobs.setStatus(job.id, 'applied');
  await discardWorkspace(job, project);
  return { ok: true, applied };
}

/** Removes the job's worktree and branch. The job record and its timeline stay. */
export async function discardWorkspace(
  job: Job,
  project: string,
): Promise<void> {
  if (job.worktree && job.branch)
    await removeWorktree(project, job.worktree, job.branch);
}
