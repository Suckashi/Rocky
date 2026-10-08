// Spike version of the action gate: one middleware in front of every tool call.
import { createHash } from 'node:crypto';
import { ToolMessage } from '@langchain/core/messages';
import { interrupt } from '@langchain/langgraph';
import { createMiddleware } from 'langchain';

const NO_EFFECT_TOOLS = new Set([
  'ls',
  'read_file',
  'glob',
  'grep',
  'write_todos',
  'task',
]);

/** Effects that the current mode lets through without asking (rule or mode decision). */
const AUTO_ALLOWED_TOOLS = new Set(['run_command']);

export interface ApprovalRequest {
  reason: 'approval';
  toolCallId: string;
  tool: string;
  args: unknown;
  hash: string;
}

export interface ApprovalAnswer {
  decision: 'allow' | 'reject';
  hash: string;
  reason?: string;
}

export interface GateLogEntry {
  tool: string;
  toolCallId: string;
  decision:
    'no-effect' | 'auto-allowed' | 'allowed' | 'rejected' | 'hash-mismatch';
}

export function contentHash(tool: string, args: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify({ tool, args }))
    .digest('hex');
}

export function createGateMiddleware(log: GateLogEntry[]) {
  return createMiddleware({
    name: 'RockyActionGate',
    wrapToolCall: async (request, handler) => {
      const { name, args, id = '' } = request.toolCall;
      if (NO_EFFECT_TOOLS.has(name)) {
        log.push({ tool: name, toolCallId: id, decision: 'no-effect' });
        return handler(request);
      }
      if (AUTO_ALLOWED_TOOLS.has(name)) {
        log.push({ tool: name, toolCallId: id, decision: 'auto-allowed' });
        return handler(request);
      }
      const hash = contentHash(name, args);
      const answer = interrupt<ApprovalRequest, ApprovalAnswer>({
        reason: 'approval',
        toolCallId: id,
        tool: name,
        args,
        hash,
      });
      if (answer.decision === 'allow' && answer.hash === hash) {
        log.push({ tool: name, toolCallId: id, decision: 'allowed' });
        return handler(request);
      }
      const mismatch = answer.decision === 'allow';
      log.push({
        tool: name,
        toolCallId: id,
        decision: mismatch ? 'hash-mismatch' : 'rejected',
      });
      return new ToolMessage({
        tool_call_id: id,
        status: 'error',
        content: mismatch
          ? `${name} was not run: the approved content does not match. Ask again.`
          : `${name} was not run because the user rejected it. Reason: ${answer.reason ?? 'none given'}. Do not retry the same way; choose a different approach.`,
      });
    },
  });
}
