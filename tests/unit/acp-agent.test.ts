// An external agent that cannot start, or dies mid-job, fails that job; Rocky keeps running.
import { execFileSync, spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AcpAgent } from '../../src/server/external/acp.ts';
import { testRocky } from '../fixtures/rocky.ts';

const handlers = { decide: async () => 'reject' as const, update: () => {} };

function start(command: string, args: string[] = []) {
  return spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
}

describe('AcpAgent', () => {
  it('rejects when the executable is missing, and closes at once', async () => {
    const agent = new AcpAgent(
      start(join(tmpdir(), 'no-such-opencode')),
      handlers,
    );
    await expect(agent.initialize()).rejects.toThrow(/ENOENT/);
    expect(await agent.close()).toBe('exited');
  });

  it('rejects a request when the agent exits without answering', async () => {
    const agent = new AcpAgent(
      start(process.execPath, [
        '-e',
        'process.stdin.resume(); setTimeout(() => process.exit(3), 100)',
      ]),
      handlers,
    );
    await expect(agent.initialize()).rejects.toThrow(/closed|exited/);
    expect(['exited', 'stdin-closed']).toContain(await agent.close());
  });

  it.skipIf(process.platform === 'win32')(
    'closing ends what the agent left running',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'rocky-acp-'));
      const pidFile = join(dir, 'pid');
      // The agent starts a long command, then exits as soon as its input closes.
      const child = spawn(
        'sh',
        [
          '-c',
          `sleep 300 & echo $! > "${pidFile}"; exec ${JSON.stringify(process.execPath)} -e "process.stdin.on('end', () => process.exit(0)).resume()"`,
        ],
        { stdio: ['pipe', 'pipe', 'pipe'], detached: true },
      );
      const agent = new AcpAgent(child, handlers, { group: true });
      while (!existsSync(pidFile) || !readFileSync(pidFile, 'utf8').trim())
        await new Promise((r) => setTimeout(r, 20));
      const pid = Number(readFileSync(pidFile, 'utf8'));
      expect(await agent.close()).toBe('stdin-closed');
      await new Promise((r) => setTimeout(r, 100));
      // Ended: gone, or a zombie nobody reaps (a container's first process may not).
      const state = existsSync(`/proc/${pid}/status`)
        ? /State:\s+(\w)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1]
        : 'gone';
      expect(['gone', 'Z']).toContain(
        process.platform === 'linux'
          ? state
          : (() => {
              try {
                process.kill(pid, 0);
                return 'alive';
              } catch {
                return 'gone';
              }
            })(),
      );
    },
  );
});

function project(root: string): string {
  const dir = join(root, 'project');
  mkdirSync(dir);
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      [
        '-C',
        dir,
        '-c',
        'user.email=t@example.com',
        '-c',
        'user.name=T',
        ...args,
      ],
      { stdio: 'ignore' },
    );
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  return dir;
}

function rockyWith(root: string, bin: string) {
  mkdirSync(join(root, 'data'));
  const { rocky } = testRocky({
    dataDir: join(root, 'data'),
    port: 4398,
    findAgent: () => bin,
  });
  rocky.settings.setModel({
    provider: 'openai-compatible',
    baseURL: 'http://127.0.0.1:9/v1',
    model: 'm',
  });
  rocky.settings.setProject(project(root));
  return rocky;
}

/** An agent that starts (leaving a mark) and then never answers anything. `stubborn`: it
 * also ignores the end of its input and SIGTERM. */
function silentAgent(root: string, stubborn = false): string {
  const bin = join(root, 'opencode');
  const node = JSON.stringify(process.execPath);
  writeFileSync(
    bin,
    stubborn
      ? `#!/bin/sh\ntouch "${root}/started"\nexec ${node} -e "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"\n`
      : `#!/bin/sh\ntouch "${root}/started"\nexec ${node} -e "process.stdin.resume()"\n`,
  );
  chmodSync(bin, 0o755);
  return bin;
}

