import { beforeAll, describe, expect, it } from 'vitest';
import type { BaseEvent } from '@ag-ui/core';
import { runS2, type S2Report } from '../../spikes/s2-agent/scenario.ts';

const types = (events: BaseEvent[]) => events.map((event) => event.type);
const field = (event: BaseEvent, key: string) =>
  (event as unknown as Record<string, unknown>)[key];

describe('S2: Deep Agents + ChatOpenAI + action gate + AG-UI', () => {
  let report: S2Report;
  beforeAll(async () => {
    report = await runS2();
  }, 60_000);

  it('emits only events that pass the AG-UI 1.0 schemas', () => {
    expect(report.schemaErrors).toEqual([]);
  });

  it('pauses before writes and writes nothing until approved', () => {
    const first = report.runs[0]!;
    expect(first.interrupts).toHaveLength(2);
    const finished = first.events.at(-1)!;
    expect(field(finished, 'outcome')).toMatchObject({ type: 'interrupt' });
  });

  it('gates the subagent too and executes every approved write exactly once', () => {
    expect(report.writes).toEqual([
      '/notes.md',
      '/todo.md',
      '/sub.md',
      '/rerun.md',
    ]);
    expect(report.files).toEqual({
      'notes.md': '# 筆記\n\n第一行中文。\n',
      'todo.md': '- 待辦\n',
      'sub.md': '子任務\n',
    });
    const subagentApproval = report.runs[1]!.interrupts;
    expect(subagentApproval).toHaveLength(1);
  });

  it('reports the subagent lifecycle and its result to the parent', () => {
    const all = report.runs.flatMap((run) => run.events);
    expect(types(all)).toContain('SUBAGENT_STARTED');
    expect(types(all)).toContain('SUBAGENT_FINISHED');
  });

  it('does not re-run an auto-allowed command when resuming a sibling approval', () => {
    expect(report.commandRunsBeforeResume).toBe(1);
    expect(report.commandRunsAfterResume).toBe(1);
  });

  it('turns a rejection into feedback and keeps the turn going', () => {
    expect(report.rejectFileExists).toBe(false);
    expect(report.gateLog.some((entry) => entry.decision === 'rejected')).toBe(
      true,
    );
    const last = report.rejectRuns.at(-1)!;
    expect(field(last.events.at(-1)!, 'outcome')).toMatchObject({
      type: 'success',
    });
  });

  it('sends the Rocky base prompt and the todo tool to every model', () => {
    expect(report.systemPromptHead).toContain('You are Rocky');
    expect(report.toolNames).toContain('write_todos');
  });

  it('reports cached input tokens', () => {
    const finished = report.runs[0]!.events.at(-1)!;
    expect(field(finished, 'usage')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cachedInputTokens: 1024 }),
      ]),
    );
  });

  it('makes no network request outside 127.0.0.1', () => {
    expect(report.externalRequests).toEqual([]);
  });
});
