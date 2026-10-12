// The local API token. It lives in a user-only file and in memory, never in the
// environment, so processes Rocky spawns cannot inherit it.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempOf, writeFileAtomic } from '../effects/atomic-write.ts';

/** The token file and the temporary file a write goes through; both are private. */
export const tokenFiles = (dir: string) => [
  join(dir, 'api-token'),
  tempOf(join(dir, 'api-token')),
];

export function loadOrCreateToken(dir: string): string {
  const file = join(dir, 'api-token');
  if (existsSync(file)) {
    const token = readFileSync(file, 'utf8').trim();
    if (token.length >= 32) return token;
  }
  const token = randomBytes(32).toString('base64url');
  // On Windows, files under %LOCALAPPDATA% are readable only by the user by default.
  writeFileAtomic(file, `${token}\n`);
  return token;
}

export function sameToken(
  expected: string,
  supplied: string | undefined,
): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied ?? '');
  return a.length === b.length && timingSafeEqual(a, b);
}
