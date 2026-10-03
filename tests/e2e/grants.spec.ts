import { test, expect } from "@playwright/test";
test("T-008 Work permission revocation persists through UI reload", async ({
  page,
}) => {
  const prompt = `Grant UI ${Date.now()}`;
  await page.goto("/");
  await page.getByLabel("啟用合成測試").check();
  await page.locator("textarea").fill(prompt);
  await page.getByRole("button", { name: /開始驗證/ }).click();
  const work = page.locator("article.work").filter({ hasText: prompt });
  await expect(
    work.getByRole("button", { name: "核准這次寫入", exact: true }),
  ).toBeVisible();
  await work.getByText("工作詳情", { exact: true }).click();
  await work.getByText("此工作權限", { exact: true }).click();
  await expect(work.getByText("讀取合成資料", { exact: true })).toBeVisible();
  await work.getByRole("button", { name: "撤銷此權限", exact: true }).click();
  await expect(work.getByText("已撤銷", { exact: true })).toBeVisible();
  await page.reload();
  await work.getByText("工作詳情", { exact: true }).click();
  await work.getByText("此工作權限", { exact: true }).click();
  await expect(work.getByText("已撤銷", { exact: true })).toBeVisible();
  await work.getByRole("button", { name: "拒絕", exact: true }).click();
  await expect(work.getByText("已完成", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 800 });
  const permissions = work.locator(".work-grants");
  await permissions.scrollIntoViewIfNeeded();
  await permissions.screenshot({ path: "test-results/grants-mobile.png" });
});
