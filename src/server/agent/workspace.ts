// Maps tool calls to gate effects. The gate middleware and the backend use the same
// functions, so the content Rocky approves is exactly the content that gets written.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Effect } from '../effects/types.ts';

/** Same rule as Deep Agents' FilesystemBackend in virtual mode: "/src/a.ts" under the project. */
export function resolveVirtual(root: string, virtualPath: string): string {
  const vpath = virtualPath.startsWith('/') ? virtualPath : `/${virtualPath}`;
  if (vpath.includes('..') || vpath.startsWith('~'))
    throw new Error('Path traversal not allowed');
  const full = path.resolve(root, vpath.substring(1));
  const rel = path.relative(root, full);
  if (rel.startsWith('..') || path.isAbsolute(rel))
    throw new Error(`Path outside the project: ${virtualPath}`);
  return full;
}

/** The new full content after an edit_file call, or an error message the model can act on. */
export function applyEdit(
  absolute: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): { content: string; occurrences: number } | { error: string } {
  if (!existsSync(absolute))
    return { error: `Error: file not found: ${absolute}` };
  const current = readFileSync(absolute, 'utf8');
  const count = current.split(oldString).length - 1;
  if (oldString === '' || count === 0)
    return { error: 'Error: old_string was not found in the file.' };
  if (count > 1 && !replaceAll) {
    return {
      error: `Error: old_string occurs ${count} times; add context or set replace_all.`,
    };
  }
  return {
    content: replaceAll
      ? current.split(oldString).join(newString)
      : current.replace(oldString, () => newString),
    occurrences: replaceAll ? count : 1,
  };
}

export const READ_TOOLS = new Set([
  'ls',
  'read_file',
  'glob',
  'grep',
  'read_document',
]);
/** Tools with no effect outside the agent's own state. */
export const NO_EFFECT_TOOLS = new Set(['write_todos', 'task']);

export type ToolEffect =
  { effect: Effect; before?: string } | { error: string } | { none: true };

/** What a tool call would do, in gate terms. Unknown tools are treated as external actions. */
export function toolEffect(
  name: string,
  args: Record<string, unknown>,
  root: string,
): ToolEffect {
  try {
    if (NO_EFFECT_TOOLS.has(name)) return { none: true };
    if (READ_TOOLS.has(name)) {
      const target = String(args['file_path'] ?? args['path'] ?? '/');
      return { effect: { kind: 'read', path: resolveVirtual(root, target) } };
    }
    if (name === 'write_file') {
      const absolute = resolveVirtual(
        root,
        String(args['file_path'] ?? args['path']),
      );
      const exists = existsSync(absolute);
      return {
        effect: {
          kind: 'write',
          path: absolute,
          operation: exists ? 'edit' : 'create',
          content: String(args['content'] ?? ''),
        },
        ...(exists ? { before: readFileSync(absolute, 'utf8') } : {}),
      };
    }
    if (name === 'edit_file') {
      const absolute = resolveVirtual(
        root,
        String(args['file_path'] ?? args['path']),
      );
      const edited = applyEdit(
        absolute,
        String(args['old_string'] ?? ''),
        String(args['new_string'] ?? ''),
        args['replace_all'] === true,
      );
      if ('error' in edited) return edited;
      return {
        effect: {
          kind: 'write',
          path: absolute,
          operation: 'edit',
          content: edited.content,
        },
        before: readFileSync(absolute, 'utf8'),
      };
    }
    if (name === 'run_command') {
      const argv = Array.isArray(args['argv']) ? args['argv'].map(String) : [];
      if (argv.length === 0)
        return {
          error: 'Error: argv must list the program and its arguments.',
        };
      const cwd = args['cwd']
        ? resolveVirtual(root, String(args['cwd']))
        : root;
      return { effect: { kind: 'command', argv, cwd } };
    }
    return {
      effect: {
        kind: 'mcp',
        server: 'rocky',
        tool: name,
        args,
        readOnly: false,
      },
    };
  } catch (error) {
    return {
      error: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
