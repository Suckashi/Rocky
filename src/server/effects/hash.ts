// Content hashes. An approval or pass binds to contentHash; a session-wide approval to sessionKey.
import { createHash } from 'node:crypto';
import type { Effect } from './types.ts';

const sha256 = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** The exact action: argv + cwd, path + operation + new content, server + tool + args. */
export function contentHash(effect: Effect): string {
  return sha256(effect);
}

/** "Allow for this session" scope (ADR 0007): no free text, no wider than the action. */
export function sessionKey(effect: Effect): string {
  switch (effect.kind) {
    case 'write':
      return sha256({
        kind: 'write',
        path: effect.path,
        operation: effect.operation,
      });
    case 'command':
      return sha256({ kind: 'command', argv: effect.argv, cwd: effect.cwd });
    case 'mcp':
      return sha256({
        kind: 'mcp',
        server: effect.server,
        tool: effect.tool,
        args: effect.args,
      });
    default:
      return sha256(effect);
  }
}
