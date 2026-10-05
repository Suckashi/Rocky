// Approvals, modes and receipts. The decision is Rocky's: it is checked against the content
// hash the user saw, recorded in a receipt, and only then is a pass issued.
import { Hono } from 'hono';
import { z } from 'zod';
import type { Executor } from '../../effects/execute.ts';
import type { Gate } from '../../effects/gate.ts';
import { planRestore, restoreRun, runChanges } from '../../effects/restore.ts';
import type { ReceiptStore } from '../../effects/receipts.ts';
import { asContent, type SnapshotStore } from '../../effects/snapshots.ts';

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

/** Larger files are listed without content; the UI says they are too large to preview. */
const PREVIEW_LIMIT = 256 * 1024;

export function approvalRoutes(
  gate: Gate,
  receipts: ReceiptStore,
  snapshots: SnapshotStore,
  executor: Executor,
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
  // One turn's file changes with before/after text, and the restore plan the user approves.
  app.get('/threads/:id/runs/:runId/changes', (c) => {
    const [threadId, runId] = [c.req.param('id'), c.req.param('runId')];
    const plan = new Map(
      planRestore(receipts, snapshots, threadId, runId).map((i) => [i.path, i]),
    );
    let tooLarge = false;
    const text = (sha: string | null): string | null => {
      if (sha === null) return null;
      const blob = snapshots.read(sha);
      const content = asContent(blob);
      if (blob.length <= PREVIEW_LIMIT && !content.encoding)
        return content.content;
      // Too large, or binary (a document): listed without a text preview.
      tooLarge = true;
      return null;
    };
    const changes = runChanges(receipts, snapshots, threadId, runId).map(
      (change) => {
        tooLarge = false;
        const item = plan.get(change.path)!;
        const before = text(change.beforeSha);
        const after = text(change.afterSha);
        return {
          path: change.path,
          created: change.beforeSha === null,
          deleted: change.afterSha === null,
          before,
          after,
          tooLarge,
          modifiedSince: item.modifiedSince,
          contentHash: item.contentHash,
        };
      },
    );
    return c.json({ changes });
  });
  app.post('/threads/:id/runs/:runId/restore', async (c) => {
    const parsed = z
      .object({
        items: z
          .array(
            z.object({ path: z.string(), contentHash: z.string() }).strict(),
          )
          .max(1000),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid-restore' }, 400);
    try {
      const result = restoreRun(
        { gate, executor, receipts, snapshots },
        c.req.param('id'),
        c.req.param('runId'),
        parsed.data.items,
      );
      return result.ok ? c.json(result) : c.json(result, 409);
    } catch (error) {
      return c.json(
        { ok: false, error: error instanceof Error ? error.message : 'failed' },
        500,
      );
    }
  });
  app.post('/receipts/:id/confirm', (c) =>
    receipts.confirm(c.req.param('id'))
      ? c.json({ ok: true })
      : c.json({ error: 'not-unknown' }, 409),
  );
  return app;
}
