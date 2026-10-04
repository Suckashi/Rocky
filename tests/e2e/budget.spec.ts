import { test, expect } from "./fixture.js";

test("T-007 editable call cap is pinned through CopilotKit and visible after reload", async ({
  page,
}) => {
  const prompt = `Budget UI ${Date.now()}`;
  await page.goto("/");
  await page.getByText("進階選項", { exact: true }).click();
  await page.getByLabel("啟用合成測試").check();
  // The budget lives inside the advanced options popover.
  await page.getByText("工作預算 · 48", { exact: true }).click();
  const input = page.getByLabel("模型呼叫上限", { exact: true });
  await input.fill("0");
  await page.locator("#compose textarea").fill(prompt);
  const send = page.getByRole("button", { name: "送出", exact: true });
  await expect(send).toBeDisabled();
  await input.fill("1");
  await expect(send).toBeEnabled();
  await send.click();
  const work = page.locator("article.work").filter({ hasText: prompt });
  await expect(work.getByText("失敗", { exact: true })).toBeVisible();
  const saved = (
    await (await page.request.get("/api/v1/works")).json()
  ).works.find((w: { text: string }) => w.text === prompt);
  expect(saved.modelBudget.maxCalls).toBe(1);
  const usage = await (
    await page.request.get(`/api/v1/works/${saved.id}/model-usage`)
  ).json();
  expect(usage.calls).toBe(1);
  // Sending closes the options popover; reopen it to reset the budget.
  await page.getByText("進階選項", { exact: true }).click();
  await input.fill("48");
  await page.reload();
  await work.getByText("工作詳情", { exact: true }).click();
  await expect(
    work.getByText("此工作模型呼叫上限: 1", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 800 });
  await page.getByText("進階選項", { exact: true }).click();
  await page.getByText("工作預算 · 48", { exact: true }).click();
  await expect(input).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/work-budget-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(
    page.getByLabel("Maximum model calls", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Root, children and summaries share one budget. Each request reserves the configured context capacity, then settles reported usage; missing usage keeps the reservation. Without trusted prices cost is unknown. Estimates are not provider invoices or spending guarantees.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/work-budget-en-light.png",
    fullPage: true,
  });
});
