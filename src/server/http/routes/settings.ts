// Settings API: language and model. The API key is write-only from the browser's side.
import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import type { EgressGuard } from '../../platform/egress.ts';
import type { SettingsStore } from '../../store/settings.ts';
import { readBody } from '../body.ts';

const provider = z.enum(['openai-compatible', 'openai', 'ollama']);
const baseURL = z
  .string()
  .trim()
  .url()
  .refine((value) => /^https?:\/\//.test(value), 'http or https');

const modelBody = z
  .object({
    provider,
    baseURL,
    model: z.string().trim().min(1).max(200),
    apiKey: z.string().max(500).optional(),
  })
  .strict();

const testBody = z
  .object({ provider, baseURL, apiKey: z.string().max(500).optional() })
  .strict();

export type ListModels = (
  baseURL: string,
  apiKey: string | undefined,
) => Promise<string[]>;

/** GET {baseURL}/models on the OpenAI-compatible endpoint the user configured. */
export const listModels: ListModels = async (url, apiKey) => {
  const response = await fetch(`${url.replace(/\/+$/, '')}/models`, {
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = (await response.json()) as { data?: { id?: unknown }[] };
  return (body.data ?? [])
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === 'string');
};

export function settingsRoutes(
  settings: SettingsStore,
  egress: Pick<EgressGuard, 'allow'>,
  list: ListModels = listModels,
): Hono {
  const app = new Hono();
  app.get('/settings', (c) => c.json(settings.public()));

  app.put('/settings/locale', async (c) => {
    const body = await readBody(
      c,
      z.object({ locale: z.enum(['zh-TW', 'en']) }).strict(),
    );
    if (!body) return c.json({ error: 'invalid-locale' }, 400);
    settings.setLocale(body.locale);
    return c.json(settings.public());
  });

  app.put('/settings/project', async (c) => {
    const body = await readBody(
      c,
      z.object({ path: z.string().trim().min(1).max(1000) }).strict(),
    );
    if (!body || !isAbsolute(body.path))
      return c.json({ error: 'invalid-project' }, 400);
    let isDir: boolean;
    try {
      isDir = statSync(body.path).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) return c.json({ error: 'project-not-found' }, 400);
    settings.setProject(body.path);
    return c.json(settings.public());
  });

  app.put('/settings/mode', async (c) => {
    const body = await readBody(
      c,
      z.object({ mode: z.enum(['ask-when-needed', 'hands-off']) }).strict(),
    );
    if (!body) return c.json({ error: 'invalid-mode' }, 400);
    settings.setMode(body.mode);
    return c.json(settings.public());
  });

  app.put('/settings/model', async (c) => {
    const body = await readBody(c, modelBody);
    if (!body) return c.json({ error: 'invalid-model' }, 400);
    const { apiKey, ...model } = body;
    egress.allow(model.baseURL);
    settings.setModel(model, apiKey);
    return c.json(settings.public());
  });

  app.post('/settings/model/test', async (c) => {
    const body = await readBody(c, testBody);
    if (!body) return c.json({ error: 'invalid-model' }, 400);
    // Testing an endpoint is the user choosing it, so it joins the outbound allowlist.
    egress.allow(body.baseURL);
    // No key typed: reuse the saved one, so the user does not have to paste it again.
    const apiKey = body.apiKey || settings.apiKey();
    try {
      return c.json({
        ok: true,
        models: await list(body.baseURL, apiKey),
      });
    } catch (error) {
      return c.json({
        ok: false,
        error: error instanceof Error ? error.message : 'failed',
      });
    }
  });
  return app;
}
