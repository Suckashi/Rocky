import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
const mode = process.argv[2],
  server = new Server(
    { name: "rocky-paged-fixture", version: "1" },
    { capabilities: { tools: {} } },
  );
server.setRequestHandler(ListToolsRequestSchema, async (request) => {
  if (mode === "wait")
    await new Promise((resolve) => setTimeout(resolve, 10000));
  return {
    tools: [
      {
        name: request.params?.cursor ? "second_tool" : "first_tool",
        inputSchema: { type: "object", properties: {} },
      },
    ],
    ...(request.params?.cursor
      ? mode === "repeat"
        ? { nextCursor: "second" }
        : {}
      : { nextCursor: "second" }),
  };
});
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
