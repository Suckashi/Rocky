import { test, expect } from "@playwright/test";
test("MCP settings persist valid Rocky config, reject foreign extensions and remain usable at four widths", async ({
  page,
}) => {
  await page.goto("/");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "設定", exact: true }).last().click();
  await page.getByText("MCP 伺服器設定", { exact: true }).click();
  const editor = page.getByLabel("Rocky MCP 設定 JSON"),
    button = page.getByRole("button", { name: "保存 MCP 設定", exact: true });
  await expect(editor).toBeEnabled();
  const draft = {
    mcpServers: {
      "node-tools": {
        command: "node",
        args: ["./tools/server.js"],
        enabled: false,
      },
    },
    "x-rocky": {
      version: 1,
      servers: { "node-tools": { transport: "stdio" } },
    },
  };
  await editor.fill(JSON.stringify({ ...draft, "x-apsis": {} }, null, 2));
  await button.click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await editor.fill(JSON.stringify(draft, null, 2));
  await button.click();
  await expect(
    page.getByText("MCP 設定已保存，尚未連線。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("node-tools · 已停用", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "設定", exact: true }).last().click();
  await page.getByText("MCP 伺服器設定", { exact: true }).click();
  await expect(editor).toHaveValue(/node-tools/);
  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
    [390, 844],
    [320, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await button.scrollIntoViewIfNeeded();
    await button.focus();
    await expect(button).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: `test-results/mcp-settings-${width}.png` });
  }
});
