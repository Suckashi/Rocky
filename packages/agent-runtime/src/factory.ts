import "./environment.js";
import { createDeepAgent } from "deepagents";
import { createMiddleware, todoListMiddleware, tool } from "langchain";
import { z } from "zod";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { FixtureModel } from "../../../fixtures/models/model.js";
import type { BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ROCKY_PERSONA } from "./persona.js";
export type RuntimeHooks = {
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
  models?: { root: BaseChatModel; child: BaseChatModel },
) {
  function guard(child: boolean) {
    return createMiddleware({
      name: child ? "RockyChildPolicy" : "RockyRootPolicy",
      wrapToolCall: async (request, handler) => {
        const { name, args, id } = request.toolCall;
        const allowed = child
          ? ["inspect_sample"]
          : ["task", "write_todos", "write_sample"];
        if (!allowed.includes(name))
          throw Error("Rocky policy denied tool: " + name);
        const callId = id ?? "";
        if (!callId) throw Error("Tool call identity required");
        hooks.event(
          name === "task" ? "rocky.subagent.started" : "rocky.tool.started",
          { name, callId, args, child },
        );
        const result = await handler(request);
        hooks.event(
          name === "task" ? "rocky.subagent.completed" : "rocky.tool.completed",
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
    systemPrompt:
      ROCKY_PERSONA +
      (models
        ? "\nYou use the explicitly configured model. Available tools operate only on synthetic samples; never claim to have read or modified real files."
        : "\nThis run uses synthetic fixtures."),
    tools: [write],
    middleware: [todoListMiddleware(), guard(false)],
    subagents: [
      {
        name: "general-purpose",
        description: "Inspect synthetic samples only",
        model: models?.child ?? new FixtureModel(true, hooks.modelRequest),
        systemPrompt: "Report only observed synthetic sample evidence.",
        tools: [read],
        middleware: [guard(true)],
      },
    ],
    interruptOn: { write_sample: { allowedDecisions: ["approve", "reject"] } },
    permissions: [
      { operations: ["read", "write"], paths: ["/**"], mode: "deny" },
    ],
  });
}
