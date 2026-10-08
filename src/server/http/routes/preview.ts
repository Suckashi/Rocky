// Layout previews of project files for the side panel. Same limits as Rocky's own reads:
// inside the project only, never secrets. Viewing changes nothing, so it leaves no receipt.
import { readFileSync, statSync } from 'node:fs';
import { Hono, type Context } from 'hono';
import { previewFile } from '../../documents/preview.ts';
import { resolveVirtual } from '../../agent/workspace.ts';
import { classifyPath } from '../../effects/paths.ts';
import type { SettingsStore } from '../../store/settings.ts';

/** Larger files are not previewed. */
export const PREVIEW_MAX_BYTES = 30 * 1024 * 1024;

/** One version of a file as a self-contained HTML page; html is null when that version does not exist. */
export async function previewResponse(
  c: Context,
  path: string,
  bytes: Uint8Array | null,
) {
  if (bytes === null) return c.json({ html: null, truncated: false });
  if (bytes.length > PREVIEW_MAX_BYTES)
    return c.json({ error: 'too-large' }, 413);
  try {
    const preview = await previewFile(bytes, path);
    return preview
      ? c.json(preview)
      : c.json({ error: 'not-previewable' }, 415);
  } catch (error) {
    return c.json(
      {
        error: 'preview-failed',
        message: error instanceof Error ? error.message : String(error),
      },
      422,
    );
  }
}

export function previewRoutes(settings: SettingsStore): Hono {
  const app = new Hono();
  // path is project-relative, as Rocky's tools write it ("/docs/a.pptx" or "docs/a.pptx").
  app.get('/files/preview', (c) => {
    const project = settings.project();
    if (!project) return c.json({ error: 'no-project' }, 409);
    let absolute: string;
    try {
      absolute = resolveVirtual(project, c.req.query('path') ?? '');
    } catch {
      return c.json({ error: 'outside-project' }, 403);
    }
    const facts = classifyPath(absolute, project);
    if (facts.relative === undefined)
      return c.json({ error: 'outside-project' }, 403);
    if (facts.secret) return c.json({ error: 'secret' }, 403);
    let size: number;
    try {
      const stat = statSync(facts.absolute);
      if (!stat.isFile()) return c.json({ error: 'not-found' }, 404);
      size = stat.size;
    } catch {
      return c.json({ error: 'not-found' }, 404);
    }
    if (size > PREVIEW_MAX_BYTES) return c.json({ error: 'too-large' }, 413);
    return previewResponse(c, facts.absolute, readFileSync(facts.absolute));
  });
  return app;
}
