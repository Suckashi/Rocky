// Memory API for the settings page: list, and delete through the gate (receipted, undoable).
import { join } from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Executor } from '../../effects/execute.ts';
import type { Gate } from '../../effects/gate.ts';
import { contentHash } from '../../effects/hash.ts';
import type { Effect } from '../../effects/types.ts';
import type { MemoryStore } from '../../memory/store.ts';

/** Deletions from the settings page are recorded under this pseudo-thread. */
export const MEMORY_THREAD = 'memory';

const deletion = (
  memory: MemoryStore,
  file: string,
): Extract<Effect, { kind: 'write' }> => ({
  kind: 'write',
  path: join(memory.dir, file),
  operation: 'delete',
});

export function memoryRoutes(deps: {
  memory: MemoryStore;
  gate: Gate;
  executor: Executor;
}): Hono {
  const { memory, gate, executor } = deps;
  const app = new Hono();
  app.get('/memory', (c) =>
    c.json({
      dir: memory.dir,
      memories: memory.list().map((m) => ({
        ...m,
        deleteHash: contentHash(deletion(memory, m.file)),
      })),
    }),
  );
  app.post('/memory/delete', async (c) => {
    const parsed = z
      .object({
        file: z.string().regex(/^[^\\/]+\.md$/),
        contentHash: z.string(),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid-memory' }, 400);
    if (!memory.get(parsed.data.file))
      return c.json({ error: 'not-found' }, 404);
    const effect = deletion(memory, parsed.data.file);
    const result = gate.userAction(
      effect,
      { threadId: MEMORY_THREAD, runId: `memory:${Date.now()}`, actor: 'user' },
      parsed.data.contentHash,
      memory.dir,
    );
    if (!result.allowed) return c.json({ error: result.message }, 409);
    executor.write(result.pass, effect);
    return c.json({ ok: true, runId: result.receipt?.runId ?? null });
  });
  return app;
}
