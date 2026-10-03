import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
export async function startProbeFixture(
  options: {
    redirect?: string;
    invalid?: boolean;
    hold?: boolean;
    refuseTool?: boolean;
  } = {},
) {
  const requests: {
    url: string;
    authorization: string | undefined;
    body: Record<string, unknown>;
  }[] = [];
  let cancelled = 0;
  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      res.destroy();
    });
  });
  async function handle(req: IncomingMessage, res: ServerResponse) {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push({
      url: req.url!,
      authorization:
        req.headers.authorization ??
        (req.headers["x-api-key"] as string | undefined),
      body,
    });
    if (options.redirect) {
      res.writeHead(307, { location: options.redirect });
      res.end();
      return;
    }
    if (options.hold) {
      res.on("close", () => cancelled++);
      return;
    }
    if (options.invalid) {
      res.end(
        JSON.stringify({ error: "synthetic-private-response-do-not-expose" }),
      );
      return;
    }
    const nonce = body.messages[0].content.match(/[0-9a-f-]{36}/)[0];
    const anthropic = req.url === "/v1/messages";
    if (body.stream) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const delta = anthropic
        ? {
            type: "content_block_delta",
            delta: { type: "text_delta", text: nonce },
          }
        : { choices: [{ delta: { content: nonce } }] };
      const frame = `data: ${JSON.stringify(delta)}\n\n`;
      // Split UTF-8/SSE writes; second stream stays open until the client cancels it.
      res.write(frame.slice(0, 13));
      res.write(frame.slice(13));
      if (requests.length === 5) {
        res.on("close", () => cancelled++);
        return;
      }
      res.end(
        anthropic ? 'data: {"type":"message_stop"}\n\n' : "data: [DONE]\n\n",
      );
      return;
    }
    res.setHeader("content-type", "application/json");
    if (body.tool_choice && !options.refuseTool) {
      res.end(
        JSON.stringify(
          anthropic
            ? {
                content: [
                  {
                    type: "tool_use",
                    id: "probe-call",
                    name: "rocky_probe_echo",
                    input: { nonce },
                  },
                ],
              }
            : {
                choices: [
                  {
                    message: {
                      role: "assistant",
                      content: null,
                      tool_calls: [
                        {
                          id: "probe-call",
                          type: "function",
                          function: {
                            name: "rocky_probe_echo",
                            arguments: JSON.stringify({ nonce }),
                          },
                        },
                      ],
                    },
                  },
                ],
              },
        ),
      );
    } else
      res.end(
        JSON.stringify(
          anthropic
            ? { content: [{ type: "text", text: nonce }] }
            : { choices: [{ message: { role: "assistant", content: nonce } }] },
        ),
      );
  }
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    requests,
    get cancelled() {
      return cancelled;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
