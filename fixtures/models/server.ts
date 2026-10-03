import { createServer } from "node:http";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { FixtureModel } from "./model.js";
import { ExplicitNetwork } from "../../packages/agent-runtime/src/network.js";
import { allowFixtureEndpoint } from "../../packages/agent-runtime/src/evaluation-egress.js";
export async function startModelFixture() {
  const server = createServer(async (req, res) => {
    if (req.url !== "/model" || req.method !== "POST") {
      res.writeHead(404).end();
      return;
    }
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 1000000) {
          res.writeHead(413).end();
          return;
        }
      }
      const data = JSON.parse(body) as {
        messages: BaseMessage[];
        child: boolean;
      };
      const result = await new FixtureModel(data.child)._generate(
        data.messages,
      );
      const message = result.generations[0].message as AIMessage;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          content: message.content,
          tool_calls: message.tool_calls,
        }),
      );
    } catch {
      res.writeHead(400).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw Error("Missing model port");
  const endpoint = "http://127.0.0.1:" + addr.port + "/model";
  const revoke = allowFixtureEndpoint(endpoint);
  const network = new ExplicitNetwork(new Map([["target", endpoint]]));
  return {
    endpoint,
    trace: network.trace,
    request: async (
      messages: BaseMessage[],
      child: boolean,
    ): Promise<ChatResult> => {
      const response = await network.request(endpoint, "target", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          child,
          messages: messages.map((m) => ({
            type: m.type,
            name: m.name,
            content: m.content,
          })),
        }),
      });
      if (!response.ok) throw Error("Fixture model failed");
      const data = (await response.json()) as {
        content: string;
        tool_calls: AIMessage["tool_calls"];
      };
      return {
        generations: [{ text: data.content, message: new AIMessage(data) }],
      };
    },
    close: async () => {
      revoke();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
