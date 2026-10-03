import { test, expect } from "vitest";
import { connectFixture } from "../packages/agent-runtime/src/mcp.js";
for (const kind of ["stdio", "http"] as const)
  test(
    "SDK discovery and full fixture schema rejects invalid args: " + kind,
    async () => {
      const fixture = await connectFixture(kind);
      try {
        const tools = await fixture.client.listTools();
        expect(tools.tools.map((t) => t.name).sort()).toEqual([
          "inspect_sample",
          "write_sample",
        ]);
        const bad = await fixture.client.callTool({
          name: "inspect_sample",
          arguments: { label: 123 },
        });
        expect(bad.isError).toBe(true);
      } finally {
        await fixture.close();
      }
    },
  );
