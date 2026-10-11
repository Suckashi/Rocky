import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolMessage } from '@langchain/core/messages';
import { GraphInterrupt } from '@langchain/langgraph';
import { tool } from 'langchain';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createGateMiddleware } from '../../src/server/agent/gate-middleware.ts';
import { ToolRegistry } from '../../src/server/agent/registry.ts';
import { testRocky } from '../fixtures/rocky.ts';

// The gate middleware is the one place a tool call's failure is handled (ADR 0027).
function setup(signal = new AbortController().signal) {
  const dir = mkdtempSync(join(tmpdir(), 'rocky-mw-'));
  const project = join(dir, 'project');
  mkdirSync(project);
  mkdirSync(join(dir, 'data'));
  const { rocky } = testRocky({ dataDir: join(dir, 'data'), port: 4330 });
  rocky.settings.setProject(project);
  rocky.settings.setMode('hands-off');
  const tools = new ToolRegistry(() => ({ error: 'unregistered' }))
    .judge('fake_write', () => ({
      effect: {
        kind: 'write',
        path: join(project, 'a.txt'),
        operation: 'create',
        content: 'x',
      },
    }))
    .judge('fake_read', () => ({
      effect: { kind: 'read', path: join(project, 'a.txt') },
    }))
    .judge('fake_none', () => ({ none: true }));
  const mw = createGateMiddleware(
    {
      gate: rocky.gate,
      receipts: rocky.receipts,
      tools,
      threadId: 't1',
      runId: 'r1',
      signal,
    },
    'rocky',
  );
  const call = (
    name: string,
    handler: () => Promise<unknown>,
    extra: Record<string, unknown> = {},
  ) =>
    (
      mw.wrapToolCall as unknown as (
        request: unknown,
        handler: () => Promise<unknown>,
      ) => Promise<unknown>
    )({ toolCall: { name, args: {}, id: 'c1' }, ...extra }, handler);
  return { rocky, call };
}

describe('gate middleware failures', () => {
  it('withdraws the pass and marks the receipt not run when a write never reaches the executor', async () => {
    const { rocky, call } = setup();
    const result = await call(
      'fake_write',
      async () => new ToolMessage({ tool_call_id: 'c1', content: 'gave up' }),
    );
    expect(result).toBeInstanceOf(ToolMessage);
    expect(rocky.gate.passes.outstanding).toBe(0);
    expect(rocky.receipts.forThread('t1')).toMatchObject([
      { outcome: 'not-run', detail: 'the tool did not run' },
    ]);
  });

  it('turns a thrown tool error into an error result the model can read', async () => {
    const { rocky, call } = setup();
    for (const name of ['fake_write', 'fake_read', 'fake_none']) {
      const result = (await call(name, async () => {
        throw new Error('EBUSY: file is open in another program');
      })) as ToolMessage;
      expect(result.status).toBe('error');
      expect(String(result.content)).toContain('EBUSY');
    }
    expect(rocky.gate.passes.outstanding).toBe(0);
    // The write never reached the executor: not run. The read may have acted: unknown.
    expect(
      rocky.receipts
        .forThread('t1')
        .map((r) => r.outcome)
        .sort(),
    ).toEqual(['not-run']);
  });

  it('lets Stop and LangGraph control flow pass through', async () => {
    const controller = new AbortController();
    const { call } = setup(controller.signal);
    await expect(
      call('fake_none', async () => {
        throw new GraphInterrupt();
      }),
    ).rejects.toBeInstanceOf(GraphInterrupt);
    controller.abort();
    await expect(
      call('fake_none', async () => {
        throw new Error('stopped');
      }),
    ).rejects.toThrow('stopped');
  });

  it("refuses arguments the tool's own schema rejects before anyone is asked", async () => {
    const { rocky, call } = setup();
    let ran = false;
    const strict = tool(async () => 'ok', {
      name: 'fake_write',
      description: 'x',
      schema: z.object({ seconds: z.number().max(600) }),
    });
    const result = (await (
      call as unknown as (
        name: string,
        handler: () => Promise<unknown>,
        extra: Record<string, unknown>,
      ) => Promise<unknown>
    )(
      'fake_write',
      async () => {
        ran = true;
        return 'ran';
      },
      {
        tool: strict,
        toolCall: { name: 'fake_write', args: { seconds: 900 }, id: 'c1' },
      },
    )) as ToolMessage;
    expect(ran).toBe(false);
    expect(String(result.content)).toContain(
      'invalid arguments for fake_write',
    );
    expect(rocky.receipts.forThread('t1')).toEqual([]);
  });
});
