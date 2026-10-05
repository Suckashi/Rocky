// MCP tools for the agent. Each call is judged by the gate as an outside action unless the
// user marked that tool read-only; "deny" hides nothing but refuses every call.
import { tool } from 'langchain';
import type { ToolEffect } from './workspace.ts';
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

export type McpToolMap = Map<string, McpToolRef>;

export function mcpEffect(
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

export function createMcpTools(
  manager: McpManager,
  statuses: McpStatus[],
  signal: AbortSignal,
) {
  const map: McpToolMap = new Map();
  const tools = statuses.flatMap((status) =>
    status.tools.map((t) => {
      const name = agentToolName(t.server, t.name);
      map.set(name, { server: t.server, tool: t.name });
      return tool(
        async (args: Record<string, unknown>) => {
          const result = await manager.call(t.server, t.name, args, signal);
          return result.isError ? `Error: ${result.text}` : result.text;
        },
        {
          name,
          description: `[MCP ${t.server}] ${t.description}`.slice(0, 1000),
          schema: { type: 'object', properties: {}, ...t.inputSchema },
        },
      );
    }),
  );
  return { tools, map };
}
