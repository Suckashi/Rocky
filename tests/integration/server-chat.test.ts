import { readFileSync, statSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RockyAgent } from '../../src/server/agent/rocky-agent.ts';
import { RockyAgentRunner } from '../../src/server/agent/runner.ts';
import { createApp } from '../../src/server/http/app.ts';
import { copilotRoutes } from '../../src/server/http/copilot.ts';
import { LoginCodes } from '../../src/server/http/login-codes.ts';
import { settingsRoutes } from '../../src/server/http/routes/settings.ts';
import { threadRoutes } from '../../src/server/http/routes/threads.ts';
import { EgressGuard } from '../../src/server/platform/egress.ts';
import { openDatabase } from '../../src/server/store/db.ts';
import { SettingsStore } from '../../src/server/store/settings.ts';
import { ThreadStore } from '../../src/server/store/threads.ts';
import {
  startFakeOpenAI,
  type FakeOpenAI,
} from '../../spikes/s2-agent/fake-openai.ts';

const PORT = 4317;
const HOST = `127.0.0.1:${PORT}`;
const token = 't'.repeat(43);
const REPLY = '你好，我是 Rocky，有什麼可以幫你？';

function server(dir: string) {
  const db = openDatabase(join(dir, 'rocky.sqlite'));
  const threads = new ThreadStore(db);
  const settings = new SettingsStore(db, dir);
  const runner = new RockyAgentRunner(threads);
  const egress = new EgressGuard(() => {});
  const app = createApp({
    token,
    codes: new LoginCodes(),
    port: PORT,
    api: [
      settingsRoutes(settings, egress, async () => ['m1', 'm2']),
      threadRoutes(threads, runner),
    ],
    mounted: [copilotRoutes(new RockyAgent({ settings }), runner)],
  });
  const call = (path: string, init: { method?: string; body?: unknown } = {}) =>
    app.request(`http://${HOST}${path}`, {
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
  return { call, settings, threads };
}

async function sseEvents(
  res: Response,
): Promise<{ type: string; [k: string]: unknown }[]> {
  const text = await res.text();
  return text
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => JSON.parse(line.slice(5).trim()) as { type: string });
}

const runInput = (threadId: string, runId: string, text: string) => ({
  threadId,
  runId,
  messages: [{ id: `${runId}-u`, role: 'user', content: text }],
  tools: [],
  context: [],
  state: {},
  forwardedProps: {},
});

describe('chat through the local server', () => {
  let fake: FakeOpenAI;
  beforeAll(async () => {
    fake = await startFakeOpenAI(() => ({ text: REPLY }));
  });
  afterAll(() => fake.close());

  it('reports telemetry as disabled and lists the rocky agent', async () => {
    const { call } = server(mkdtempSync(join(tmpdir(), 'rocky-int-')));
    const info = (await (await call('/api/copilotkit/info')).json()) as Record<
      string,
      unknown
    >;
    expect(info['telemetryDisabled']).toBe(true);
    expect(JSON.stringify(info['agents'])).toContain('rocky');
  });

  it('streams a reply from the configured model and keeps the conversation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rocky-int-'));
    const { call } = server(dir);
    const saved = await call('/api/settings/model', {
      method: 'PUT',
      body: {
        provider: 'openai-compatible',
        baseURL: fake.baseURL,
        model: 'fake',
        apiKey: 'sk-secret',
      },
    });
    const body = (await saved.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      locale: 'zh-TW',
      model: { model: 'fake', hasApiKey: true },
    });
    expect(JSON.stringify(body)).not.toContain('sk-secret');

    const res = await call('/api/copilotkit/agent/rocky/run', {
      method: 'POST',
      body: runInput('t1', 'r1', '你好'),
    });
    expect(res.status).toBe(200);
    const events = await sseEvents(res);
    expect(events[0]?.type).toBe('RUN_STARTED');
    expect(events.at(-1)?.type).toBe('RUN_FINISHED');
    const text = events
      .filter((e) => e.type === 'TEXT_MESSAGE_CONTENT')
      .map((e) => e['delta'])
      .join('');
    expect(text).toBe(REPLY);

    // The model saw Rocky's system prompt and the user's message.
    const request = fake.requests.at(-1)!;
    expect(request.messages[0]?.role).toBe('system');
    expect(JSON.stringify(request.messages)).toContain('你好');

    const list = (await (
      await call('/api/copilotkit/threads?agentId=rocky')
    ).json()) as {
      threads: { id: string; name: string }[];
    };
    expect(list.threads).toMatchObject([{ id: 't1', name: '你好' }]);
    const history = (await (
      await call('/api/copilotkit/threads/t1/messages')
    ).json()) as {
      messages: { role: string; content?: string }[];
    };
    expect(history.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(history.messages[1]?.content).toBe(REPLY);
  });

  it('ends a run with a clear error when no model is configured', async () => {
    const { call, threads } = server(mkdtempSync(join(tmpdir(), 'rocky-int-')));
    const res = await call('/api/copilotkit/agent/rocky/run', {
      method: 'POST',
      body: runInput('t2', 'r1', 'hi'),
    });
    const events = await sseEvents(res);
    expect(events.map((e) => e.type)).toEqual(['RUN_STARTED', 'RUN_ERROR']);
    expect(events[1]).toMatchObject({ code: 'model-not-configured' });
    expect(threads.runs('t2')[0]).toMatchObject({
      outcome: 'failed',
      error: 'model-not-configured',
    });
  });

  it('keeps the API key out of the database and in a user-only file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rocky-int-'));
    const { call } = server(dir);
    await call('/api/settings/model', {
      method: 'PUT',
      body: {
        provider: 'ollama',
        baseURL: 'http://127.0.0.1:11434/v1',
        model: 'qwen',
        apiKey: 'sk-local',
      },
    });
    expect(readFileSync(join(dir, 'rocky.sqlite')).includes('sk-local')).toBe(
      false,
    );
    expect(readFileSync(join(dir, 'secrets.json'), 'utf8')).toContain(
      'sk-local',
    );
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, 'secrets.json')).mode & 0o077).toBe(0);
    }
  });

  it('lists models from an endpoint and renames and deletes conversations', async () => {
    const { call, threads } = server(mkdtempSync(join(tmpdir(), 'rocky-int-')));
    const tested = await call('/api/settings/model/test', {
      method: 'POST',
      body: {
        provider: 'openai-compatible',
        baseURL: 'https://api.example.test/v1',
      },
    });
    expect(await tested.json()).toEqual({ ok: true, models: ['m1', 'm2'] });
    threads.ensureThread('t3', 'rocky');
    expect(
      (
        await call('/api/threads/t3', {
          method: 'PATCH',
          body: { name: '新名字' },
        })
      ).status,
    ).toBe(200);
    expect(threads.thread('t3')?.name).toBe('新名字');
    expect(
      (await call('/api/threads/t3', { method: 'DELETE', body: {} })).status,
    ).toBe(200);
    expect(threads.thread('t3')).toBeUndefined();
  });
});

describe('outbound allowlist', () => {
  it('blocks telemetry and other hosts, allows loopback and chosen endpoints', async () => {
    const guard = new EgressGuard(() => {});
    const fetchImpl = guard.wrap(async () => new Response('ok'));
    await expect(
      fetchImpl('https://telemetry.copilotkit.ai/ingest'),
    ).rejects.toThrow('egress-blocked');
    await expect(
      fetchImpl('https://api.smith.langchain.com/runs'),
    ).rejects.toThrow('egress-blocked');
    expect(
      await (await fetchImpl('http://127.0.0.1:11434/v1/models')).text(),
    ).toBe('ok');
    guard.allow('https://api.commandcode.ai/provider/v1');
    expect(
      await (
        await fetchImpl('https://api.commandcode.ai/provider/v1/models')
      ).text(),
    ).toBe('ok');
    expect(guard.blocked).toEqual([
      'telemetry.copilotkit.ai',
      'api.smith.langchain.com',
    ]);
  });
});
