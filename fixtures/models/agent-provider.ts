import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { FixtureModel } from "./model.js";
import { z } from "zod";
const wireMessage = z.object({
  role: z.string(),
  content: z.unknown(),
  tool_call_id: z.string().optional(),
  tool_calls: z
    .array(
      z.object({
        id: z.string(),
        function: z.object({ name: z.string(), arguments: z.string() }),
      }),
    )
    .optional(),
});
export async function startAgentProvider(options: { hold?: boolean } = {}) {
  const requests: Record<string, unknown>[] = [];
  const server = createServer((req, res) => {
    void (async () => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = z
        .object({
          model: z.string(),
          messages: z.array(wireMessage),
          tools: z.array(z.record(z.string(), z.unknown())).optional(),
        })
        .parse(JSON.parse(raw));
      requests.push(body);
      if (options.hold) return;
      const anthropic = req.url === "/v1/messages";
      const names = new Map<string, string>();
      const messages: BaseMessage[] = [];
      for (const m of body.messages) {
        if (m.role === "system") continue;
        if (anthropic && Array.isArray(m.content)) {
          for (const block of m.content) {
            const b = z
              .object({
                type: z.string(),
                text: z.string().optional(),
                id: z.string().optional(),
                name: z.string().optional(),
                tool_use_id: z.string().optional(),
                content: z.string().optional(),
              })
              .parse(block);
            if (b.type === "tool_use") names.set(b.id!, b.name!);
            else if (b.type === "tool_result")
              messages.push(
                new ToolMessage({
                  content: b.content!,
                  tool_call_id: b.tool_use_id!,
                  name: names.get(b.tool_use_id!),
                }),
              );
            else if (b.type === "text")
              messages.push(
                m.role === "assistant"
                  ? new AIMessage(b.text!)
                  : new HumanMessage(b.text!),
              );
          }
        } else if (m.role === "assistant") {
          for (const c of m.tool_calls ?? []) names.set(c.id, c.function.name);
          messages.push(
            new AIMessage(typeof m.content === "string" ? m.content : ""),
          );
        } else if (m.role === "tool")
          messages.push(
            new ToolMessage({
              content: String(m.content),
              tool_call_id: m.tool_call_id!,
              name: names.get(m.tool_call_id!),
            }),
          );
        else messages.push(new HumanMessage(String(m.content)));
      }
      const child = JSON.stringify(body.tools ?? []).includes("inspect_sample");
      const generated = await new FixtureModel(child)._generate(messages);
      const message = generated.generations[0]!.message as AIMessage;
      const calls = message.tool_calls ?? [];
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify(
          anthropic
            ? {
                content: [
                  ...(message.content
                    ? [{ type: "text", text: message.content }]
                    : []),
                  ...calls.map((c) => ({
                    type: "tool_use",
                    id: c.id,
                    name: c.name,
                    input: c.args,
                  })),
                ],
                stop_reason: calls.length ? "tool_use" : "end_turn",
                usage: { input_tokens: 7, output_tokens: 3 },
              }
            : {
                choices: [
                  {
                    finish_reason: calls.length ? "tool_calls" : "stop",
                    message: {
                      role: "assistant",
                      content: message.content,
                      tool_calls: calls.map((c) => ({
                        id: c.id,
                        type: "function",
                        function: {
                          name: c.name,
                          arguments: JSON.stringify(c.args),
                        },
                      })),
                    },
                  },
                ],
                usage: { prompt_tokens: 7, completion_tokens: 3 },
              },
        ),
      );
    })().catch(() => {
      res.writeHead(400);
      res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
