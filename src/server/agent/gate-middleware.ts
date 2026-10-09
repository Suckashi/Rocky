// First line of defence: every tool call passes through the gate before it runs.
// Unknown tools count as external actions; reads are checked too (secret reads ask).
import { ToolMessage } from '@langchain/core/messages';
import {
  createMiddleware,
  type ToolCallHandler,
  type ToolCallRequest,
} from 'langchain';
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
import { chosenPlanMessage, planEffect } from './plan.ts';
import { mcpEffect, type McpToolMap } from './mcp.ts';
import type { ToolPolicy } from '../mcp/manager.ts';
import { READ_TOOLS, toolEffect } from './workspace.ts';

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

/** Tool results above Deep Agents' eviction threshold (20k tokens, about 80k characters)
 * are written through the backend, which refuses writes without a pass; the model then gets
 * an error instead of content. Rocky cuts every result well below that threshold. */
export const TOOL_RESULT_LIMIT = 60_000;

function capped<T>(result: T): T {
  if (
    !(result instanceof ToolMessage) ||
    typeof result.content !== 'string' ||
    result.content.length <= TOOL_RESULT_LIMIT
  )
    return result;
  const extra = result.content.length - TOOL_RESULT_LIMIT;
  result.content = `${result.content.slice(0, TOOL_RESULT_LIMIT)}\n\n[truncated: ${extra} more characters]`;
  return result;
}

/** What the read-only research subagent is offered. Deep Agents gives it every tool Rocky has;
 * the rest would only be refused below, so the model never sees them. */
export const SUBAGENT_TOOLS = new Set([
  ...READ_TOOLS,
  ...MEMORY_READ_TOOLS,
  'load_skill',
]);

function toolName(tool: unknown): string | undefined {
  const t = tool as { name?: unknown; function?: { name?: unknown } };
  const name = t.name ?? t.function?.name;
  return typeof name === 'string' ? name : undefined;
}

export function createGateMiddleware(run: GateRun, actor: Actor) {
  return createMiddleware({
    name: actor === 'rocky' ? 'RockyActionGate' : 'RockyActionGateSubagent',
    ...(actor === 'subagent'
      ? {
          wrapModelCall: (request, handler) =>
            handler({
              ...request,
              tools: request.tools.filter((t) =>
                SUBAGENT_TOOLS.has(toolName(t) ?? ''),
              ),
            }),
        }
      : {}),
    wrapToolCall: async (request, handler) =>
      capped(await gated(request, handler)),
  });

  async function gated(request: ToolCallRequest, handler: ToolCallHandler) {
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
    const mapped =
      name === 'propose_plan'
        ? planEffect(args as Record<string, unknown>)
        : mcpRef
          ? mcpEffect(
              mcpRef,
              args as Record<string, unknown>,
              run.mcp!.policies,
            )
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
    // The subagent is read-only: anything with an effect is refused before the gate.
    if (actor === 'subagent' && mapped.effect.kind !== 'read')
      return error(
        'The research subagent is read-only. Report what you found; Rocky makes the changes.',
      );
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
    // A plan's outcome is the user's choice; nothing else runs.
    if (effect.kind === 'plan') {
      run.gate.passes.redeem(result.pass, result.pass.contentHash);
      const chosen = effect.options[result.choice ?? -1];
      return new ToolMessage({
        tool_call_id: id,
        content: chosen
          ? chosenPlanMessage(chosen, result.choice!)
          : 'Error: no option was chosen.',
      });
    }
    // Writes and commands go through the executor, which redeems the pass.
    if (effect.kind === 'write' || effect.kind === 'command')
      return currentEffect.run(effect, () =>
        currentPass.run(result.pass, () => handler(request)),
      );
    // Reads and other tools (delegation, MCP) act on their own: the pass is closed now and
    // Rocky finishes their receipt here (an approved secret read has one).
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
      if (receiptId) run.receipts.finish(receiptId, 'unknown', String(thrown));
      throw thrown;
    }
  }
}