describe.skipIf(process.platform === 'win32')('job agent lifecycle', () => {
  it('stopping a job whose agent does not answer ends it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rocky-acp-'));
    const rocky = rockyWith(root, silentAgent(root));
    const job = await rocky.jobRunner.enqueue({
      threadId: 't1',
      title: 'x',
      task: 'y',
    });
    while (rocky.jobs.get(job.id)?.worktree == null)
      await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 200));
    expect(rocky.jobRunner.cancel(job.id)).toBe(true);
    const done = await rocky.jobRunner.wait(job.id);
    expect(done.status).toBe('stopped');
  }, 20_000);

  it('a job stopped before its agent started never waits on it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rocky-acp-'));
    const rocky = rockyWith(root, silentAgent(root));
    const job = await rocky.jobRunner.enqueue({
      threadId: 't1',
      title: 'x',
      task: 'y',
    });
    expect(rocky.jobRunner.cancel(job.id)).toBe(true);
    expect((await rocky.jobRunner.wait(job.id)).status).toBe('stopped');
  }, 20_000);

  it('a job stopped while its worktree is made never starts the agent', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rocky-acp-'));
    const rocky = rockyWith(root, silentAgent(root));
    // A slow checkout (a big repository, antivirus, a hook): longer than the grace period.
    const hook = join(root, 'project', '.git', 'hooks', 'post-checkout');
    writeFileSync(hook, '#!/bin/sh\nsleep 3\n');
    chmodSync(hook, 0o755);
    const job = await rocky.jobRunner.enqueue({
      threadId: 't1',
      title: 'x',
      task: 'y',
    });
    expect(rocky.jobRunner.cancel(job.id)).toBe(true);
    expect((await rocky.jobRunner.wait(job.id)).status).toBe('stopped');
    expect(existsSync(join(root, 'started'))).toBe(false);
  }, 20_000);

  it('at shutdown an agent that ignores everything is ended without the grace period', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rocky-acp-'));
    const rocky = rockyWith(root, silentAgent(root, true));
    const job = await rocky.jobRunner.enqueue({
      threadId: 't1',
      title: 'x',
      task: 'y',
    });
    while (!existsSync(join(root, 'started')))
      await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 200));
    const started = Date.now();
    await rocky.jobRunner.close();
    // Input closed (2 s), SIGTERM ignored (3 s), then the tree is killed: well inside the
    // 8 s shutdown deadline.
    const took = Date.now() - started;
    expect(took).toBeGreaterThan(4500);
    expect(took).toBeLessThan(6500);
    expect(rocky.jobs.get(job.id)?.status).toBe('stopped');
    await expect(
      rocky.jobRunner.enqueue({ threadId: 't1', title: 'x', task: 'y' }),
    ).rejects.toThrow('shutting-down');
  }, 20_000);

  it('closing at shutdown waits until the running job has stopped', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rocky-acp-'));
    const rocky = rockyWith(root, silentAgent(root));
    const job = await rocky.jobRunner.enqueue({
      threadId: 't1',
      title: 'x',
      task: 'y',
    });
    while (rocky.jobs.get(job.id)?.worktree == null)
      await new Promise((r) => setTimeout(r, 20));
    await rocky.jobRunner.close();
    expect(rocky.jobs.get(job.id)?.status).toBe('stopped');
  }, 20_000);
});

describe('a job whose agent cannot start', () => {
  it.skipIf(process.platform === 'win32')(
    'fails the job and leaves Rocky running',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'rocky-acp-'));
      // Exists, but cannot be run: EACCES.
      const bin = join(root, 'opencode');
      writeFileSync(bin, '');
      chmodSync(bin, 0o644);
      const rocky = rockyWith(root, bin);
      const job = await rocky.jobRunner.enqueue({
        threadId: 't1',
        title: 'x',
        task: 'y',
      });
      const done = await rocky.jobRunner.wait(job.id);
      expect(done.status).toBe('failed');
      expect(done.result?.error).toMatch(/EACCES/);
      await rocky.jobRunner.close();
    },
  );
});
