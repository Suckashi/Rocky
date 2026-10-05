// The M2 tool flow end to end through the local server: a scripted model calls Rocky's
// tools, the gate asks over AG-UI state, the user answers over the approvals API.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { composeRocky } from '../../src/server/compose.ts';
import type { PendingApproval } from '../../src/server/effects/gate.ts';
import type { Receipt } from '../../src/server/effects/receipts.ts';
import type { Snapshot } from '../../src/server/effects/snapshots.ts';
import { EgressGuard } from '../../src/server/platform/egress.ts';
import {
  startFakeOpenAI,
  type ChatRequestMessage,
  type FakeOpenAI,
  type ScriptedToolCall,
} from '../../spikes/s2-agent/fake-openai.ts';

const PORT = 4318;
const HOST = `127.0.0.1:${PORT}`;
const token = 'k'.repeat(43);

type Event = { type: string; [k: string]: unknown };

let fake: FakeOpenAI;
/** The tool calls the model makes on its first turn; afterwards it echoes the tool results. */
let plan: ScriptedToolCall[] = [];

function toolResults(messages: ChatRequestMessage[]): string[] {
  return messages
    .filter((m) => m.role === 'tool')
    .map((m) =>
      typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    );
}

beforeAll(async () => {
  fake = await startFakeOpenAI((messages) => {
    const results = toolResults(messages);
    if (results.length === 0) return { toolCalls: plan };
    return { text: `RESULTS:\n${results.join('\n---\n')}` };
  });
});
afterAll(() => fake.close());

