import {
  AbstractAgent,
  EventType,
  type BaseEvent,
  type RunAgentInput,
} from '@ag-ui/client';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { firstValueFrom, Observable, toArray } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { RockyAgentRunner } from '../../src/server/agent/runner.ts';
import { openDatabase } from '../../src/server/store/db.ts';
import { ThreadStore } from '../../src/server/store/threads.ts';

/** Replies with a fixed text, or fails, or waits until aborted. */
class ScriptedAgent extends AbstractAgent {
  mode: 'reply' | 'fail' | 'hang' = 'reply';
  reply = '你好，我是 Roko。';
  override clone(): ScriptedAgent {
    const copy = new ScriptedAgent({ agentId: this.agentId ?? 'rocky' });
    copy.mode = this.mode;
    copy.reply = this.reply;
    return copy;
  }
  private abort?: () => void;
  override abortRun(): void {
    this.abort?.();
  }
  override run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((sub) => {
      this.abort = () => sub.error(new Error('aborted'));
      sub.next({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent);
      if (this.mode === 'fail') {
        sub.error(new Error('model unreachable'));
        return;
      }
      const messageId = `${input.runId}-reply`;
      sub.next({
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role: 'assistant',
      } as BaseEvent);
      sub.next({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta: this.reply,
      } as BaseEvent);
      if (this.mode === 'hang') return; // completes only when aborted
      sub.next({ type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent);
      sub.next({
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent);
      sub.complete();
    });
  }
}

function open() {
  const path = join(mkdtempSync(join(tmpdir(), 'rocky-db-')), 'rocky.sqlite');
  const store = new ThreadStore(openDatabase(path));
  return { path, store, runner: new RockyAgentRunner(store) };
}

const input = (
  threadId: string,
  runId: string,
  text: string,
): RunAgentInput => ({
  threadId,
  runId,
  messages: [{ id: `${runId}-user`, role: 'user', content: text }],
  tools: [],
  context: [],
  state: {},
  forwardedProps: {},
});

async function runOnce(
  runner: RockyAgentRunner,
  agent: ScriptedAgent,
  i: RunAgentInput,
) {
  return firstValueFrom(
    runner.run({ threadId: i.threadId, agent, input: i }).pipe(toArray()),
  );
}

const types = (events: BaseEvent[]) => events.map((e) => e.type);

describe('RockyAgentRunner', () => {
  it('streams a run, stores it, and names the thread from the first message', async () => {
    const { store, runner } = open();
    const events = await runOnce(
      runner,
      new ScriptedAgent({ agentId: 'rocky' }),
      input('t1', 'r1', '幫我整理今天的待辦'),
    );
    expect(types(events)).toEqual([
      'RUN_STARTED',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
      'RUN_FINISHED',
    ]);
    expect(store.runs('t1').map((r) => r.outcome)).toEqual(['succeeded']);
    expect(runner.listThreads()).toMatchObject([
      { id: 't1', name: '幫我整理今天的待辦', agentId: 'rocky' },
    ]);
  });

  it('replays history after a restart (new runner, same database)', async () => {
    const { path, runner } = open();
    await runOnce(
      runner,
      new ScriptedAgent({ agentId: 'rocky' }),
      input('t1', 'r1', '第一句'),
    );
    const restarted = new RockyAgentRunner(new ThreadStore(openDatabase(path)));
    const replay = await firstValueFrom(
      restarted.connect({ threadId: 't1' }).pipe(toArray()),
    );
    const content = replay.filter(
      (e) => e.type === EventType.TEXT_MESSAGE_CONTENT,
    );
    expect(
      content.map((e) => (e as unknown as { delta: string }).delta).join(''),
    ).toBe('你好，我是 Roko。');
    expect(replay.some((e) => e.type === EventType.RUN_STARTED)).toBe(true);
    expect(restarted.getThreadEvents('t1').length).toBeGreaterThan(0);
  });

  it('records a failed run as failed, with the error, and still closes the stream', async () => {
    const { store, runner } = open();
    const agent = new ScriptedAgent({ agentId: 'rocky' });
    agent.mode = 'fail';
    const events = await runOnce(runner, agent, input('t1', 'r1', 'hi'));
    expect(types(events)).toContain('RUN_ERROR');
    expect(store.runs('t1')[0]).toMatchObject({
      outcome: 'failed',
      error: 'model unreachable',
    });
    expect(await runner.isRunning({ threadId: 't1' })).toBe(false);
  });

  it('stops a running run and refuses a second concurrent run on the thread', async () => {
    const { store, runner } = open();
    const agent = new ScriptedAgent({ agentId: 'rocky' });
    agent.mode = 'hang';
    const done = firstValueFrom(
      runner
        .run({ threadId: 't1', agent, input: input('t1', 'r1', 'hi') })
        .pipe(toArray()),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(await runner.isRunning({ threadId: 't1' })).toBe(true);
    expect(() =>
      runner.run({ threadId: 't1', agent, input: input('t1', 'r2', 'again') }),
    ).toThrow('Thread already running');
    expect(await runner.stop({ threadId: 't1', runId: 'other' })).toBe(false);
    expect(await runner.stop({ threadId: 't1' })).toBe(true);
    await done;
    expect(store.runs('t1')[0]).toMatchObject({
      outcome: 'failed',
      error: 'stopped',
    });
  });

  it('leaves a run interrupted by a crash as unknown, never succeeded', () => {
    const { store } = open();
    store.ensureThread('t1', 'rocky');
    store.startRun({
      id: 'r1',
      threadId: 't1',
      agentId: 'rocky',
      parentRunId: null,
    });
    expect(store.runs('t1')[0]!.outcome).toBe('unknown');
    expect(store.interruptedRuns()).toEqual([{ id: 'r1', threadId: 't1' }]);
  });

  it('ignores the runtime clear-all endpoint; deleting is per thread', async () => {
    const { store, runner } = open();
    await runOnce(
      runner,
      new ScriptedAgent({ agentId: 'rocky' }),
      input('t1', 'r1', 'hi'),
    );
    runner.clearThreads();
    expect(runner.listThreads()).toHaveLength(1);
    expect(store.remove('t1')).toBe(true);
    expect(runner.listThreads()).toHaveLength(0);
    expect(store.runs('t1')).toHaveLength(0);
  });
});
