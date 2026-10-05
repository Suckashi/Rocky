// External agents work in a git worktree of the project, never in the project itself.
// Rocky reads the result with git and checks it against what it approved.
import { execFile } from 'node:child_process';
import {
  lstatSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    return (
      (await git(dir, 'rev-parse', '--is-inside-work-tree')).trim() === 'true'
    );
  } catch {
    return false;
  }
}

/** A new branch and worktree at the project's HEAD; returns the real path and the commit. */
export async function addWorktree(
  repo: string,
  path: string,
  branch: string,
): Promise<{ path: string; base: string }> {
  const base = (await git(repo, 'rev-parse', 'HEAD')).trim();
  await git(repo, 'worktree', 'add', '-q', '-b', branch, path, base);
  return { path: realpathSync.native(path), base };
}

/** Rocky links the project's node_modules into a worktree; it is never part of the work. */
export const SHARED_MODULES = 'node_modules';

/** Removes the shared node_modules link itself, so nothing can follow it into the project. */
export function unlinkSharedModules(worktree: string): void {
  const link = join(worktree, SHARED_MODULES);
  try {
    if (!lstatSync(link).isSymbolicLink()) return;
  } catch {
    return;
  }
  try {
    unlinkSync(link);
  } catch {
    rmdirSync(link); // a Windows junction
  }
}

export async function removeWorktree(
  repo: string,
  path: string,
  branch: string,
): Promise<void> {
  unlinkSharedModules(path);
  await git(repo, 'worktree', 'remove', '--force', path).catch(() => '');
  await git(repo, 'branch', '-D', branch).catch(() => '');
}

/** Paths (forward slashes, relative to the worktree) that differ from the base commit. */
export async function changedFiles(worktree: string): Promise<string[]> {
  const out = await git(
    worktree,
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  );
  return out
    .split('\0')
    .filter(Boolean)
    .map((entry) => entry.slice(3))
    .filter((p) => p !== SHARED_MODULES && p !== `${SHARED_MODULES}/`);
}

/** Uncommitted changes in the project: the worktree starts from HEAD and will not have them. */
export async function hasUncommitted(repo: string): Promise<boolean> {
  return (await git(repo, 'status', '--porcelain')).trim().length > 0;
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

export interface Verification {
  changed: string[];
  /** Changed files Rocky never approved content for. */
  unapproved: string[];
  /** Changed files whose content differs from the last content Rocky approved. */
  mismatched: string[];
  diff: string;
}

/** approved: repo path → the last full content Rocky approved for it. */
export async function verifyWorktree(
  worktree: string,
  approved: Map<string, string>,
): Promise<Verification> {
  const changed = await changedFiles(worktree);
  const unapproved = changed.filter((p) => !approved.has(p));
  const mismatched = changed.filter((p) => {
    const expected = approved.get(p);
    if (expected === undefined) return false;
    try {
      return readFileSync(join(worktree, p), 'utf8') !== expected;
    } catch {
      return true;
    }
  });
  // New files show up in the diff once Git knows about them (without staging content).
  const status = await git(
    worktree,
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  );
  const untracked = status
    .split('\0')
    .filter((e) => e.startsWith('?? '))
    .map((e) => e.slice(3))
    .filter((p) => p !== SHARED_MODULES && p !== `${SHARED_MODULES}/`);
  if (untracked.length > 0)
    await git(worktree, 'add', '--intent-to-add', '--', ...untracked);
  const diff = await git(
    worktree,
    'diff',
    'HEAD',
    '--',
    '.',
    `:(exclude)${SHARED_MODULES}`,
  );
  return { changed, unapproved, mismatched, diff };
}
