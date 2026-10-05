import { ToolMessage } from '@langchain/core/messages';
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
});
