// First line of defence: every tool call passes through the gate before it runs.
// The tool registry says what each call would do; reads are checked too (secret reads ask).
import { ToolMessage } from '@langchain/core/messages';
import { isGraphBubbleUp } from '@langchain/langgraph';
import {
  createMiddleware,
  type ToolCallHandler,
  type ToolCallRequest,
} from 'langchain';
import type { Gate } from '../effects/gate.ts';
import type { ReceiptStore } from '../effects/receipts.ts';
import type { Actor } from '../effects/types.ts';
import { currentEffect, currentPass } from './backend.ts';
import { chosenPlanMessage } from './plan.ts';
import type { ToolRegistry } from './registry.ts';

export interface GateRun {
  gate: Gate;
  receipts: ReceiptStore;
  /** This run's tools and what each call would do. */
  tools: ToolRegistry;
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
  'ls',
  'read_file',
  'glob',
  'grep',
  'read_document',
  'search_memory',
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

  /**
   * The one place a tool call's failure is handled (ADR 0027). A tool that throws gives the
   * model an error result instead of ending the run, so it can tell the user or try another
   * way; only Stop and LangGraph's own control flow pass through. A write or command whose
   * tool never reached the executor has its pass withdrawn and its receipt marked not run.
   */
  async function gated(request: ToolCallRequest, handler: ToolCallHandler) {
    const { name, id = '' } = request.toolCall;
    try {
      return await judged(request, handler);
    } catch (thrown) {
      if (run.signal.aborted || isGraphBubbleUp(thrown)) throw thrown;
      return new ToolMessage({
        tool_call_id: id,
        status: 'error',
        content: `Error: ${name} failed: ${messageOf(thrown)}`,
      });
    }
  }

  async function judged(request: ToolCallRequest, handler: ToolCallHandler) {
    const { name, args, id = '' } = request.toolCall;
    const error = (content: string) =>
      new ToolMessage({ tool_call_id: id, status: 'error', content });
    const mapped = await run.tools.effectOf(
      name,
      args as Record<string, unknown>,
    );
    // The tool's own judge explains its errors best; after that, arguments the tool would
    // refuse anyway are refused before anyone is asked.
    if ('error' in mapped) return error(mapped.error);
    const invalid = schemaProblem(request.tool, args);
    if (invalid)
      return error(`Error: invalid arguments for ${name}: ${invalid}`);
    if ('none' in mapped) return handler(request);
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
        ...(mapped.root !== undefined ? { root: mapped.root } : {}),
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
    // Writes and commands go through the executor, which redeems the pass and finishes the
    // receipt. If the tool stops before that (bad input, the text to replace is gone), nothing
    // ran: withdraw the pass and say so in the receipt.
    if (effect.kind === 'write' || effect.kind === 'command') {
      const pass = result.pass;
      try {
        return await currentEffect.run(effect, () =>
          currentPass.run(pass, () => handler(request)),
        );
      } finally {
        if (run.gate.passes.isOpen(pass)) {
          run.gate.passes.discard(pass);
          if (result.receipt)
            run.receipts.cancel(result.receipt.id, 'the tool did not run');
        }
      }
    }
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

function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

/** The tool's own argument check (Zod), when it has one; MCP tools carry JSON Schema and are skipped. */
function schemaProblem(tool: unknown, args: unknown): string | undefined {
  const schema = (tool as { schema?: unknown } | undefined)?.schema as
    | {
        safeParse?: (value: unknown) => {
          success: boolean;
          error?: { issues?: { path?: unknown[]; message: string }[] };
        };
      }
    | undefined;
  if (typeof schema?.safeParse !== 'function') return undefined;
  const parsed = schema.safeParse(args);
  if (parsed.success) return undefined;
  return (parsed.error?.issues ?? [])
    .map((i) => `${(i.path ?? []).join('.') || 'arguments'}: ${i.message}`)
    .join('; ');
}
