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

const EXCLUDE_SHARED = `:(exclude)${SHARED_MODULES}`;

/** Makes Git aware of new, non-ignored files without staging their content, so a diff
 * against the base commit includes them. */
async function registerNewFiles(worktree: string): Promise<void> {
  // The pathspec keeps Git from walking into the shared node_modules link (a junction
  // on Windows may look like a plain directory).
  const untracked = (
    await git(
      worktree,
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
      '.',
      EXCLUDE_SHARED,
    )
  )
    .split('\0')
    .filter((p) => p && p !== SHARED_MODULES);
  if (untracked.length > 0)
    await git(worktree, 'add', '--intent-to-add', '--', ...untracked);
}

/** Paths (forward slashes, relative to the worktree) that differ from the base commit,
 * including work the agent committed and new files. A move is a delete plus a create. */
export async function changedFiles(
  worktree: string,
  base: string,
): Promise<string[]> {
  await registerNewFiles(worktree);
  const out = await git(
    worktree,
    'diff',
    '--name-only',
    '--no-renames',
    '-z',
    base,
    '--',
    '.',
    EXCLUDE_SHARED,
  );
  return out.split('\0').filter(Boolean);
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
  base: string,
  approved: Map<string, string>,
): Promise<Verification> {
  const changed = await changedFiles(worktree, base);
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
  const diff = await git(
    worktree,
    'diff',
    '--no-renames',
    base,
    '--',
    '.',
    EXCLUDE_SHARED,
  );
  return { changed, unapproved, mismatched, diff };
}
