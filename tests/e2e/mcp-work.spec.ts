import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { AIMessage } from "@langchain/core/messages";
import { startAgentProvider } from "../../fixtures/models/agent-provider.js";
import { startHttpFixture } from "../../fixtures/mcp/server.js";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("configured MCP approval is readable at four widths and executes exactly once through the real daemon", async ({
  page,
}) => {
  let registryRevision = 0;
  const root = mkdtempSync(join(tmpdir(), "rocky-browser-mcp-")),
    server = await startHttpFixture(root),
    provider = await startAgentProvider({
      reply: async (messages) => {
        const currentTurn = messages.findLastIndex(
          (m) =>
            m.type === "human" &&
            String(m.content).startsWith("MCP exact browser approval "),
        );
        const last = messages
          .slice(currentTurn + 1)
          .filter((m) => m.type === "tool")
          .at(-1);
        if (last?.name === "mcp_call")
          return new AIMessage("Configured MCP receipt received.");
        const name =
          last?.name === "mcp_discover" ? "mcp_call" : "mcp_discover";
        return new AIMessage({
          content: "",
          tool_calls: [
            {
              id: name + "-browser",
              name,
              args:
                name === "mcp_call"
                  ? {
                      serverId: "mcp-browser",
                      registryRevision: JSON.parse(String(last!.content))
                        .registryRevision,
                      toolName: "write_sample",
                      arguments: {
                        value: "browser-verified-" + "x".repeat(600),
                      },
                    }
                  : { serverId: "mcp-browser", registryRevision },
              type: "tool_call",
            },
          ],
        });
      },
    });
  try {
    await page.goto("/");
    const { token } = await (await page.request.get("/api/v1/session")).json(),
      headers = { "x-rocky-session": token };
    const saved = await (await page.request.get("/api/v1/mcp-config")).json();
    expect(
      (
        await page.request.post("/api/v1/mcp-config", {
          headers,
          data: {
            requestId: randomUUID(),
            expectedRevision: saved.revision,
            config: {
              mcpServers: {
                "mcp-browser": { url: server.url.href, enabled: true },
              },
              "x-rocky": {
                version: 1,
                servers: {
                  "mcp-browser": {
                    transport: "streamable-http",
                    networkPolicyId: "browser-fixture-only",
                  },
                },
              },
            },
          },
        })
      ).ok(),
    ).toBe(true);
    const config = await (await page.request.get("/api/v1/mcp-config")).json();
    const connected = await (
      await page.request.post("/api/v1/mcp-servers/mcp-browser/connect", {
        headers,
        data: { requestId: randomUUID(), expectedRevision: config.revision },
      })
    ).json();
    expect(connected.status).toBe("ready");
    registryRevision = connected.registryRevision;
    expect(registryRevision).toBeGreaterThan(0);
    const name = "MCP Browser " + Date.now(),
      id = randomUUID();
    expect(
      (
        await page.request.post("/api/v1/model-connections", {
          headers,
          data: {
            requestId: randomUUID(),
            id,
            expectedRevision: 0,
            config: {
              name,
              provider: "openai-compatible",
              baseUrl: provider.baseUrl,
              modelId: "fixture",
              contextWindowTokens: 65536,
              maxOutputTokens: 256,
            },
          },
        })
      ).ok(),
    ).toBe(true);
    await page
      .getByRole("button", { name: "設定", exact: true })
      .last()
      .click();
    await page.getByText("模型連線設定", { exact: true }).click();
    await page
      .locator(".model-card")
      .filter({ hasText: name })
      .getByRole("button", { name: "使用此模型", exact: true })
      .click();
    await page.keyboard.press("Escape");
    const prompt = "MCP exact browser approval " + Date.now();
    await page.locator("#compose textarea").fill(prompt);
    await page.getByRole("button", { name: "傳送至模型" }).click();
    const work = page.locator("article.work").filter({ hasText: prompt });
    await expect(work.locator(".approval")).toBeVisible();
    await expect(
      work.getByText("這將呼叫你配置的外部 MCP 伺服器，可能改變外部資料。", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      work.getByText("只寫入合成 MCP 範例，不修改你的檔案。", { exact: true }),
    ).toHaveCount(0);
    await expect(work.getByText("write_sample", { exact: true })).toBeVisible();
    expect(readdirSync(root)).toEqual([]);
    await work.getByText("檢查待執行參數", { exact: true }).click();
    for (const [width, height] of [
      [1440, 900],
      [1280, 800],
      [390, 844],
      [320, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await work.locator(".approval").scrollIntoViewIfNeeded();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({ path: `test-results/mcp-approval-${width}.png` });
    }
    await work.getByRole("button", { name: "核准這次寫入" }).click();
    await expect(work.getByText("已完成", { exact: true })).toBeVisible();
    expect(readdirSync(root)).toHaveLength(1);
    await page.reload();
    await expect(work.getByText("已完成", { exact: true })).toBeVisible();
    expect(readdirSync(root)).toHaveLength(1);
  } finally {
    await provider.close();
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
