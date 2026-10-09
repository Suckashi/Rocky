import { tool } from 'langchain';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../../src/server/agent/registry.ts';

const make = (name: string) =>
  tool(async () => 'ok', { name, description: name, schema: z.object({}) });

describe('tool registry', () => {
  it('judges each call with the judge its tool was registered with', async () => {
    const tools = new ToolRegistry(() => ({ error: 'unregistered' }))
      .add(make('a'), () => ({ none: true }))
      .add(make('b'), (args) => ({
        effect: { kind: 'read', path: String(args['path']) },
      }))
      .judge('ls', () => ({ error: 'no project' }));
    expect(await tools.effectOf('a', {})).toEqual({ none: true });
    expect(await tools.effectOf('b', { path: '/x' })).toEqual({
      effect: { kind: 'read', path: '/x' },
    });
    expect(await tools.effectOf('ls', {})).toEqual({ error: 'no project' });
  });

  it('sends a tool nobody registered to the fallback, with its name', () => {
    const tools = new ToolRegistry((name) => ({ error: `unknown ${name}` }));
    expect(tools.effectOf('made_up', {})).toEqual({ error: 'unknown made_up' });
  });

  it('offers only its own tools, in registration order', () => {
    const tools = new ToolRegistry(() => ({ none: true }))
      .add(make('second'), () => ({ none: true }))
      .judge('ls', () => ({ none: true }))
      .add(make('first'), () => ({ none: true }));
    expect(tools.tools().map((t) => (t as { name: string }).name)).toEqual([
      'second',
      'first',
    ]);
  });
});
