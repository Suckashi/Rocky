import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListPromptsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
const mode = process.argv[2],
  server = new Server(
    { name: "rocky-paged-fixture", version: "1" },
    {
      capabilities: mode?.startsWith("data-")
        ? { resources: { listChanged: true }, prompts: { listChanged: true } }
        : { tools: {} },
    },
  );
if (!mode?.startsWith("data-"))
  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    if (mode === "wait")
      await new Promise((resolve) => setTimeout(resolve, 10000));
    return {
      tools: [
        {
          name: request.params?.cursor ? "second_tool" : "first_tool",
          inputSchema:
            mode === "unsafe-input"
              ? {
                  type: "object",
                  properties: { value: { type: "string", pattern: "(a+)+$" } },
                }
              : { type: "object", properties: {} },
          ...(mode === "unsafe-output"
            ? {
                outputSchema: {
                  type: "object",
                  $ref: "https://unconfigured.invalid/schema",
                },
              }
            : {}),
        },
      ],
      ...(request.params?.cursor
        ? mode === "repeat"
          ? { nextCursor: "second" }
          : {}
        : { nextCursor: "second" }),
    };
  });
if (mode?.startsWith("data-")) {
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    if (mode === "data-wait")
      await new Promise((resolve) => setTimeout(resolve, 2000));
    if (mode === "data-resources" || mode === "data-prompts")
      setTimeout(() => {
        void server
          .notification({
            method:
              mode === "data-resources"
                ? "notifications/resources/list_changed"
                : "notifications/prompts/list_changed",
          })
          .catch(() => {});
      }, 100);
    return { resources: [{ name: "document", uri: "fixture://document" }] };
  });
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [],
  }));
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [{ name: "data-only" }],
  }));
}
if (mode === "diagnostics") {
  process.stderr.write(
    JSON.stringify({
      home: process.env.HOME ?? "",
      profile: process.env.USERPROFILE ?? "",
      unrelated: process.env.ROCKY_UNRELATED_PRIVATE ?? "",
    }) + "\n",
  );
  const secret = process.env.SERVER_TOKEN ?? "";
  process.stderr.write(secret.slice(0, 5));
  setTimeout(() => process.stderr.write(secret.slice(5) + "\n"), 10);
}
if (mode === "overflow") process.stderr.write("x".repeat(70000));
await server.connect(new StdioServerTransport());
