// Rocky checks external-agent work itself: the agent works in a git worktree, and
// afterwards every changed file must match content Rocky approved.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });

export function addWorktree(
  repo: string,
  path: string,
  branch: string,
): string {
  git(repo, 'worktree', 'add', '-q', '-b', branch, path, 'HEAD');
  return realpathSync.native(path);
}

/** Paths relative to the worktree, with forward slashes, for files that differ from HEAD. */
export function changedFiles(worktree: string): string[] {
  const out = git(
    worktree,
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  );
  return out
    .split('\0')
    .filter(Boolean)
    .map((entry) => entry.slice(3));
}

export interface ApprovedEdit {
  path: string;
  newText: string;
}

export interface Verification {
  changed: string[];
  unapproved: string[];
  mismatched: string[];
  diff: string;
}

export function toRepoPath(worktree: string, absolute: string): string {
  let real = absolute;
  try {
    real = realpathSync.native(absolute);
  } catch {
    // A file that was never created keeps its requested path.
  }
  return relative(worktree, real).split(sep).join('/');
}

export function verifyWorktree(
  worktree: string,
  approved: ApprovedEdit[],
): Verification {
  const changed = changedFiles(worktree);
  const latest = new Map<string, string>();
  for (const edit of approved)
    latest.set(toRepoPath(worktree, edit.path), edit.newText);
  const unapproved = changed.filter((path) => !latest.has(path));
  const mismatched = changed.filter((path) => {
    const expected = latest.get(path);
    if (expected === undefined) return false;
    return readFileSync(join(worktree, path), 'utf8') !== expected;
  });
  return {
    changed,
    unapproved,
    mismatched,
    diff: git(worktree, 'diff', 'HEAD'),
  };
}
