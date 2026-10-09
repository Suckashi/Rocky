// Rocky's file backend for Deep Agents: reads and searches go to FilesystemBackend (virtual
// mode, rooted at the project); writes go through the executor with the pass the gate
// middleware issued for this tool call. No pass, no write. A search leaves out secret files
// unless the user approved searching that secret path itself.
import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync } from 'node:fs';
import { FilesystemBackend, type BackendProtocolV2 } from 'deepagents';
import type { Executor } from '../effects/execute.ts';
import type { Pass } from '../effects/passes.ts';
import { classifyPath } from '../effects/paths.ts';
import type { Effect } from '../effects/types.ts';
import { applyEdit, resolveVirtual } from './workspace.ts';

/** The pass for the tool call currently running, set by the gate middleware. */
export const currentPass = new AsyncLocalStorage<Pass>();
/** The exact effect that pass was issued for (document tools write these bytes). */
export const currentEffect = new AsyncLocalStorage<Effect>();

function requirePass(): Pass {
  const pass = currentPass.getStore();
  if (!pass) throw new Error('No approval for this action (missing pass).');
  return pass;
}

export function createRockyBackend(
  root: string,
  executor: Executor,
): BackendProtocolV2 {
  const files = new FilesystemBackend({ rootDir: root, virtualMode: true });
  const isSecret = (virtualPath: string) =>
    classifyPath(resolveVirtual(root, virtualPath), root).secret;
  const fail = (error: unknown) => ({
    error: `Error: ${error instanceof Error ? error.message : String(error)}`,
  });
  return {
    ls: (p) => files.ls(p),
    read: (p, offset, limit) => files.read(p, offset, limit),
    readRaw: (p) => files.readRaw(p),
    async grep(pattern, p, glob, maxCount) {
      const result = await files.grep(pattern, p ?? undefined, glob, maxCount);
      if (!result.matches || (p && isSecret(p))) return result;
      return {
        ...result,
        matches: result.matches.filter((m) => !isSecret(m.path)),
      };
    },
    glob: (pattern, p) => files.glob(pattern, p),
    write(filePath, content) {
      try {
        const absolute = resolveVirtual(root, filePath);
        const operation = existsSync(absolute) ? 'edit' : 'create';
        executor.write(requirePass(), {
          kind: 'write',
          path: absolute,
          operation,
          content,
        });
        return { path: filePath, filesUpdate: null };
      } catch (error) {
        return fail(error);
      }
    },
    edit(filePath, oldString, newString, replaceAll = false) {
      try {
        const absolute = resolveVirtual(root, filePath);
        const edited = applyEdit(absolute, oldString, newString, replaceAll);
        if ('error' in edited) return edited;
        executor.write(requirePass(), {
          kind: 'write',
          path: absolute,
          operation: 'edit',
          content: edited.content,
        });
        return {
          path: filePath,
          filesUpdate: null,
          occurrences: edited.occurrences,
        };
      } catch (error) {
        return fail(error);
      }
    },
  } as BackendProtocolV2;
}
