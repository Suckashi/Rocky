// A job's changes go back to the repository its worktree came from (ADR 0031), whatever
// folder is open as the project now. No OpenCode needed: the job is set up by hand.
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addWorktree, repoRoot } from '../../src/server/external/worktree.ts';
import { testRocky } from '../fixtures/rocky.ts';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });

function repo(root: string, name: string) {
  const dir = join(root, name);
  mkdirSync(join(dir, 'sub'), { recursive: true });
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'core.autocrlf', 'false');
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  writeFileSync(join(dir, 'sub', 'b.txt'), 'b\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return realpathSync.native(dir);
}

/** A finished job on `project`'s repository whose worktree edited sub/b.txt. `legacy`: a
 * job from before ADR 0031, which did not record its repository. */
async function setup(
  projectOf: (a: string) => string,
  { legacy = false, names = ['a', 'b'] } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'rocky-jobs-repo-'));
  const a = repo(root, names[0]!);
  const b = repo(root, names[1]!);
  mkdirSync(join(root, 'data'));
  const { rocky, call } = testRocky({
    dataDir: join(root, 'data'),
    port: 4329,
  });
  const project = projectOf(a);
  rocky.settings.setProject(project);
  const job = rocky.jobs.create({
    threadId: 't',
    agent: 'opencode',
    title: 'x',
    task: 'y',
  });
  const top = await repoRoot(project);
  const tree = await addWorktree(top, join(root, 'wt'), 'rocky/job-x');
  rocky.jobs.setWorkspace(job.id, {
    worktree: tree.path,
    branch: 'rocky/job-x',
    baseCommit: tree.base,
    repo: top,
  });
  if (legacy)
    rocky.db.prepare('update jobs set repo = null where id = ?').run(job.id);
  writeFileSync(join(tree.path, 'sub', 'b.txt'), 'b2\n');
  rocky.jobs.finish(job.id, 'verified', null);
  return {
    rocky,
    call,
    a,
    b,
    job: rocky.jobs.get(job.id)!,
    worktree: tree.path,
  };
}

type Plan = {
  items: {
    path: string;
    contentHash: string;
    operation: string;
    before: string | null;
  }[];
};

