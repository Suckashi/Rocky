// First line of defence: every tool call passes through the gate before it runs.
// Unknown tools count as external actions; reads are checked too (secrets are refused).
import { ToolMessage } from '@langchain/core/messages';
import { createMiddleware } from 'langchain';
import type { Gate } from '../effects/gate.ts';
import type { Actor } from '../effects/types.ts';
import { currentPass } from './backend.ts';
import { toolEffect } from './workspace.ts';

export interface GateRun {
  gate: Gate;
  projectRoot: string | undefined;
  threadId: string;
  runId: string;
  signal: AbortSignal;
}

export function createGateMiddleware(run: GateRun, actor: Actor) {
  return createMiddleware({
    name: actor === 'rocky' ? 'RockyActionGate' : 'RockyActionGateSubagent',
    wrapToolCall: async (request, handler) => {
      const { name, args, id = '' } = request.toolCall;
      const error = (content: string) =>
        new ToolMessage({ tool_call_id: id, status: 'error', content });
      if (!run.projectRoot && name !== 'write_todos' && name !== 'task') {
        return error(
          'No project folder is selected yet, so files and commands are unavailable. Ask the user to choose one in Settings.',
        );
      }
      const mapped = toolEffect(
        name,
        args as Record<string, unknown>,
        run.projectRoot ?? '',
      );
      if ('none' in mapped) return handler(request);
      if ('error' in mapped) return error(mapped.error);
      const result = await run.gate.request(
        mapped.effect,
        { threadId: run.threadId, runId: run.runId, toolCallId: id, actor },
        run.signal,
        mapped.before !== undefined ? { before: mapped.before } : {},
      );
      if (!result.allowed) return error(result.message);
      return currentPass.run(result.pass, () => handler(request));
    },
  });
}
