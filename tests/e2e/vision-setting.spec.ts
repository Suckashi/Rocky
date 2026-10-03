import { test, expect } from "@playwright/test";
test("model image input is explicit, defaults off, persists without claiming a passed probe, and fits four widths", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "設定", exact: true }).last().click();
  await page.getByText("模型連線設定", { exact: true }).click();
  const name = "Image setting fixture " + Date.now();
  await page.getByLabel("名稱", { exact: true }).fill(name);
  await page
    .getByLabel("API 基底網址（包含版本路徑）")
    .fill("http://127.0.0.1:1/v1");
  await page
    .getByLabel("模型 ID", { exact: true })
    .fill("explicit-image-fixture");
  await page.getByText("代理與 CA", { exact: true }).click();
  const toggle = page.getByLabel(
    "啟用模型影像輸入（需自行確認模型支援；不代表已通過測試）",
    { exact: true },
  );
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await page.getByRole("button", { name: "保存連線", exact: true }).click();
  await expect(
    page
      .locator(".model-card")
      .filter({ hasText: name })
      .getByText("尚未測試此版本", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "設定", exact: true }).last().click();
  await page.getByText("模型連線設定", { exact: true }).click();
  await page
    .locator(".model-card")
    .filter({ hasText: name })
    .getByRole("button", { name: "編輯", exact: true })
    .click();
  await page.getByText("代理與 CA", { exact: true }).click();
  await expect(toggle).toBeChecked();
  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
    [390, 844],
    [320, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await toggle.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: `test-results/model-vision-${width}.png` });
  }
  await toggle.uncheck();
  await page.getByRole("button", { name: "保存連線", exact: true }).click();
  await expect
    .poll(async () => {
      const { connections } = await (
        await page.request.get("/api/v1/model-connections")
      ).json();
      return connections.find(
        (model: { config: { name: string } }) => model.config.name === name,
      ).config.visionEnabled;
    })
    .toBe(false);
});
