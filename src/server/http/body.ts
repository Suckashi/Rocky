// Request bodies: every route that takes JSON checks it against a strict schema first.
import type { Context } from 'hono';
import type { z } from 'zod';

/** The JSON body checked against `schema`; undefined when it is missing, not JSON or invalid. */
export async function readBody<T>(
  c: Context,
  schema: z.ZodType<T>,
): Promise<T | undefined> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  return parsed.success ? parsed.data : undefined;
}
