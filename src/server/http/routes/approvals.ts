// Approvals, modes and receipts. The decision is Rocky's: it is checked against the content
// hash the user saw, recorded in a receipt, and only then is a pass issued.
import { existsSync, readFileSync } from 'node:fs';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Executor } from '../../effects/execute.ts';
import type { Gate, UserDecision } from '../../effects/gate.ts';
import { planRestore, restoreRun, runChanges } from '../../effects/restore.ts';
import type { ReceiptStore } from '../../effects/receipts.ts';
import { asContent, type SnapshotStore } from '../../effects/snapshots.ts';
import { formatOf, isBinary } from '../../documents/formats.ts';
import { PREVIEW_MAX_BYTES, previewResponse } from './preview.ts';
import { toMarkdown } from '../../documents/read.ts';

const answer = z.discriminatedUnion('decision', [
  z
    .object({ decision: z.literal('allow-once'), contentHash: z.string() })
    .strict(),
  z
    .object({ decision: z.literal('allow-session'), contentHash: z.string() })
    .strict(),
  z
    .object({
      decision: z.literal('choose'),
      contentHash: z.string(),
      option: z.number().int().min(0).max(2),
    })
    .strict(),
  z
    .object({
      decision: z.literal('revise'),
      contentHash: z.string(),
      feedback: z.string().min(1).max(4000),
    })
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
/** Documents up to this size get a Markdown diff (and a layout preview). */
const DOCUMENT_LIMIT = PREVIEW_MAX_BYTES;

const side = (c: Context) =>
  c.req.query('side') === 'before' ? 'before' : 'after';

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
  // What a pending write would leave behind, or what the file looks like now.
  app.get('/approvals/:id/preview', (c) => {
    const approval = gate.find(c.req.param('id'));
    const effect = approval?.effect;
    if (!effect || effect.kind !== 'write')
      return c.json({ error: 'not-pending' }, 404);
    if (side(c) === 'before')
      return previewResponse(
        c,
        effect.path,
        existsSync(effect.path) ? readFileSync(effect.path) : null,
      );
    return previewResponse(
      c,
      effect.path,
      effect.operation === 'delete'
        ? null
        : Buffer.from(effect.content ?? '', effect.encoding ?? 'utf8'),
    );
  });
  app.post('/approvals/:id', async (c) => {
    const parsed = answer.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid-decision' }, 400);
    const body = parsed.data;
    const decision: UserDecision =
      body.decision === 'reject'
        ? {
            decision: 'reject',
            contentHash: body.contentHash,
            ...(body.reason !== undefined ? { reason: body.reason } : {}),
          }
        : body;
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
  app.get('/threads/:id/runs/:runId/changes', async (c) => {
    const [threadId, runId] = [c.req.param('id'), c.req.param('runId')];
    const plan = new Map(
      planRestore(receipts, snapshots, threadId, runId).map((i) => [i.path, i]),
    );
    /** The text to diff; undefined when there is none to show (too large or unreadable). */
    const text = async (
      sha: string | null,
      path: string,
    ): Promise<string | null | undefined> => {
      if (sha === null) return null;
      const blob = snapshots.read(sha);
      const content = asContent(blob);
      if (blob.length <= PREVIEW_LIMIT && !content.encoding)
        return content.content;
      // A document (bytes) is compared as Markdown, like in the approval panel.
      const format = formatOf(path);
      if (format && isBinary(format) && blob.length <= DOCUMENT_LIMIT) {
        try {
          return await toMarkdown(blob, format);
        } catch {
          // Unreadable: listed without a text diff (the layout preview may still work).
        }
      }
      return undefined;
    };
    const changes = [];
    for (const change of runChanges(receipts, snapshots, threadId, runId)) {
      const item = plan.get(change.path)!;
      const before = await text(change.beforeSha, change.path);
      const after = await text(change.afterSha, change.path);
      changes.push({
        path: change.path,
        created: change.beforeSha === null,
        deleted: change.afterSha === null,
        before: before ?? null,
        after: after ?? null,
        tooLarge: before === undefined || after === undefined,
        document: formatOf(change.path) !== undefined,
        modifiedSince: item.modifiedSince,
        contentHash: item.contentHash,
      });
    }
    return c.json({ changes });
  });
  // One version of a document this turn changed, from the snapshots.
  app.get('/threads/:id/runs/:runId/preview', (c) => {
    const path = c.req.query('path') ?? '';
    const change = runChanges(
      receipts,
      snapshots,
      c.req.param('id'),
      c.req.param('runId'),
    ).find((ch) => ch.path === path);
    if (!change) return c.json({ error: 'not-found' }, 404);
    const sha = side(c) === 'before' ? change.beforeSha : change.afterSha;
    return previewResponse(c, path, sha === null ? null : snapshots.read(sha));
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
