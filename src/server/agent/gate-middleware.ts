// First line of defence: every tool call passes through the gate before it runs.
// Unknown tools count as external actions; reads are checked too (secrets are refused).
import { ToolMessage } from '@langchain/core/messages';
import { createMiddleware } from 'langchain';
import type { Gate } from '../effects/gate.ts';
import type { ReceiptStore } from '../effects/receipts.ts';
import type { Actor } from '../effects/types.ts';
import { currentEffect, currentPass } from './backend.ts';
import { DOCUMENT_WRITE_TOOLS, documentEffect } from './documents.ts';
import type { MemoryStore } from '../memory/store.ts';
import {
  MEMORY_READ_TOOLS,
  MEMORY_WRITE_TOOLS,
  memoryEffect,
} from './memory.ts';
import { SKILL_TOOLS } from './skills.ts';
import { mcpEffect, type McpToolMap } from './mcp.ts';
import type { ToolPolicy } from '../mcp/manager.ts';
import { toolEffect } from './workspace.ts';

export interface GateRun {
  gate: Gate;
  receipts: ReceiptStore;
  projectRoot: string | undefined;
  memory?: MemoryStore;
  /** This run's MCP tools and the user's per-tool approval settings. */
  mcp?: { map: McpToolMap; policies: Record<string, ToolPolicy> };
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
      // Memory is Rocky's own folder: available without a project, judged with it as root.
      if (MEMORY_READ_TOOLS.has(name) || SKILL_TOOLS.has(name))
        return handler(request);
      const memoryWrite = MEMORY_WRITE_TOOLS.has(name) && run.memory;
      const mcpRef = run.mcp?.map.get(name);
      if (
        !memoryWrite &&
        !mcpRef &&
        !run.projectRoot &&
        name !== 'write_todos' &&
        name !== 'task'
      ) {
        return error(
          'No project folder is selected yet, so files and commands are unavailable. Ask the user to choose one in Settings.',
        );
      }
      const mapped = mcpRef
        ? mcpEffect(mcpRef, args as Record<string, unknown>, run.mcp!.policies)
        : memoryWrite
          ? memoryEffect(name, args as Record<string, unknown>, memoryWrite)
          : DOCUMENT_WRITE_TOOLS.has(name)
            ? await documentEffect(
                name,
                args as Record<string, unknown>,
                run.projectRoot ?? '',
              )
            : toolEffect(
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
        {
          ...(mapped.before !== undefined ? { before: mapped.before } : {}),
          ...(memoryWrite ? { root: memoryWrite.dir } : {}),
        },
      );
      if (!result.allowed) return error(result.message);
      const effect = mapped.effect;
      if (
        effect.kind === 'read' ||
        effect.kind === 'write' ||
        effect.kind === 'command'
      )
        return currentEffect.run(effect, () =>
          currentPass.run(result.pass, () => handler(request)),
        );
      // Other tools act on their own (delegation, MCP): Rocky finishes their receipt here.
      // A tool that throws may or may not have acted, so its outcome is unknown.
      run.gate.passes.redeem(result.pass, result.pass.contentHash);
      const receiptId = result.receipt?.id;
      try {
        const message = await handler(request);
        const failed =
          message instanceof ToolMessage &&
          (message.status === 'error' ||
            String(message.content).startsWith('Error'));
        if (receiptId)
          run.receipts.finish(receiptId, failed ? 'failed' : 'succeeded');
        return message;
      } catch (thrown) {
        if (receiptId)
          run.receipts.finish(receiptId, 'unknown', String(thrown));
        throw thrown;
      }
    },
  });
}
