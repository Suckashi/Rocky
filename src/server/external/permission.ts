// Maps an ACP permission request to a gate effect. The effect carries the exact content
// the agent will apply (full new file text, the command), so the approval binds to it.
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';
import type { Effect } from '../effects/types.ts';

export interface MappedPermission {
  effect: Effect;
  /** Current content for a write, to show a diff. */
  before?: string;
}

interface DiffContent {
  type: 'diff';
  path: string;
  oldText?: string | null;
  newText: string;
}

const isDiff = (c: unknown): c is DiffContent =>
  typeof c === 'object' &&
  c !== null &&
  (c as { type?: unknown }).type === 'diff' &&
  typeof (c as { path?: unknown }).path === 'string' &&
  typeof (c as { newText?: unknown }).newText === 'string';

function writeOf(diff: DiffContent, cwd: string): MappedPermission {
  const path = isAbsolute(diff.path) ? diff.path : resolve(cwd, diff.path);
  const exists = existsSync(path);
  return {
    effect: {
      kind: 'write',
      path,
      operation: exists ? 'edit' : 'create',
      content: diff.newText,
    },
    ...(exists ? { before: readFileSync(path, 'utf8') } : {}),
  };
}

/** One effect per thing the request does: a change to several files is one write per file. */
export function permissionEffects(
  request: RequestPermissionRequest,
  cwd: string,
): MappedPermission[] {
  const { kind, content, rawInput, title } = request.toolCall;
  const raw = (rawInput ?? {}) as Record<string, unknown>;
  const diffs = (content ?? []).filter(isDiff);

  if (kind === 'edit' || kind === 'delete') {
    // OpenCode's patch lists its files and sends one diff per file. Judged file by file
    // only when every listed file has its diff and none moves (a move also deletes a file,
    // which no diff shows); otherwise it stays one outside action below.
    const files = Array.isArray(raw['files'])
      ? (raw['files'] as unknown[])
      : [];
    const moves = files.some(
      (f) =>
        typeof f === 'object' &&
        f !== null &&
        typeof (f as { movePath?: unknown }).movePath === 'string',
    );
    const complete =
      files.length === 0 ? diffs.length === 1 : diffs.length === files.length;
    if (diffs.length > 0 && complete && !moves)
      return diffs.map((d) => writeOf(d, cwd));
  }

  // OpenCode asks to read only the secret files its config lists (opencode.ts), and sends
  // no path with the question; Rocky judges it as a secret read.
  if (kind === 'read') {
    const path =
      typeof raw['filePath'] === 'string'
        ? raw['filePath']
        : request.toolCall.locations?.[0]?.path;
    return [
      {
        effect: path
          ? { kind: 'read', path: isAbsolute(path) ? path : resolve(cwd, path) }
          : { kind: 'read', path: cwd, secret: true },
      },
    ];
  }

  if (kind === 'execute' && typeof raw['command'] === 'string') {
    const workdir =
      typeof raw['workdir'] === 'string' ? resolve(cwd, raw['workdir']) : cwd;
    // OpenCode runs the command line through a shell; the gate analyses it as one.
    return [
      {
        effect: {
          kind: 'command',
          argv: ['sh', '-c', raw['command']],
          cwd: workdir,
        },
      },
    ];
  }

  // Anything else (a patch that moves files, fetch, its own MCP tools) is an outside action.
  return [
    {
      effect: {
        kind: 'mcp',
        server: 'opencode',
        tool: kind ?? title ?? 'other',
        args: { title: title ?? null, content: content ?? null, rawInput: raw },
        readOnly: false,
      },
    },
  ];
}
