import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { z } from "zod";
export function fixtureServer() {
  const server = new McpServer({
    name: "rocky-synthetic-tools",
    version: "1.0.0",
  });
  server.registerTool(
    "inspect_sample",
    {
      description: "Read synthetic sample only",
      inputSchema: { label: z.string() },
    },
    async ({ label }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({ label, checked: true, source: "synthetic" }),
        },
      ],
    }),
  );
  server.registerTool(
    "write_sample",
    {
      description: "Synthetic external write; requires exact owner approval",
      inputSchema: { value: z.string() },
    },
    async ({ value }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({ saved: value, effect: "synthetic-only" }),
        },
      ],
    }),
  );
  return server;
}
export async function startHttpFixture() {
  const active = new Set<StreamableHTTPServerTransport>();
  const http = createServer(async (req, res) => {
    if (req.url !== "/mcp" || req.method !== "POST") {
      res.writeHead(404).end();
      return;
    }
    const server = fixtureServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    active.add(transport);
    res.on("close", () => {
      active.delete(transport);
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch {
      if (!res.headersSent) res.writeHead(500).end();
    }
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  if (!address || typeof address === "string") throw Error("No fixture port");
  return {
    url: new URL("http://127.0.0.1:" + address.port + "/mcp"),
    close: async () => {
      await Promise.all([...active].map((t) => t.close()));
      http.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        http.close((e) => (e ? reject(e) : resolve())),
      );
    },
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await fixtureServer().connect(new StdioServerTransport());
}
