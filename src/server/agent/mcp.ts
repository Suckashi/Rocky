// MCP tools for the agent. Each call is judged by the gate as an outside action unless the
// user marked that tool read-only; "deny" hides nothing but refuses every call.
import { tool } from 'langchain';
import type { ToolEffect, ToolRegistry } from './registry.ts';
import {
  agentToolName,
  type McpManager,
  type McpStatus,
  type ToolPolicy,
} from '../mcp/manager.ts';

export interface McpToolRef {
  server: string;
  tool: string;
}

function mcpEffect(
  ref: McpToolRef,
  args: Record<string, unknown>,
  policies: Record<string, ToolPolicy>,
): ToolEffect {
  const policy = policies[`${ref.server}/${ref.tool}`] ?? 'ask';
  if (policy === 'deny')
    return {
      error: `Error: the user has turned off the MCP tool ${ref.server}/${ref.tool}.`,
    };
  return {
    effect: {
      kind: 'mcp',
      server: ref.server,
      tool: ref.tool,
      args,
      readOnly: policy === 'read-only',
    },
  };
}

/** Each MCP tool is an outside action unless the user marked it read-only. */
export function addMcpTools(
  tools: ToolRegistry,
  manager: McpManager,
  statuses: McpStatus[],
  policies: Record<string, ToolPolicy>,
  signal: AbortSignal,
): void {
  for (const status of statuses)
    for (const t of status.tools) {
      const ref = { server: t.server, tool: t.name };
      tools.add(
        tool(
          async (args: Record<string, unknown>) => {
            const result = await manager.call(t.server, t.name, args, signal);
            return result.isError ? `Error: ${result.text}` : result.text;
          },
          {
            name: agentToolName(t.server, t.name),
            description: `[MCP ${t.server}] ${t.description}`.slice(0, 1000),
            schema: { type: 'object', properties: {}, ...t.inputSchema },
          },
        ),
        (args) => mcpEffect(ref, args, policies),
      );
    }
}
