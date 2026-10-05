// The M2 tool flow end to end through the local server: a scripted model calls Rocky's
// tools, the gate asks over AG-UI state, the user answers over the approvals API.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { composeRocky } from '../../src/server/compose.ts';
import { toMarkdown } from '../../src/server/documents/read.ts';
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
/** What the research subagent's model does on its first turn (when Rocky calls "task"). */
let subPlan: ScriptedToolCall[] = [];

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
    const rocky = JSON.stringify(messages[0]?.content).includes(
      'You are Rocky',
    );
    if (!rocky)
      return results.length
        ? { text: `SUB:${results.join('|')}` }
        : { toolCalls: subPlan };
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

describe('document tools', () => {
  it('creates a docx only after approval of its exact bytes, and edits it in place', async () => {
    const { call, project } = await setup('ask-always');
    plan = [
      {
        name: 'create_document',
        args: {
          file_path: '/報告.docx',
          markdown: '# 季度報告\n\n營收成長**百分之十二**。',
        },
      },
    ];
    const events = run(call, 'd1');
    const approval = await nextApproval(call, 'd1');
    expect(approval.effect).toMatchObject({
      kind: 'write',
      operation: 'create',
      encoding: 'base64',
    });
    expect((approval.effect as { preview?: string }).preview).toContain(
      '# 季度報告',
    );
    await call(`/api/approvals/${approval.id}`, {
      method: 'POST',
      body: { decision: 'allow-once', contentHash: approval.contentHash },
    });
    expect(reply(await events)).toContain('Created');
    const bytes = readFileSync(join(project, '報告.docx'));
    expect(bytes.subarray(0, 2).toString()).toBe('PK');

    plan = [
      {
        name: 'edit_document',
        args: {
          file_path: '/報告.docx',
          replacements: [{ find: '百分之十二', replace: '百分之十五' }],
        },
      },
      { name: 'read_document', args: { file_path: '/報告.docx' } },
    ];
    const second = run(call, 'd2');
    const edit = await nextApproval(call, 'd2');
    expect(edit.before).toContain('**百分之十二**');
    expect((edit.effect as { preview?: string }).preview).toContain(
      '**百分之十五**',
    );
    await call(`/api/approvals/${edit.id}`, {
      method: 'POST',
      body: { decision: 'allow-once', contentHash: edit.contentHash },
    });
    const text = reply(await second);
    expect(text).toContain('Edited');
    // read_document ran in parallel with the (approval-pending) edit: it saw the old text.
    expect(text).toContain('營收成長**百分之十二**');
    expect(
      await toMarkdown(
        new Uint8Array(readFileSync(join(project, '報告.docx'))),
        'docx',
      ),
    ).toContain('營收成長**百分之十五**');

    // The change card restores binary documents too.
    const { changes } = (await (
      await call('/api/threads/d2/runs/d2-r/changes')
    ).json()) as { changes: { path: string; contentHash: string }[] };
    const restored = await call('/api/threads/d2/runs/d2-r/restore', {
      method: 'POST',
      body: {
        items: changes.map(({ path, contentHash }) => ({ path, contentHash })),
      },
    });
    expect(restored.status).toBe(200);
    expect(
      Buffer.compare(readFileSync(join(project, '報告.docx')), bytes),
    ).toBe(0);
  });
});