async function setup(mode: 'ask-always' | 'ask-when-needed' | 'hands-off') {
  const dir = mkdtempSync(join(tmpdir(), 'rocky-tools-'));
  const project = join(dir, 'project');
  mkdirSync(project);
  mkdirSync(join(dir, 'data'));
  writeFileSync(join(project, 'app.js'), 'const answer = 41;\n');
  writeFileSync(join(project, '.env'), 'SECRET=do-not-read\n');
  const rocky = composeRocky({
    dataDir: join(dir, 'data'),
    token,
    port: PORT,
    egress: new EgressGuard(() => {}),
    listModels: async () => [],
  });
  const call = (path: string, init: { method?: string; body?: unknown } = {}) =>
    rocky.app.request(`http://${HOST}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        host: HOST,
        authorization: `Bearer ${token}`,
        ...(init.body !== undefined
          ? { 'content-type': 'application/json' }
          : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  await call('/api/settings/model', {
    method: 'PUT',
    body: { provider: 'openai-compatible', baseURL: fake.baseURL, model: 'f' },
  });
  await call('/api/settings/mode', { method: 'PUT', body: { mode } });
  const set = await call('/api/settings/project', {
    method: 'PUT',
    body: { path: project },
  });
  expect(set.status).toBe(200);
  return { call, project, rocky };
}

type Call = Awaited<ReturnType<typeof setup>>['call'];

async function run(
  call: Call,
  threadId: string,
  text = 'go',
): Promise<Event[]> {
  const res = await call('/api/copilotkit/agent/rocky/run', {
    method: 'POST',
    body: {
      threadId,
      runId: `${threadId}-r`,
      messages: [{ id: `${threadId}-u`, role: 'user', content: text }],
      tools: [],
      context: [],
      state: {},
      forwardedProps: {},
    },
  });
  return (await res.text())
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => JSON.parse(line.slice(5).trim()) as Event);
}

async function nextApproval(
  call: Call,
  threadId: string,
): Promise<PendingApproval> {
  for (let i = 0; i < 200; i++) {
    const body = (await (
      await call(`/api/threads/${threadId}/approvals`)
    ).json()) as { pending: PendingApproval[] };
    if (body.pending[0]) return body.pending[0];
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('no approval appeared');
}

const reply = (events: Event[]) =>
  events
    .filter((e) => e.type === 'TEXT_MESSAGE_CONTENT')
    .map((e) => e['delta'])
    .join('');

async function receipts(call: Call, threadId: string) {
  return (await (await call(`/api/threads/${threadId}/receipts`)).json()) as {
    receipts: Receipt[];
    snapshots: Snapshot[];
  };
}

describe('agent tools through the action gate', () => {
  it('asks before an edit, writes only after approval, and keeps snapshots and a receipt', async () => {
    const { call, project } = await setup('ask-always');
    plan = [
      {
        name: 'edit_file',
        args: {
          file_path: '/app.js',
          old_string: 'answer = 41',
          new_string: 'answer = 42',
        },
      },
    ];
    const events = run(call, 'e1');
    const approval = await nextApproval(call, 'e1');
    expect(approval.effect).toMatchObject({ kind: 'write', operation: 'edit' });
    expect(approval.before).toBe('const answer = 41;\n');
    // Nothing is written while the question is open.
    expect(readFileSync(join(project, 'app.js'), 'utf8')).toContain('41');

    const answered = await call(`/api/approvals/${approval.id}`, {
      method: 'POST',
      body: { decision: 'allow-once', contentHash: approval.contentHash },
    });
    expect(answered.status).toBe(200);
    const done = await events;
    expect(done.at(-1)?.type).toBe('RUN_FINISHED');
    expect(readFileSync(join(project, 'app.js'), 'utf8')).toBe(
      'const answer = 42;\n',
    );

    // The UI learned about the question through AG-UI state.
    const states = done.filter((e) => e.type === 'STATE_SNAPSHOT');
    expect(
      states.some(
        (e) =>
          (e['snapshot'] as { pendingApprovals: unknown[] }).pendingApprovals
            .length === 1,
      ),
    ).toBe(true);

    const { receipts: list, snapshots } = await receipts(call, 'e1');
    expect(list).toMatchObject([
      { decision: 'approved', outcome: 'succeeded', actor: 'rocky' },
    ]);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.beforeSha).not.toBeNull();
    expect(snapshots[0]?.afterSha).not.toBeNull();

    // A second answer to the same question is refused.
    const again = await call(`/api/approvals/${approval.id}`, {
      method: 'POST',
      body: { decision: 'allow-once', contentHash: approval.contentHash },
    });
    expect(again.status).toBe(409);
  });

  it('treats an approval for different content as a rejection', async () => {
    const { call, project } = await setup('ask-always');
    plan = [
      {
        name: 'write_file',
        args: { file_path: '/new.txt', content: 'hello\n' },
      },
    ];
    const events = run(call, 'e2');
    const approval = await nextApproval(call, 'e2');
    await call(`/api/approvals/${approval.id}`, {
      method: 'POST',
      body: { decision: 'allow-once', contentHash: 'f'.repeat(64) },
    });
    expect(reply(await events)).toContain('does not match');
    expect(() => readFileSync(join(project, 'new.txt'))).toThrow();
    const { receipts: list } = await receipts(call, 'e2');
    expect(list).toMatchObject([
      { decision: 'rejected', outcome: 'not-run', detail: 'content-changed' },
    ]);
  });

  it("passes the user's rejection reason back to the model", async () => {
    const { call } = await setup('ask-always');
    plan = [{ name: 'run_command', args: { argv: ['node', '--version'] } }];
    const events = run(call, 'e3');
    const approval = await nextApproval(call, 'e3');
    await call(`/api/approvals/${approval.id}`, {
      method: 'POST',
      body: {
        decision: 'reject',
        contentHash: approval.contentHash,
        reason: '請先跑測試',
      },
    });
    const text = reply(await events);
    expect(text).toContain('rejected');
    expect(text).toContain('請先跑測試');
  });

  it('runs a command from argv and returns the exit code and output', async () => {
    const { call } = await setup('hands-off');
    plan = [
      {
        name: 'run_command',
        args: { argv: [process.execPath, '-p', '6*7'] },
      },
    ];
    const text = reply(await run(call, 'e4'));
    expect(text).toContain('exited with code 0');
    expect(text).toContain('42');
    const { receipts: list } = await receipts(call, 'e4');
    expect(list).toMatchObject([{ outcome: 'succeeded' }]);
    expect(list[0]?.effect).toMatchObject({ kind: 'command' });
  });

  it('refuses to read secrets even in hands-off mode', async () => {
    const { call } = await setup('hands-off');
    plan = [{ name: 'read_file', args: { file_path: '/.env' } }];
    const text = reply(await run(call, 'e5'));
    expect(text).toContain('not allowed');
    expect(text).not.toContain('do-not-read');
    const { receipts: list } = await receipts(call, 'e5');
    expect(list).toMatchObject([{ decision: 'denied', outcome: 'not-run' }]);
  });

  it('reads project files without asking', async () => {
    const { call } = await setup('ask-always');
    plan = [{ name: 'read_file', args: { file_path: '/app.js' } }];
    const text = reply(await run(call, 'e6'));
    expect(text).toContain('const answer = 41;');
  });
});

describe('without a project folder', () => {
  it('tells the model that files and commands are unavailable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rocky-tools-'));
    const rocky = composeRocky({
      dataDir: dir,
      token,
      port: PORT,
      egress: new EgressGuard(() => {}),
      listModels: async () => [],
    });
    rocky.settings.setModel({
      provider: 'openai-compatible',
      baseURL: fake.baseURL,
      model: 'f',
    });
    plan = [{ name: 'read_file', args: { file_path: '/app.js' } }];
    const res = await rocky.app.request(
      `http://${HOST}/api/copilotkit/agent/rocky/run`,
      {
        method: 'POST',
        headers: {
          host: HOST,
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          threadId: 'n1',
          runId: 'n1-r',
          messages: [{ id: 'n1-u', role: 'user', content: 'read' }],
          tools: [],
          context: [],
          state: {},
          forwardedProps: {},
        }),
      },
    );
    const text = await res.text();
    expect(text).toContain('No project folder');
  });
});
