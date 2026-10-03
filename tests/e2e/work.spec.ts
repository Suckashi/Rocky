import { test, expect } from "@playwright/test";
test("CopilotKit → native task → MCP → approval, reload and mobile", async ({
  page,
}, testInfo) => {
  const external: string[] = [],
    errors: string[] = [];
  page.on("request", (r) => {
    if (!new URL(r.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/))
      external.push(r.url());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByText("本機已連線", { exact: true })).toBeVisible();
  await page.getByText("模型與工具", { exact: true }).click();
  await page.getByRole("checkbox", { name: "啟用合成測試" }).check();
  await page.getByRole("combobox").selectOption("http");
  await page.getByText("模型與工具", { exact: true }).click();
  const title = "E2E synthetic " + Date.now();
  await page.getByRole("textbox").fill(title);
  await page.getByRole("button", { name: "開始驗證" }).click();
  const work = page.locator("article").filter({ hasText: title });
  await expect(
    work.getByRole("button", { name: "核准這次寫入" }),
  ).toBeVisible();
  await page.reload();
  const restored = page.locator("article").filter({ hasText: title });
  await restored.getByRole("button", { name: "核准這次寫入" }).click();
  await expect(restored.getByText("已完成", { exact: true })).toBeVisible();
  await restored.locator("summary").first().click();
  await expect(
    restored.getByText("subagent.completed", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/rocky-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(
    page.getByRole("heading", { name: "Rocky", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/rocky-mobile.png",
    fullPage: true,
  });
  await testInfo.attach("observed-network", {
    body: JSON.stringify({
      external,
      limitation:
        "Functional test records traffic; separate egress test asserts zero external requests.",
    }),
    contentType: "application/json",
  });
  expect(errors).toEqual([]);
});
test("browser egress: no unconfigured destinations", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (!new URL(r.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/))
      external.push(r.url());
  });
  await page.goto("/");
  await expect(page.getByText("本機已連線", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "English", exact: true }).click();
  expect(external).toEqual([]);
});

test("stop from the UI expires only the selected work approval and persists after reload", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("本機已連線", { exact: true })).toBeVisible();
  await page.getByText("模型與工具", { exact: true }).click();
  await page.getByRole("checkbox", { name: "啟用合成測試" }).check();
  await page.getByRole("combobox").selectOption("http");
  await page.getByText("模型與工具", { exact: true }).click();
  const title = "Stop fixture " + Date.now();
  await page.getByRole("textbox").fill(title);
  await page.getByRole("button", { name: "開始驗證" }).click();
  const work = page.locator("article").filter({ hasText: title });
  await expect(
    work.getByRole("button", { name: "核准這次寫入" }),
  ).toBeVisible();
  await work.getByRole("button", { name: "停止", exact: true }).click();
  await expect(work.getByText("已取消", { exact: true })).toBeVisible();
  await expect(work.getByRole("button", { name: "核准這次寫入" })).toHaveCount(
    0,
  );
  await page.reload();
  await expect(
    page
      .locator("article")
      .filter({ hasText: title })
      .getByText("已取消", { exact: true }),
  ).toBeVisible();
});
