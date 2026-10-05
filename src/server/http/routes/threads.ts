// Rename and delete conversations. Listing and history come from the CopilotKit runtime
// through RockyAgentRunner's local thread endpoints.
import { Hono } from 'hono';
import { z } from 'zod';
import type { RockyAgentRunner } from '../../agent/runner.ts';
import type { ThreadStore } from '../../store/threads.ts';

export function threadRoutes(
  store: ThreadStore,
  runner: RockyAgentRunner,
): Hono {
  const app = new Hono();
  app.patch('/threads/:id', async (c) => {
    const parsed = z
      .object({ name: z.string().trim().min(1).max(80) })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid-name' }, 400);
    return store.rename(c.req.param('id'), parsed.data.name)
      ? c.json(store.thread(c.req.param('id')))
      : c.json({ error: 'not-found' }, 404);
  });
  app.delete('/threads/:id', async (c) => {
    const id = c.req.param('id');
    if (await runner.isRunning({ threadId: id }))
      return c.json({ error: 'running' }, 409);
    return store.remove(id)
      ? c.json({ ok: true })
      : c.json({ error: 'not-found' }, 404);
  });
  return app;
}
