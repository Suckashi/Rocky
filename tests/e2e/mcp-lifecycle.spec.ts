import { test, expect } from "@playwright/test";
import { startHttpFixture } from "../../fixtures/mcp/server.js";
test("MCP settings connect/discover/stop an actual configured HTTP server and preserve honest state after reload", async ({
  page,
}) => {
  const server = await startHttpFixture();
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page
      .getByRole("button", { name: "設定", exact: true })
      .last()
      .click();
    await page.getByText("MCP 伺服器設定", { exact: true }).click();
    const editor = page.getByLabel("Rocky MCP 設定 JSON");
    await expect(editor).toBeEnabled();
    await editor.fill(
      JSON.stringify(
        {
          mcpServers: { "http-tools": { url: server.url.href, enabled: true } },
          "x-rocky": {
            version: 1,
            servers: {
              "http-tools": {
                transport: "streamable-http",
                networkPolicyId: "explicit-browser-fixture",
              },
            },
          },
        },
        null,
        2,
      ),
    );
    await page
      .getByRole("button", { name: "保存 MCP 設定", exact: true })
      .click();
    await expect(
      page.getByText("MCP 設定已保存，尚未連線。", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "連線並探索", exact: true }).click();
    await expect(
      page.getByText("http-tools · 連線就緒", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("已探索工具 · 2", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/mcp-lifecycle-ready-1440.png",
    });
    await page.reload();
    await page
      .getByRole("button", { name: "設定", exact: true })
      .last()
      .click();
    await page.getByText("MCP 伺服器設定", { exact: true }).click();
    await expect(
      page.getByText("http-tools · 連線就緒", { exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("button", { name: "停止連線", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/mcp-lifecycle-ready-390.png" });
    await page.getByRole("button", { name: "停止連線", exact: true }).click();
    await expect(
      page.getByText("http-tools · 已配置，尚未連線", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await server.close();
  }
});