describe("a job's own repository", () => {
  it('applies to the repository top folder when the project is a subfolder of it', async () => {
    const { call, a, job } = await setup((a) => join(a, 'sub'));
    const plan = (await (
      await call(`/api/jobs/${job.id}/apply`)
    ).json()) as Plan;
    expect(plan.items).toMatchObject([
      { path: 'sub/b.txt', operation: 'edit', before: 'b\n' },
    ]);
    const applied = await call(`/api/jobs/${job.id}/apply`, {
      method: 'POST',
      body: {
        items: plan.items.map(({ path, contentHash }) => ({
          path,
          contentHash,
        })),
      },
    });
    expect(applied.status).toBe(200);
    expect(readFileSync(join(a, 'sub', 'b.txt'), 'utf8')).toBe('b2\n');
    expect(existsSync(join(a, 'sub', 'sub'))).toBe(false);
  });

  it('applies a job from before ADR 0031 to the repository top folder too', async () => {
    const { call, a, job } = await setup((a) => join(a, 'sub'), {
      legacy: true,
    });
    expect(job.repo).toBeNull();
    const plan = (await (
      await call(`/api/jobs/${job.id}/apply`)
    ).json()) as Plan;
    const applied = await call(`/api/jobs/${job.id}/apply`, {
      method: 'POST',
      body: {
        items: plan.items.map(({ path, contentHash }) => ({
          path,
          contentHash,
        })),
      },
    });
    expect(applied.status).toBe(200);
    expect(readFileSync(join(a, 'sub', 'b.txt'), 'utf8')).toBe('b2\n');
    expect(existsSync(join(a, 'sub', 'sub'))).toBe(false);
  });

  it.skipIf(process.platform === 'win32')(
    'tells apart repositories whose names differ only in case',
    async () => {
      const { rocky, call, job } = await setup((a) => a, {
        names: ['Proj', 'proj'],
      });
      const other = join(dirname(job.repo!), 'proj');
      rocky.settings.setProject(other);
      expect((await call(`/api/jobs/${job.id}/apply`)).status).toBe(409);
    },
  );

  it('keeps paths right after switching between folders of one repository', async () => {
    const { rocky, call, a, job } = await setup((a) => a);
    rocky.settings.setProject(join(a, 'sub'));
    const plan = (await (
      await call(`/api/jobs/${job.id}/apply`)
    ).json()) as Plan;
    expect(plan.items).toMatchObject([
      { path: 'sub/b.txt', operation: 'edit', before: 'b\n' },
    ]);
  });

  it('refuses to apply into another repository, and discards in its own', async () => {
    const { rocky, call, a, b, job, worktree } = await setup((a) => a);
    rocky.settings.setProject(b);
    expect((await call(`/api/jobs/${job.id}/apply`)).status).toBe(409);
    const discarded = await call(`/api/jobs/${job.id}/discard`, {
      method: 'POST',
      body: {},
    });
    expect(discarded.status).toBe(200);
    expect(existsSync(worktree)).toBe(false);
    expect(git(a, 'branch', '--list', 'rocky/*')).toBe('');
    expect(rocky.jobs.get(job.id)?.status).toBe('discarded');
  });

  it('stays discardable when its worktree could not be removed', async () => {
    const { rocky, call, a, job, worktree } = await setup((a) => a);
    git(a, 'worktree', 'lock', worktree);
    const discarded = await call(`/api/jobs/${job.id}/discard`, {
      method: 'POST',
      body: {},
    });
    expect(discarded.status).toBe(500);
    expect(await discarded.json()).toEqual({ error: 'discard-failed' });
    expect(rocky.jobs.get(job.id)?.status).toBe('verified');
    git(a, 'worktree', 'unlock', worktree);
    expect(
      (await call(`/api/jobs/${job.id}/discard`, { method: 'POST', body: {} }))
        .status,
    ).toBe(200);
  });

  it('discards a job whose repository was moved away', async () => {
    const { rocky, call, a, job, worktree } = await setup((a) => a);
    renameSync(a, `${a}-moved`);
    rocky.settings.setProject(`${a}-moved`);
    const discarded = await call(`/api/jobs/${job.id}/discard`, {
      method: 'POST',
      body: {},
    });
    expect(discarded.status).toBe(200);
    expect(existsSync(worktree)).toBe(false);
    expect(rocky.jobs.get(job.id)?.status).toBe('discarded');
  });

  it('an applied job whose worktree stayed behind can still be cleaned up', async () => {
    const { rocky, call, a, job, worktree } = await setup((a) => a);
    git(a, 'worktree', 'lock', worktree);
    const plan = (await (
      await call(`/api/jobs/${job.id}/apply`)
    ).json()) as Plan;
    const applied = await call(`/api/jobs/${job.id}/apply`, {
      method: 'POST',
      body: {
        items: plan.items.map(({ path, contentHash }) => ({
          path,
          contentHash,
        })),
      },
    });
    expect(applied.status).toBe(200);
    const detail = async () =>
      (await (await call(`/api/jobs/${job.id}`)).json()) as {
        leftover: boolean;
      };
    expect((await detail()).leftover).toBe(true);
    git(a, 'worktree', 'unlock', worktree);
    const cleaned = await call(`/api/jobs/${job.id}/discard`, {
      method: 'POST',
      body: {},
    });
    expect(cleaned.status).toBe(200);
    expect(existsSync(worktree)).toBe(false);
    expect(git(a, 'branch', '--list', 'rocky/*')).toBe('');
    expect(rocky.jobs.get(job.id)?.status).toBe('applied');
    expect((await detail()).leftover).toBe(false);
    expect(
      (await call(`/api/jobs/${job.id}/discard`, { method: 'POST', body: {} }))
        .status,
    ).toBe(409);
  });

  it('apply and discard sent together leave the job and the project in agreement', async () => {
    const { rocky, call, a, job } = await setup((a) => a);
    const plan = (await (
      await call(`/api/jobs/${job.id}/apply`)
    ).json()) as Plan;
    const [applied, discarded] = await Promise.all([
      call(`/api/jobs/${job.id}/apply`, {
        method: 'POST',
        body: {
          items: plan.items.map(({ path, contentHash }) => ({
            path,
            contentHash,
          })),
        },
      }),
      call(`/api/jobs/${job.id}/discard`, { method: 'POST', body: {} }),
    ]);
    expect([applied.status, discarded.status].filter((s) => s === 200)).toEqual(
      [200],
    );
    // The project has the change exactly when the job says it was applied.
    const written = readFileSync(join(a, 'sub', 'b.txt'), 'utf8') === 'b2\n';
    expect(written).toBe(rocky.jobs.get(job.id)?.status === 'applied');
  });

  it("applies even while the conversation is in plan mode: the click is the owner's", async () => {
    const { call, a, job } = await setup((a) => a);
    const planning = await call(`/api/threads/${job.threadId}/plan`, {
      method: 'PUT',
      body: { planning: true },
    });
    expect(planning.status).toBe(200);
    const plan = (await (
      await call(`/api/jobs/${job.id}/apply`)
    ).json()) as Plan;
    const applied = await call(`/api/jobs/${job.id}/apply`, {
      method: 'POST',
      body: {
        items: plan.items.map(({ path, contentHash }) => ({
          path,
          contentHash,
        })),
      },
    });
    expect(applied.status).toBe(200);
    expect(readFileSync(join(a, 'sub', 'b.txt'), 'utf8')).toBe('b2\n');
  });

  it('writes nothing when any file changed since the plan was shown', async () => {
    const { call, a, job, worktree } = await setup((a) => a);
    writeFileSync(join(worktree, 'a.txt'), 'a2\n');
    const plan = (await (
      await call(`/api/jobs/${job.id}/apply`)
    ).json()) as Plan;
    expect(plan.items.map((i) => i.path)).toEqual(['a.txt', 'sub/b.txt']);
    const applied = await call(`/api/jobs/${job.id}/apply`, {
      method: 'POST',
      body: {
        items: plan.items.map(({ path }, i) => ({
          path,
          contentHash: i === 1 ? 'stale' : plan.items[i]!.contentHash,
        })),
      },
    });
    expect(applied.status).toBe(409);
    expect(await applied.json()).toMatchObject({
      error: 'content-changed',
      path: 'sub/b.txt',
    });
    expect(readFileSync(join(a, 'a.txt'), 'utf8')).toBe('a\n');
  });
});
