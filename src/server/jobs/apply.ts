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

/** Whether the project's file differs from the base commit as Git sees it: through the
 * project's own line-ending settings and filters, like `git status` (a CRLF checkout of an
 * LF file is no change). When Git cannot tell, the file counts as changed. */
async function changedSinceBase(
  repo: string,
  base: string,
  path: string,
  exists: boolean,
): Promise<boolean> {
  const blob = await git(repo, 'rev-parse', '--verify', '-q', `${base}:${path}`)
    .then((s) => s.trim())
    .catch(() => null);
  if (!exists || blob === null) return exists !== (blob !== null);
  const now = await git(repo, 'hash-object', '--', path)
    .then((s) => s.trim())
    .catch(() => '');
  return now !== blob;
}

/** The plan to copy a job's changes into `repo`, the repository its worktree came from
 * (paths in the worktree are relative to the repository's top folder). */
export async function applyPlan(job: Job, repo: string): Promise<ApplyItem[]> {
  if (!job.worktree || !job.baseCommit) return [];
  const items: ApplyItem[] = [];
  for (const path of await changedFiles(job.worktree, job.baseCommit)) {
    const source = join(job.worktree, path);
    const target = join(repo, ...path.split('/'));
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
      modifiedSince: await changedSinceBase(
        repo,
        job.baseCommit,
        path,
        current !== null,
      ),
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
      error: 'not-applicable' | 'content-changed' | 'denied' | 'write-failed';
      path?: string;
      /** Files already written when a later one failed (restorable like any write). */
      applied?: string[];
    };

export async function applyJob(
  deps: { gate: Gate; executor: Executor; jobs: JobStore },
  job: Job,
  repo: string,
  seen: { path: string; contentHash: string }[],
): Promise<ApplyResult> {
  if (job.status !== 'verified' && job.status !== 'problems')
    return { ok: false, error: 'not-applicable' };
  const plan = await applyPlan(job, repo);
  const same =
    plan.length === seen.length &&
    plan.every((item, i) => item.path === seen[i]?.path);
  if (!same) return { ok: false, error: 'content-changed' };
  // Every file must still be what the user saw before the first one is written.
  const changed = plan.find(
    (item, i) => item.contentHash !== seen[i]!.contentHash,
  );
  if (changed)
    return { ok: false, error: 'content-changed', path: changed.path };
  const applied: string[] = [];
  for (const [i, item] of plan.entries()) {
    const result = deps.gate.userAction(
      item.effect,
      { threadId: job.threadId, runId: applyRunId(job.id), actor: 'user' },
      seen[i]!.contentHash,
      repo,
    );
    if (!result.allowed) {
      return {
        ok: false,
        error:
          result.message === 'content-changed' ? 'content-changed' : 'denied',
        path: item.path,
        applied,
      };
    }
    try {
      deps.executor.write(result.pass, item.effect);
    } catch {
      // The files before it are written; applying again writes the same content.
      return { ok: false, error: 'write-failed', path: item.path, applied };
    }
    applied.push(item.path);
  }
  deps.jobs.setStatus(job.id, 'applied');
  // The work is in the project now; a worktree that cannot be removed only leaves a folder.
  await discardWorkspace(job, repo).catch(() =>
    deps.jobs.addEvent(job.id, { type: 'status', text: 'cleanup-failed' }),
  );
  return { ok: true, applied };
}

/** Removes the job's worktree and branch. The job record and its timeline stay. */
export async function discardWorkspace(job: Job, repo: string): Promise<void> {
  if (job.worktree && job.branch)
    await removeWorktree(repo, job.worktree, job.branch);
}
