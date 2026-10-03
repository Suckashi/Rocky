import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
const receiptMeta = z.strictObject({
  operationId: z.string().min(1).max(300),
  intentHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export function fixtureServer(
  receiptRoot?: string,
  failAfterEffect = false,
  includeVisual = false,
) {
  if (receiptRoot) mkdirSync(receiptRoot, { recursive: true });
  const server = new McpServer({
    name: "rocky-synthetic-tools",
    version: "1.0.0",
  });
  server.registerResource(
    "operation-receipt",
    new ResourceTemplate("rocky-fixture://receipts/{key}", { list: undefined }),
    {},
    async (uri, variables) => {
      const key = z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(variables.key);
      let receipt: unknown = null;
      if (receiptRoot) {
        try {
          receipt = JSON.parse(
            readFileSync(join(receiptRoot, key + ".json"), "utf8"),
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ receipt }),
          },
        ],
      };
    },
  );
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
    async ({ value }, extra) => {
      const result = {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ saved: value, effect: "synthetic-only" }),
          },
        ],
      };
      if (receiptRoot) {
        const meta = receiptMeta.parse(extra._meta?.["rocky/operation"]);
        const key = createHash("sha256").update(meta.operationId).digest("hex");
        // The exclusive durable receipt IS this fixture's synthetic effect.
        // A duplicate dispatch fails instead of overwriting or replaying it.
        writeFileSync(
          join(receiptRoot, key + ".json"),
          JSON.stringify({
            ...meta,
            result: JSON.stringify(result),
            evidenceRef: randomUUID(),
            observedAt: new Date().toISOString(),
          }),
          { flag: "wx", flush: true },
        );
      }
      return failAfterEffect ? { ...result, isError: true } : result;
    },
  );
  if (includeVisual)
    server.registerTool(
      "visual_sample",
      {
        inputSchema: { label: z.string() },
        outputSchema: {
          label: z.string(),
          kind: z.literal("synthetic-image"),
          credentials: z.object({ apiKey: z.string() }),
        },
      },
      async ({ label }) => ({
        content: [
          {
            type: "text",
            text:
              label === "large evidence"
                ? "Synthetic large text evidence.\n".repeat(5000)
                : "Synthetic one-pixel image; not a live screenshot.",
          },
          {
            type: "image",
            mimeType: "image/png",
            data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA0sAAAAASUVORK5CYII=",
          },
          {
            type: "resource_link",
            uri: "https://unconfigured.invalid/never-fetch",
            name: "untrusted reference",
          },
        ],
        structuredContent: {
          label,
          kind: "synthetic-image",
          credentials: { apiKey: "synthetic-visual-secret" },
        },
      }),
    );
  return server;
}
export async function startHttpFixture(
  receiptRoot?: string,
  failAfterEffect = false,
  includeVisual = false,
) {
  const active = new Set<StreamableHTTPServerTransport>();
  const http = createServer(async (req, res) => {
    if (req.url !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    const server = fixtureServer(receiptRoot, failAfterEffect, includeVisual);
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
  await fixtureServer(process.env.ROCKY_FIXTURE_RECEIPTS).connect(
    new StdioServerTransport(),
  );
}