describe('restoring a turn', () => {
  it('shows the changes and puts every file back through the gate', async () => {
    const { call, project } = await setup('hands-off');
    plan = [
      {
        name: 'edit_file',
        args: {
          file_path: '/app.js',
          old_string: 'answer = 41',
          new_string: 'answer = 42',
        },
      },
      { name: 'write_file', args: { file_path: '/new.txt', content: 'hi\n' } },
    ];
    await run(call, 'r1');
    expect(readFileSync(join(project, 'new.txt'), 'utf8')).toBe('hi\n');

    type Change = {
      path: string;
      created: boolean;
      before: string | null;
      after: string | null;
      contentHash: string;
      modifiedSince: boolean;
    };
    const { changes } = (await (
      await call('/api/threads/r1/runs/r1-r/changes')
    ).json()) as { changes: Change[] };
    expect(changes).toHaveLength(2);
    const edit = changes.find((c) => c.path.endsWith('app.js'))!;
    expect(edit).toMatchObject({
      before: 'const answer = 41;\n',
      after: 'const answer = 42;\n',
      modifiedSince: false,
    });
    expect(changes.find((c) => c.path.endsWith('new.txt'))?.created).toBe(true);

    const items = changes.map((c) => ({
      path: c.path,
      contentHash: c.contentHash,
    }));
    // A plan that no longer matches what is on disk is refused.
    const stale = await call('/api/threads/r1/runs/r1-r/restore', {
      method: 'POST',
      body: {
        items: items.map((i) => ({ ...i, contentHash: '0'.repeat(64) })),
      },
    });
    expect(stale.status).toBe(409);
    expect(readFileSync(join(project, 'app.js'), 'utf8')).toContain('42');

    const restored = await call('/api/threads/r1/runs/r1-r/restore', {
      method: 'POST',
      body: { items },
    });
    expect(restored.status).toBe(200);
    expect(readFileSync(join(project, 'app.js'), 'utf8')).toBe(
      'const answer = 41;\n',
    );
    expect(() => readFileSync(join(project, 'new.txt'))).toThrow();
    const { receipts: list } = await receipts(call, 'r1');
    expect(
      list.filter((r) => r.actor === 'user').map((r) => r.outcome),
    ).toEqual(['not-run', 'succeeded', 'succeeded']);
    // The run's own change list is unchanged by the restore.
    const after = (await (
      await call('/api/threads/r1/runs/r1-r/changes')
    ).json()) as { changes: Change[] };
    expect(after.changes).toHaveLength(2);
  });
});

describe('memory', () => {
  it('remembers, finds in Chinese, forgets, and can be undone', async () => {
    const { call, rocky } = await setup('ask-when-needed');
    plan = [
      {
        name: 'remember',
        args: {
          title: '回覆偏好',
          content: '使用者希望用繁體中文、簡短地回覆。',
        },
      },
    ];
    expect(reply(await run(call, 'm1'))).toContain('Saved');
    expect(rocky.memory.list().map((m) => m.title)).toEqual(['回覆偏好']);

    // The next conversation sees the title in its system prompt and can search.
    plan = [{ name: 'search_memory', args: { query: '中文回覆' } }];
    expect(reply(await run(call, 'm2'))).toContain('簡短地回覆');
    const system = JSON.stringify(fake.requests.at(-1)?.messages[0]?.content);
    expect(system).toContain('回覆偏好');

    // Deleting a memory that existed before is an outside action: it always asks.
    plan = [{ name: 'forget', args: { title: '回覆偏好' } }];
    const forgetting = run(call, 'm3');
    const ask = await nextApproval(call, 'm3');
    expect(ask.reason).toBe('external');
    await call(`/api/approvals/${ask.id}`, {
      method: 'POST',
      body: { decision: 'allow-once', contentHash: ask.contentHash },
    });
    expect(reply(await forgetting)).toContain('Forgotten');
    expect(rocky.memory.list()).toEqual([]);

    // Forgetting was a receipted write: the turn's change card brings it back.
    const { changes } = (await (
      await call('/api/threads/m3/runs/m3-r/changes')
    ).json()) as { changes: { path: string; contentHash: string }[] };
    await call('/api/threads/m3/runs/m3-r/restore', {
      method: 'POST',
      body: {
        items: changes.map(({ path, contentHash }) => ({ path, contentHash })),
      },
    });
    expect(rocky.memory.list().map((m) => m.title)).toEqual(['回覆偏好']);

    // The settings page deletes through the gate too.
    const list = (await (await call('/api/memory')).json()) as {
      memories: { file: string; deleteHash: string }[];
    };
    const deleted = await call('/api/memory/delete', {
      method: 'POST',
      body: {
        file: list.memories[0]!.file,
        contentHash: list.memories[0]!.deleteHash,
      },
    });
    expect(deleted.status).toBe(200);
    expect(rocky.memory.list()).toEqual([]);
  }, 30_000);
});

