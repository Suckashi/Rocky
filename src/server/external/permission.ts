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

export function permissionEffect(
  request: RequestPermissionRequest,
  cwd: string,
): MappedPermission {
  const { kind, content, rawInput, title } = request.toolCall;
  const raw = (rawInput ?? {}) as Record<string, unknown>;
  const diffs = (content ?? []).filter(isDiff);

  if (diffs.length === 1 && (kind === 'edit' || kind === 'delete')) {
    const diff = diffs[0]!;
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

  if (kind === 'execute' && typeof raw['command'] === 'string') {
    const workdir =
      typeof raw['workdir'] === 'string' ? resolve(cwd, raw['workdir']) : cwd;
    // OpenCode runs the command line through a shell; the gate analyses it as one.
    return {
      effect: {
        kind: 'command',
        argv: ['sh', '-c', raw['command']],
        cwd: workdir,
      },
    };
  }

  // Anything else (several files at once, fetch, its own MCP tools) is an outside action.
  return {
    effect: {
      kind: 'mcp',
      server: 'opencode',
      tool: kind ?? title ?? 'other',
      args: { title: title ?? null, content: content ?? null, rawInput: raw },
      readOnly: false,
    },
  };
}

/** The repo-relative path and new content an allowed write will leave behind. */
export function approvedWrite(
  effect: Effect,
): { path: string; content: string } | undefined {
  return effect.kind === 'write' && effect.operation !== 'delete'
    ? { path: effect.path, content: effect.content ?? '' }
    : undefined;
}
