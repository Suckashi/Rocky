// Approvals, modes and receipts. The decision is Rocky's: it is checked against the content
// hash the user saw, recorded in a receipt, and only then is a pass issued.
import { Hono } from 'hono';
import { z } from 'zod';
import type { Gate } from '../../effects/gate.ts';
import type { ReceiptStore } from '../../effects/receipts.ts';
import type { SnapshotStore } from '../../effects/snapshots.ts';

const answer = z.discriminatedUnion('decision', [
  z
    .object({ decision: z.literal('allow-once'), contentHash: z.string() })
    .strict(),
  z
    .object({ decision: z.literal('allow-session'), contentHash: z.string() })
    .strict(),
  z
    .object({
      decision: z.literal('reject'),
      contentHash: z.string(),
      reason: z.string().max(1000).optional(),
    })
    .strict(),
]);

export function approvalRoutes(
  gate: Gate,
  receipts: ReceiptStore,
  snapshots: SnapshotStore,
): Hono {
  const app = new Hono();
  app.get('/threads/:id/approvals', (c) => {
    const id = c.req.param('id');
    return c.json({ mode: gate.mode(id), pending: gate.pending(id) });
  });
  app.post('/approvals/:id', async (c) => {
    const parsed = answer.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid-decision' }, 400);
    const body = parsed.data;
    const decision =
      body.decision === 'reject'
        ? {
            decision: 'reject' as const,
            contentHash: body.contentHash,
            ...(body.reason !== undefined ? { reason: body.reason } : {}),
          }
        : { decision: body.decision, contentHash: body.contentHash };
    return gate.answer(c.req.param('id'), decision)
      ? c.json({ ok: true })
      : c.json({ error: 'not-pending' }, 409);
  });
  app.put('/threads/:id/mode', async (c) => {
    const parsed = z
      .object({ mode: z.enum(['ask-always', 'ask-when-needed', 'hands-off']) })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid-mode' }, 400);
    gate.setMode(c.req.param('id'), parsed.data.mode);
    return c.json({ mode: parsed.data.mode });
  });
  app.get('/threads/:id/receipts', (c) => {
    const list = receipts.forThread(c.req.param('id'));
    const snaps = snapshots.forReceipts(list.map((r) => r.id));
    return c.json({ receipts: list, snapshots: snaps });
  });
  app.post('/receipts/:id/confirm', (c) =>
    receipts.confirm(c.req.param('id'))
      ? c.json({ ok: true })
      : c.json({ error: 'not-unknown' }, 409),
  );
  return app;
}
