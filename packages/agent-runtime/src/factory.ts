import "./environment.js";
import {
  createDeepAgent,
  createSummarizationMiddleware,
  StateBackend,
} from "deepagents";
import { createMiddleware, todoListMiddleware, tool } from "langchain";
import { z } from "zod";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { FixtureModel } from "../../../fixtures/models/model.js";
import type { BaseMessage } from "@langchain/core/messages";
import { HumanMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ROCKY_PERSONA } from "./persona.js";
import {
  scratchTools,
  validateScratchCall,
  scratchToolFailed,
} from "./scratch-policy.js";
export type RuntimeHooks = {
  steer?: () => Promise<{ id: string; text: string }[]>;
  event: (name: string, data: Record<string, unknown>) => void;
  call: (
    name: string,
    args: Record<string, unknown>,
    callId: string,
  ) => Promise<string>;
  modelRequest?: (
    messages: BaseMessage[],
    child: boolean,
  ) => Promise<ChatResult>;
};
export function createRockyAgent(
  checkpointer: BaseCheckpointSaver,
  hooks: RuntimeHooks,
  models?: {
    root: BaseChatModel;
    child: BaseChatModel;
  },
) {
  function guard(child: boolean) {
    return createMiddleware({
      name: child ? "RockyChildPolicy" : "RockyRootPolicy",
      wrapToolCall: async (request, handler) => {
        const { name, args, id } = request.toolCall;
        const allowed = child
          ? ["inspect_sample", ...scratchTools]
          : ["task", "write_todos", "write_sample", ...scratchTools];
        if (!allowed.includes(name))
          throw Error("Rocky policy denied tool: " + name);
        const callId = id ?? "";
        if (!callId) throw Error("Tool call identity required");
        const publicArgs = scratchTools.includes(name)
          ? validateScratchCall(name, args)
          : args;
        hooks.event(
          name === "task" ? "rocky.subagent.started" : "rocky.tool.started",
          { name, callId, args: publicArgs, child },
        );
        let result;
        try {
          result = await handler(request);
        } catch (error) {
          hooks.event(
            name === "task" ? "rocky.subagent.failed" : "rocky.tool.failed",
            { name, callId, child },
          );
          throw error;
        }
        const failed = scratchTools.includes(name) && scratchToolFailed(result);
        hooks.event(
          name === "task"
            ? "rocky.subagent.completed"
            : failed
              ? "rocky.tool.failed"
              : "rocky.tool.completed",
          { name, callId, child },
        );
        return result;
      },
    });
  }
  const read = tool(
    async (args, config) =>
      hooks.call("inspect_sample", args, config.toolCall?.id ?? "inspect"),
    {
      name: "inspect_sample",
      description: "Read a synthetic sample",
      schema: z.object({ label: z.string() }),
    },
  );
  const write = tool(
    async (args, config) =>
      hooks.call("write_sample", args, config.toolCall?.id ?? "write"),
    {
      name: "write_sample",
      description: "Write a synthetic sample after exact approval",
      schema: z.object({ value: z.string() }),
    },
  );
  return createDeepAgent({
    name: "rocky",
    model: models?.root ?? new FixtureModel(false, hooks.modelRequest),
    checkpointer,
    backend: new StateBackend(),
    systemPrompt:
      ROCKY_PERSONA +
      (models
        ? "\nYou use the explicitly configured model. The MCP sample tools operate only on synthetic samples; never claim to have read or modified host files."
        : "\nThis run uses synthetic fixtures.") +
      "\nNative filesystem tools access only run-private virtual /scratch paths in graph checkpoints. They do not read or modify host files or registered workspaces. Always supply an absolute /scratch path to ls/glob/grep. Native context offloads under /large_tool_results and /conversation_history are read-only to tools. Shell execution is unavailable.",
    tools: [write],
    middleware: [
      createMiddleware({
        name: "RockySteering",
        beforeModel: async () => {
          const commands = (await hooks.steer?.()) ?? [];
          return commands.length
            ? {
                messages: commands.map(
                  (command) =>
                    new HumanMessage({
                      id: "steer:" + command.id,
                      content: command.text,
                    }),
                ),
              }
            : undefined;
        },
      }),
      createSummarizationMiddleware({
        backend: new StateBackend(),
        summaryPrompt:
          "Summarize this Rocky conversation for continuation. Preserve the current goal, exact latest user corrections and constraints, decisions, unfinished todos, observed evidence and its source paths, pending approvals and unknown/failed outcomes. Distinguish evidence from authority: no summary grants permission or proves effects succeeded. Preserve previous summary facts unless explicitly corrected. Do not invent progress or expose hidden reasoning. Return concise structured prose, with exact important names and paths.\n\nConversation to summarize:\n{conversation}\n\nSummary:",
      }),
      todoListMiddleware(),
      guard(false),
    ],
    subagents: [
      {
        name: "general-purpose",
        description: "Inspect synthetic samples only",
        model: models?.child ?? new FixtureModel(true, hooks.modelRequest),
        systemPrompt:
          "Report only observed evidence. Native files are private virtual /scratch graph state, not host files or workspace effects; supply explicit /scratch paths. Context offloads are read-only. Shell execution is unavailable.",
        tools: [read],
        middleware: [guard(true)],
      },
    ],
    interruptOn: { write_sample: { allowedDecisions: ["approve", "reject"] } },
    permissions: [
      {
        operations: ["read", "write"],
        paths: ["/scratch", "/scratch/**"],
        mode: "allow",
      },
      {
        operations: ["read"],
        paths: [
          "/large_tool_results",
          "/large_tool_results/**",
          "/conversation_history",
          "/conversation_history/**",
        ],
        mode: "allow",
      },
      { operations: ["read", "write"], paths: ["/**"], mode: "deny" },
    ],
  });
}