describe('MCP tools', () => {
  it('asks for every call unless the user marks the tool read-only, and can turn one off', async () => {
    process.env['ROCKY_API_TOKEN'] = 'must-not-leak';
    const { call, rocky } = await setup('ask-when-needed');
    const saved = await call('/api/mcp/servers', {
      method: 'PUT',
      body: {
        servers: [
          {
            name: 'notes',
            transport: 'stdio',
            command: process.execPath,
            args: [join(import.meta.dirname, '../fixtures/mcp-server.ts')],
            env: { NOTE_TOKEN: 'n-1' },
          },
        ],
      },
    });
    expect(saved.status).toBe(200);
    const info = (await (await call('/api/mcp')).json()) as {
      servers: { env: Record<string, string> }[];
      status: { connected: boolean; tools: { name: string }[] }[];
    };
    // Saved values never go back to the browser.
    expect(info.servers[0]?.env['NOTE_TOKEN']).not.toBe('n-1');
    expect(info.status[0]).toMatchObject({ connected: true });
    expect(info.status[0]?.tools.map((t) => t.name).sort()).toEqual([
      'echo',
      'env',
    ]);

    // Default: an outside action, so it asks.
    plan = [{ name: 'mcp__notes__echo', args: { text: '你好' } }];
    const first = run(call, 'p1');
    const ask = await nextApproval(call, 'p1');
    expect(ask.effect).toMatchObject({
      kind: 'mcp',
      server: 'notes',
      tool: 'echo',
    });
    await call(`/api/approvals/${ask.id}`, {
      method: 'POST',
      body: { decision: 'allow-once', contentHash: ask.contentHash },
    });
    expect(reply(await first)).toContain('echo: 你好');
    expect(rocky.receipts.forThread('p1')[0]).toMatchObject({
      outcome: 'succeeded',
    });

    // Marked read-only: runs without asking; the server never sees Rocky's variables.
    await call('/api/mcp/tools', {
      method: 'PUT',
      body: { server: 'notes', tool: 'env', policy: 'read-only' },
    });
    plan = [{ name: 'mcp__notes__env', args: {} }];
    const env = reply(await run(call, 'p2'));
    expect(env).toContain('"rockyKeys":[]');
    expect(env).toContain('"note":"n-1"');

    // Turned off: refused without asking.
    await call('/api/mcp/tools', {
      method: 'PUT',
      body: { server: 'notes', tool: 'echo', policy: 'deny' },
    });
    plan = [{ name: 'mcp__notes__echo', args: { text: 'x' } }];
    expect(reply(await run(call, 'p3'))).toContain('turned off');
    await rocky.mcp.close();
    delete process.env['ROCKY_API_TOKEN'];
  }, 60_000);
});

describe('project instructions and the subagent', () => {
  it("reads the project's AGENTS.md into the system prompt", async () => {
    const { call, project } = await setup('ask-when-needed');
    writeFileSync(
      join(project, 'AGENTS.md'),
      '# 規則\n\n測試一律用 node --test。\n',
    );
    plan = [];
    await run(call, 'a1');
    const system = JSON.stringify(fake.requests.at(-1)?.messages[0]?.content);
    expect(system).toContain('測試一律用 node --test。');
  });

  it('lets the research subagent read but not change anything', async () => {
    const { call, project } = await setup('hands-off');
    plan = [
      {
        name: 'task',
        args: { description: 'look around', subagent_type: 'general-purpose' },
      },
    ];
    subPlan = [
      { name: 'read_file', args: { file_path: '/app.js' } },
      { name: 'write_file', args: { file_path: '/sub.txt', content: 'x' } },
    ];
    const text = reply(await run(call, 's1'));
    expect(text).toContain('const answer = 41;');
    expect(text).toContain('read-only');
    expect(() => readFileSync(join(project, 'sub.txt'))).toThrow();
    subPlan = [];
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
