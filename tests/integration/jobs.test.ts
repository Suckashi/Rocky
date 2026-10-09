// M3: Rocky delegates to a real `opencode acp` (scripted model on 127.0.0.1). Skipped when
// OpenCode is not installed (CI does not install it; set ROCKY_REQUIRE_OPENCODE=1 to require it).
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCheckJobsTool } from '../../src/server/agent/delegate.ts';
import { findOpenCode } from '../../src/server/external/opencode.ts';
import { JobStore } from '../../src/server/jobs/store.ts';
import { openDatabase } from '../../src/server/store/db.ts';
import {
  startFakeOpenAI,
  type ChatRequestMessage,
  type FakeOpenAI,
  type ScriptedReply,
  type ScriptedToolCall,
} from '../fixtures/fake-openai.ts';
import { testRocky } from '../fixtures/rocky.ts';

const PORT = 4319;
const token = 'j'.repeat(43);
const BUGGY = 'export function add(a, b) {\n  return a - b;\n}\n';
const FIXED = 'export function add(a, b) {\n  return a + b;\n}\n';
const TEST = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { add } from './math.js';
test('adds', () => assert.equal(add(2, 3), 5));
`;

function hasOpenCode(): boolean {
  if (findOpenCode()) return true;
  if (process.env['ROCKY_REQUIRE_OPENCODE'] === '1')
    throw new Error('OpenCode not found');
  return false;
}

const text = (m: ChatRequestMessage | undefined) =>
  JSON.stringify(m?.content ?? '');

function gitRepo(dir: string): void {
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
}

interface Setup {
  call: (
    path: string,
    init?: { method?: string; body?: unknown },
  ) => Response | Promise<Response>;
  project: string;
  rocky: ReturnType<typeof testRocky>['rocky'];
}

describe('jobs without OpenCode', () => {
  it('marks running jobs interrupted at startup and never restarts them', () => {
    const db = openDatabase(
      join(mkdtempSync(join(tmpdir(), 'rocky-jobs-')), 'db.sqlite'),
    );
    const jobs = new JobStore(db);
    const job = jobs.create({
      threadId: 't',
      agent: 'opencode',
      title: 'x',
      task: 'y',
    });
    expect(jobs.markInterrupted()).toBe(1);
    expect(jobs.get(job.id)?.status).toBe('interrupted');
  });
});

describe.runIf(hasOpenCode())('delegating to OpenCode', () => {
  let fake: FakeOpenAI;
  let current: Setup;
  /** What OpenCode's scripted model does after a rejection reaches it; `first` makes it
   * start with that tool call (a dangerous command, a secret read). */
  const seen: {
    followUp: string;
    first: ((worktree: string) => ScriptedToolCall) | null;
  } = { followUp: '', first: null };

  beforeAll(async () => {
    fake = await startFakeOpenAI((messages): ScriptedReply => {
      const system = text(messages[0]);
      if (system.includes('title generator')) return { text: 'Job' };
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      const after = messages.length - 1 - messages.lastIndexOf(lastUser!);
      if (system.includes('You are Rocky')) {
        // Rocky: delegate once, then report the tool result.
        const result = messages.findLast((m) => m.role === 'tool');
        if (result) return { text: `REPORT ${text(result)}` };
        return {
          toolCalls: [
            {
              name: 'delegate_to_opencode',
              args: {
                title: '修 add',
                task: 'Fix add() in math.js so the tests pass.',
              },
            },
          ],
        };
      }
      // OpenCode's model: edit, run the tests, summarise.
      const worktree = current.rocky.jobs
        .list()
        .find((j) => j.status === 'running')!.worktree!;
      if (text(lastUser).includes('because the user rejected it')) {
        seen.followUp = text(lastUser);
        return { text: '了解，不改檔。' };
      }
      const step = Math.floor(after / 2);
      if (step === 0 && seen.first)
        return { toolCalls: [seen.first(worktree)] };
      if (step === 0)
        return {
          toolCalls: [
            {
              name: 'edit',
              args: {
                filePath: join(worktree, 'math.js'),
                oldString: '  return a - b;',
                newString: '  return a + b;',
              },
            },
          ],
        };
      if (step === 1)
        return {
          toolCalls: [
            {
              name: 'bash',
              args: { command: 'node --test', description: 'Run tests' },
            },
          ],
        };
      return { text: 'Fixed add; tests pass.' };
    });
  });
  afterAll(() => fake.close());

  async function setup(
    mode: 'ask-when-needed' | 'hands-off',
    answer: (effect: { kind: string; tool?: string }) => {
      decision: 'allow-once' | 'reject';
      reason?: string;
    },
  ): Promise<Setup> {
    const root = mkdtempSync(join(tmpdir(), 'rocky-jobs-'));
    const project = join(root, 'project');
    mkdirSync(project);
    writeFileSync(join(project, 'math.js'), BUGGY);
    writeFileSync(join(project, 'math.test.js'), TEST);
    writeFileSync(
      join(project, 'package.json'),
      JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }),
    );
    gitRepo(project);
    mkdirSync(join(root, 'data'));
    const { rocky, call } = testRocky({
      dataDir: join(root, 'data'),
      port: PORT,
      token,
    });
    rocky.settings.setModel({
      provider: 'openai-compatible',
      baseURL: fake.baseURL,
      model: 'f',
    });
    rocky.settings.setProject(project);
    rocky.settings.setMode(mode);
    // The conversation asks in "j1"; the background job in its own "job:<id>" thread.
    rocky.gate.subscribeAll((thread) => {
      for (const a of rocky.gate.pending(thread)) {
        const choice = answer(a.effect as { kind: string; tool?: string });
        rocky.gate.answer(a.id, { ...choice, contentHash: a.contentHash });
      }
    });
    current = { call, project, rocky };
    return current;
  }

  async function chat(s: Setup, turn = ''): Promise<string> {
    const res = await s.call('/api/copilotkit/agent/rocky/run', {
      method: 'POST',
      body: {
        threadId: 'j1',
        runId: `j1-r${turn}`,
        messages: [
          {
            id: `j1-u${turn}`,
            role: 'user',
            content: '請交給 OpenCode 修 add',
          },
        ],
        tools: [],
        context: [],
        state: {},
        forwardedProps: {},
      },
    });
    return (await res.text())
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map(
        (l) =>
          JSON.parse(l.slice(5).trim()) as { type: string; delta?: string },
      )
      .filter((e) => e.type === 'TEXT_MESSAGE_CONTENT')
      .map((e) => e.delta)
      .join('');
  }

  it('asks to start, lets OpenCode work in a worktree, verifies, then applies and restores', async () => {
    const asked: string[] = [];
    const s = await setup('ask-when-needed', (effect) => {
      asked.push(effect.tool ?? effect.kind);
      return { decision: 'allow-once' };
    });
    const reply = await chat(s);
    // The turn ends at once: the job runs in the background.
    expect(reply).toContain('runs in the background');
    const queued = s.rocky.jobs.list()[0]!;
    const job = await s.rocky.jobRunner.wait(queued.id);
    // Starting a job is an outside action; edits and tests inside the worktree are not.
    expect(asked).toEqual(['delegate_to_opencode']);
    // Asked later, Rocky can look the job up.
    const status = String(
      await createCheckJobsTool(s.rocky.jobs, s.rocky.jobRunner, 'j1').invoke(
        {},
      ),
    );
    expect(status).toContain(`Job ${job.id} (修 add): verified`);
    expect(status).toContain('changed: math.js');
    expect(status).toContain('Rocky ran npm test: exit 0');
    expect(job.status).toBe('verified');
    expect(job.result?.changed).toEqual(['math.js']);
    expect(job.result?.unapproved).toEqual([]);
    expect(job.result?.mismatched).toEqual([]);
    expect(job.result?.checks[0]).toMatchObject({
      argv: ['npm', 'test'],
      exitCode: 0,
    });
    expect(job.result?.diff).toContain('+  return a + b;');
    // Starting the job is receipted and finished like any other action.
    const started = s.rocky.receipts
      .forThread('j1')
      .find((r) => r.effect.kind === 'mcp');
    expect(started).toMatchObject({ actor: 'rocky', outcome: 'succeeded' });
    // The project itself is untouched until the user applies the job.
    expect(readFileSync(join(s.project, 'math.js'), 'utf8')).toBe(BUGGY);

    const detail = (await (await s.call(`/api/jobs/${job.id}`)).json()) as {
      events: { type: string }[];
      receipts: { actor: string; outcome: string }[];
    };
    expect(detail.events.some((e) => e.type === 'permission')).toBe(true);
    expect(detail.receipts.map((r) => [r.actor, r.outcome])).toContainEqual([
      'opencode',
      'succeeded',
    ]);

    const plan = (await (await s.call(`/api/jobs/${job.id}/apply`)).json()) as {
      items: { path: string; contentHash: string; after: string }[];
    };
    expect(plan.items.map((i) => i.path)).toEqual(['math.js']);
    expect(plan.items[0]?.after).toBe(FIXED);
    const applied = await s.call(`/api/jobs/${job.id}/apply`, {
      method: 'POST',
      body: {
        items: plan.items.map(({ path, contentHash }) => ({
          path,
          contentHash,
        })),
      },
    });
    expect(applied.status).toBe(200);
    expect(readFileSync(join(s.project, 'math.js'), 'utf8')).toBe(FIXED);
    expect(s.rocky.jobs.get(job.id)?.status).toBe('applied');
    expect(existsSync(job.worktree!)).toBe(false);

    // The applied job is one restorable turn.
    const runId = encodeURIComponent(`apply:${job.id}`);
    const { changes } = (await (
      await s.call(`/api/threads/j1/runs/${runId}/changes`)
    ).json()) as { changes: { path: string; contentHash: string }[] };
    const restored = await s.call(`/api/threads/j1/runs/${runId}/restore`, {
      method: 'POST',
      body: {
        items: changes.map(({ path, contentHash }) => ({ path, contentHash })),
      },
    });
    expect(restored.status).toBe(200);
    expect(readFileSync(join(s.project, 'math.js'), 'utf8')).toBe(BUGGY);
  }, 120_000);

  it('a rejected action is not run and the reason reaches OpenCode', async () => {
    const s = await setup('ask-when-needed', (effect) =>
      effect.kind === 'command'
        ? { decision: 'reject', reason: '先不要刪 build' }
        : { decision: 'allow-once' },
    );
    seen.first = () => ({
      name: 'bash',
      args: { command: 'rm -rf build', description: 'Clean' },
    });
    await chat(s);
    const job = await s.rocky.jobRunner
      .wait(s.rocky.jobs.list()[0]!.id)
      .finally(() => (seen.first = null));
    expect(job.result?.changed).toEqual([]);
    expect(readFileSync(join(job.worktree!, 'math.js'), 'utf8')).toBe(BUGGY);
    expect(seen.followUp).toContain('先不要刪 build');
    const discarded = await s.call(`/api/jobs/${job.id}/discard`, {
      method: 'POST',
      body: {},
    });
    expect(discarded.status).toBe(200);
    expect(existsSync(job.worktree!)).toBe(false);
  }, 120_000);

  it('asks before OpenCode reads a secret file, even hands-off', async () => {
    const asked: string[] = [];
    const s = await setup('hands-off', (effect) => {
      asked.push(effect.kind);
      return { decision: 'reject', reason: '不要讀 .env' };
    });
    seen.first = (worktree) => {
      writeFileSync(join(worktree, '.env'), 'API_KEY=sk-never-leaves\n');
      return { name: 'read', args: { filePath: join(worktree, '.env') } };
    };
    await chat(s);
    const job = await s.rocky.jobRunner
      .wait(s.rocky.jobs.list()[0]!.id)
      .finally(() => (seen.first = null));
    expect(asked).toEqual(['read']);
    expect(seen.followUp).toContain('不要讀 .env');
    expect(JSON.stringify(fake.requests)).not.toContain('sk-never-leaves');
    await s.call(`/api/jobs/${job.id}/discard`, { method: 'POST', body: {} });
  }, 120_000);

  it('queues jobs one at a time; a queued job can be stopped before it starts', async () => {
    const s = await setup('ask-when-needed', () => ({
      decision: 'allow-once',
    }));
    await chat(s, '1');
    await chat(s, '2');
    const [second, first] = s.rocky.jobs.list();
    expect(first!.status).toBe('running');
    expect(second!.status).toBe('queued');
    expect(s.rocky.jobRunner.position(second!.id)).toBe(1);
    const summary = (await (await s.call('/api/jobs/summary')).json()) as {
      running: number;
      queued: number;
    };
    expect(summary).toMatchObject({ running: 1, queued: 1 });

    const stopped = await s.call(`/api/jobs/${second!.id}/cancel`, {
      method: 'POST',
      body: {},
    });
    expect(stopped.status).toBe(200);
    expect(s.rocky.jobs.get(second!.id)?.status).toBe('stopped');
    expect(s.rocky.jobs.get(second!.id)?.worktree).toBeNull();
    expect((await s.rocky.jobRunner.wait(first!.id)).status).toBe('verified');
  }, 120_000);
});
