// Git-only checks of how Rocky reads an external agent's worktree: what changed since the
// job's base commit, whatever the agent did with Git in between.
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addWorktree,
  changedFiles,
  verifyWorktree,
} from '../../src/server/external/worktree.ts';
import { applyPlan } from '../../src/server/jobs/apply.ts';
import type { Job } from '../../src/server/jobs/store.ts';

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
}

async function project() {
  const root = mkdtempSync(join(tmpdir(), 'rocky-worktree-'));
  const repo = join(root, 'project');
  mkdirSync(join(repo, 'src'), { recursive: true });
  sh(repo, 'init', '-q');
  sh(repo, 'config', 'user.email', 'test@example.com');
  sh(repo, 'config', 'user.name', 'Test');
  sh(repo, 'config', 'core.autocrlf', 'false');
  writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(repo, 'src', 'old.ts'), 'export const old = 1;\n');
  writeFileSync(join(repo, '.gitignore'), 'dist/\n');
  sh(repo, 'add', '-A');
  sh(repo, 'commit', '-q', '-m', 'base');
  const tree = await addWorktree(repo, join(root, 'wt'), 'rocky/job-test');
  return { repo, worktree: tree.path, base: tree.base };
}

const job = (worktree: string, base: string): Job => ({
  id: 'job-test',
  threadId: 't',
  runId: null,
  toolCallId: null,
  agent: 'opencode',
  title: 'test',
  task: 'test',
  status: 'verified',
  worktree,
  branch: 'rocky/job-test',
  baseCommit: base,
  sessionId: null,
  result: null,
  createdAt: 0,
  finishedAt: null,
});

describe('worktree changes', () => {
  it('lists edits, new files and deletions; ignores ignored files and the shared node_modules link', async () => {
    const { repo, worktree, base } = await project();
    writeFileSync(join(worktree, 'src', 'a.ts'), 'export const a = 2;\n');
    writeFileSync(join(worktree, 'src', 'new.ts'), 'export const n = 1;\n');
    execFileSync('git', ['-C', worktree, 'rm', '-q', 'src/old.ts']);
    mkdirSync(join(worktree, 'dist'));
    writeFileSync(join(worktree, 'dist', 'out.js'), '');
    mkdirSync(join(repo, 'node_modules'));
    symlinkSync(
      join(repo, 'node_modules'),
      join(worktree, 'node_modules'),
      'junction',
    );
    expect((await changedFiles(worktree, base)).sort()).toEqual([
      'src/a.ts',
      'src/new.ts',
      'src/old.ts',
    ]);
  });

  it('still sees the work after the agent commits it', async () => {
    const { worktree, base } = await project();
    writeFileSync(join(worktree, 'src', 'a.ts'), 'export const a = 3;\n');
    sh(worktree, 'commit', '-q', '-am', 'agent commit');
    expect(await changedFiles(worktree, base)).toEqual(['src/a.ts']);
    const verification = await verifyWorktree(worktree, base, new Map());
    expect(verification.changed).toEqual(['src/a.ts']);
    expect(verification.diff).toContain('+export const a = 3;');
  });

  it('reports a moved file as a delete plus a create, never as a mangled path', async () => {
    const { repo, worktree, base } = await project();
    renameSync(
      join(worktree, 'src', 'old.ts'),
      join(worktree, 'src', 'moved.ts'),
    );
    // The job runner verifies first (which registers new files with Git), then apply plans.
    const verification = await verifyWorktree(worktree, base, new Map());
    expect([...verification.changed].sort()).toEqual([
      'src/moved.ts',
      'src/old.ts',
    ]);
    expect((await changedFiles(worktree, base)).sort()).toEqual([
      'src/moved.ts',
      'src/old.ts',
    ]);
    const plan = await applyPlan(job(worktree, base), repo);
    const ops = plan.map((i) => [i.path, i.effect.operation]).sort();
    expect(ops).toEqual([
      ['src/moved.ts', 'create'],
      ['src/old.ts', 'delete'],
    ]);
    // The plan never touches anything but the two real paths.
    expect(existsSync(join(repo, 'src', 'old.ts'))).toBe(true);
    expect(readFileSync(join(repo, 'src', 'a.ts'), 'utf8')).toBe(
      'export const a = 1;\n',
    );
  });
});
