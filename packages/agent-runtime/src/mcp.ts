import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { fileURLToPath } from "node:url";
import { startHttpFixture } from "../../../fixtures/mcp/server.js";
import { allowFixtureEndpoint } from "./evaluation-egress.js";
export async function connectFixture(
  kind: "stdio" | "http",
  receiptRoot?: string,
) {
  const client = new Client({ name: "rocky-fixture-client", version: "1.0.0" });
  const http =
    kind === "http" ? await startHttpFixture(receiptRoot) : undefined;
  const revoke = http ? allowFixtureEndpoint(http.url.href) : () => {};
  const source = import.meta.url.endsWith(".ts");
  const transport = http
    ? new StreamableHTTPClientTransport(http.url)
    : new StdioClientTransport({
        command: process.execPath,
        args: [
          ...(source ? ["--import", "tsx"] : []),
          fileURLToPath(
            new URL(
              "../../../fixtures/mcp/server." + (source ? "ts" : "js"),
              import.meta.url,
            ),
          ),
        ],
        env: {
          ...(receiptRoot ? { ROCKY_FIXTURE_RECEIPTS: receiptRoot } : {}),
          ...Object.fromEntries(
            ["PATH", "SystemRoot", "TEMP", "TMP"].flatMap((k) =>
              process.env[k] ? [[k, process.env[k]!]] : [],
            ),
          ),
        },
        stderr: "pipe",
      });
  try {
    await client.connect(transport);
  } catch (error) {
    revoke();
    await transport.close();
    await http?.close();
    throw error;
  }
  return {
    client,
    destination: http?.url.href ?? "stdio:node/rocky-synthetic-tools",
    close: async () => {
      await client.close();
      revoke();
      await http?.close();
    },
  };
}
