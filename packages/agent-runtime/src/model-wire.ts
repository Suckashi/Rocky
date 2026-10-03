import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { z } from "zod";

const call = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  type: z.literal("tool_call"),
});
const wireMessage = z.strictObject({
  type: z.enum(["system", "human", "ai", "tool"]),
  content: z.union([z.string(), z.array(z.unknown())]),
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
  status: z.enum(["success", "error"]).optional(),
  tool_calls: z.array(call).optional(),
});

export function toModelWire(messages: BaseMessage[]) {
  return messages.map((message) => {
    if (!["system", "human", "ai", "tool"].includes(message.type))
      throw Error("Unsupported worker model role");
    return wireMessage.parse({
      type: message.type,
      content: message.content,
      ...(message.name ? { name: message.name } : {}),
      ...(message.type === "ai"
        ? { tool_calls: (message as AIMessage).tool_calls ?? [] }
        : {}),
      ...(message.type === "tool"
        ? {
            tool_call_id: (message as ToolMessage).tool_call_id,
            status: (message as ToolMessage).status,
          }
        : {}),
    });
  });
}

export function fromModelWire(value: unknown): BaseMessage[] {
  return z
    .array(wireMessage)
    .max(4096)
    .parse(value)
    .map((message) => {
      const content = message.content as BaseMessage["content"];
      if (message.type === "system") return new SystemMessage(content);
      if (message.type === "human") return new HumanMessage(content);
      if (message.type === "ai")
        return new AIMessage({
          content,
          tool_calls: message.tool_calls ?? [],
        });
      if (!message.tool_call_id) throw Error("Tool call identity is required");
      return new ToolMessage({
        content,
        tool_call_id: message.tool_call_id,
        ...(message.name ? { name: message.name } : {}),
        ...(message.status ? { status: message.status } : {}),
      });
    });
}
