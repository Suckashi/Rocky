// Content hashes. An approval or pass binds to the exact content of the action.
import { createHash } from 'node:crypto';
import type { Effect } from './types.ts';

const sha256 = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** The exact action: argv + cwd, path + operation + new content, server + tool + args. */
export function contentHash(effect: Effect): string {
  return sha256(effect);
}
