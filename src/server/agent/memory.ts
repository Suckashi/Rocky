// Memory tools. remember/forget are file writes in the memory folder, judged by the gate
// with that folder as their root: receipted, snapshotted and undoable like any change.
import { existsSync } from 'node:fs';
import { tool } from 'langchain';
import { z } from 'zod';
import type { Executor } from '../effects/execute.ts';
import type { Effect } from '../effects/types.ts';
import { memoryMarkdown, type MemoryStore } from '../memory/store.ts';
import { currentEffect, currentPass } from './backend.ts';
import type { ToolEffect } from './workspace.ts';

export const MEMORY_WRITE_TOOLS = new Set(['remember', 'forget']);
export const MEMORY_READ_TOOLS = new Set(['search_memory']);

export function memoryEffect(
  name: string,
  args: Record<string, unknown>,
  memory: MemoryStore,
): ToolEffect {
  const title = String(args['title'] ?? '').trim();
  if (!title) return { error: 'Error: a memory needs a title.' };
  const path = memory.pathFor(title);
  const exists = existsSync(path);
  const before = exists
    ? memory.get(path.slice(memory.dir.length + 1))?.content
    : undefined;
  if (name === 'forget') {
    if (!exists) return { error: `Error: no memory titled "${title}".` };
    return {
      effect: { kind: 'write', path, operation: 'delete' },
      ...(before ? { before } : {}),
    };
  }
  const effect: Effect = {
    kind: 'write',
    path,
    operation: exists ? 'edit' : 'create',
    content: memoryMarkdown(title, String(args['content'] ?? '')),
  };
  return { effect, ...(before ? { before } : {}) };
}

export function memoryPrompt(memory: MemoryStore): string {
  const titles = memory
    .list()
    .slice(0, 50)
    .map((m) => `- ${m.title}`);
  return titles.length
    ? `Saved memories (use search_memory to read them when relevant):\n${titles.join('\n')}`
    : 'No memories are saved yet.';
}

export function createMemoryTools(memory: MemoryStore, executor: Executor) {
  const write = (verb: string) => () => {
    const pass = currentPass.getStore();
    const effect = currentEffect.getStore();
    if (!pass || effect?.kind !== 'write')
      return 'Error: no approval for this memory.';
    executor.write(pass, effect);
    return `${verb}.`;
  };
  return [
    tool(write('Saved'), {
      name: 'remember',
      description:
        "Save something worth remembering across conversations (the user's preferences, facts about their projects). " +
        'Only when the user asks you to remember, or clearly states a lasting preference. A memory with the same title is replaced.',
      schema: z.object({
        title: z.string().min(1).max(120),
        content: z.string().min(1).max(20_000),
      }),
    }),
    tool(write('Forgotten'), {
      name: 'forget',
      description:
        'Delete the memory with this exact title, when the user asks you to forget it.',
      schema: z.object({ title: z.string().min(1).max(120) }),
    }),
    tool(
      async ({ query }) => {
        const found = memory.search(query);
        if (found.length === 0) return 'No matching memories.';
        return found.map((m) => m.content.trim()).join('\n\n---\n\n');
      },
      {
        name: 'search_memory',
        description:
          'Search saved memories (Chinese and English) and return the best matches in full.',
        schema: z.object({ query: z.string().min(1).max(500) }),
      },
    ),
  ];
}
