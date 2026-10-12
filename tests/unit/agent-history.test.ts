import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import {
  INTERRUPTED_TOOL_RESULT,
  toLangChain,
} from '../../src/server/agent/rocky-agent.ts';

describe('history sent to the model', () => {
  it('answers tool calls left without a result by a stopped turn', () => {
    const out = toLangChain([
      { id: 'u1', role: 'user', content: 'fix it' },
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"file_path":"/a"}' },
          },
          {
            id: 'c2',
            type: 'function',
            function: { name: 'run_command', arguments: '{"argv":["npm"]}' },
          },
        ],
      },
      { id: 't1', role: 'tool', toolCallId: 'c1', content: 'file text' },
      { id: 'u2', role: 'user', content: 'continue' },
    ]);
    const tools = out.filter((m): m is ToolMessage => m instanceof ToolMessage);
    expect(tools.map((m) => [m.tool_call_id, m.content])).toEqual([
      ['c2', INTERRUPTED_TOOL_RESULT],
      ['c1', 'file text'],
    ]);
    expect(out.map((m) => m.getType())).toEqual([
      'human',
      'ai',
      'tool',
      'tool',
      'human',
    ]);
  });

  it('keeps a history whose tool-call arguments were cut off mid-stream', () => {
    const out = toLangChain([
      { id: 'u1', role: 'user', content: 'write it' },
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'c1',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: '{"file_path":"/a","co',
            },
          },
          {
            id: 'c2',
            type: 'function',
            function: { name: 'ls', arguments: '[1]' },
          },
        ],
      },
      { id: 'u2', role: 'user', content: 'go on' },
    ]);
    const ai = out[1] as AIMessage;
    expect(ai.tool_calls?.map((c) => [c.id, c.args])).toEqual([
      ['c1', {}],
      ['c2', {}],
    ]);
    // Each call still gets a result, so the model accepts the history.
    expect(
      out
        .filter((m): m is ToolMessage => m instanceof ToolMessage)
        .map((m) => m.tool_call_id),
    ).toEqual(['c1', 'c2']);
  });

  it("leaves out the research subagent's own messages; its report is the task result", () => {
    const sub = { subagentRunId: 'sub-1' };
    const out = toLangChain([
      { id: 'u1', role: 'user', content: 'research it' },
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'task1',
            type: 'function',
            function: { name: 'task', arguments: '{"description":"look"}' },
          },
        ],
      },
      {
        id: 's1',
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'r1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"file_path":"/a"}' },
          },
        ],
        ...sub,
      },
      {
        id: 's2',
        role: 'tool',
        toolCallId: 'r1',
        content: 'x'.repeat(50_000),
        ...sub,
      },
      {
        id: 's3',
        role: 'assistant',
        content: 'Found it in /a.',
        ...sub,
      },
      { id: 't1', role: 'tool', toolCallId: 'task1', content: 'Report: /a' },
      { id: 'a2', role: 'assistant', content: 'It is in /a.' },
      { id: 'u2', role: 'user', content: 'thanks, now fix it' },
    ] as Parameters<typeof toLangChain>[0]);
    expect(out.map((m) => m.getType())).toEqual([
      'human',
      'ai',
      'tool',
      'ai',
      'human',
    ]);
    expect(JSON.stringify(out.map((m) => m.content))).not.toContain('xxxx');
  });

  it('a subagent call closed by Stop leaves no result without its call', () => {
    const sub = { subagentRunId: 'sub-1' };
    const out = toLangChain([
      { id: 'u1', role: 'user', content: 'research it' },
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'task1',
            type: 'function',
            function: { name: 'task', arguments: '{}' },
          },
        ],
      },
      {
        id: 's1',
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'call_s',
            type: 'function',
            function: { name: 'read_file', arguments: '{}' },
          },
        ],
        ...sub,
      },
      // Stop closes every open call with an untagged result.
      { id: 'r1', role: 'tool', toolCallId: 'call_s', content: 'stopped' },
      { id: 'r2', role: 'tool', toolCallId: 'task1', content: 'stopped' },
      { id: 'u2', role: 'user', content: 'go on' },
    ] as Parameters<typeof toLangChain>[0]);
    expect(out.map((m) => m.getType())).toEqual([
      'human',
      'ai',
      'tool',
      'human',
    ]);
    expect(
      out.flatMap((m) => (m instanceof ToolMessage ? [m.tool_call_id] : [])),
    ).toEqual(['task1']);
  });
});
