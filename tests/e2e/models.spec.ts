import { test, expect } from "./fixture.js";
import { startProbeFixture } from "../../fixtures/models/probe-server.js";
test("T-007 connection settings save without traffic, probe, reload and mobile edit", async ({
  page,
}) => {
  const fixture = await startProbeFixture();
  const title = `Model fixture ${Date.now()}`;
  try {
    await page.goto("/");
    await page
      .getByRole("button", { name: "設定", exact: true })
      .last()
      .click();
    await page.getByText("模型連線設定", { exact: true }).click();
    await page.getByLabel("名稱", { exact: true }).fill(title);
    await page.getByLabel("API 基底網址（包含版本路徑）").fill(fixture.baseUrl);
    await page.getByLabel("模型 ID", { exact: true }).fill("probe-fixture");
    await page.getByRole("button", { name: "保存連線", exact: true }).click();
    const card = page.locator(".model-card").filter({ hasText: title });
    await expect(card.getByText("尚未測試此版本")).toBeVisible();
    expect(fixture.requests).toHaveLength(0);
    await card.getByRole("button", { name: "測試連線", exact: true }).click();
    await expect(card.getByText("工具往返: 通過")).toBeVisible();
    await expect(card.getByText("串流: 通過")).toBeVisible();
    await card.screenshot({
      path: "test-results/rocky-model-probe-result.png",
    });
    expect(fixture.requests).toHaveLength(5);
    await page.reload();
    await page
      .getByRole("button", { name: "設定", exact: true })
      .last()
      .click();
    await page.getByText("模型連線設定", { exact: true }).click();
    await expect(card.getByText("文字: 通過")).toBeVisible();
    await card.getByRole("button", { name: "編輯", exact: true }).click();
    await page.getByLabel("模型 ID", { exact: true }).fill("another-fixture");
    await page.getByRole("button", { name: "保存連線", exact: true }).click();
    await expect(card.getByText("尚未測試此版本")).toBeVisible();
    expect(fixture.requests).toHaveLength(5);
    await page.getByRole("button", { name: "English", exact: true }).click();
    await page.setViewportSize({ width: 320, height: 800 });
    await expect(
      page.getByRole("button", { name: "Save connection", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/rocky-model-settings-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page
      .getByRole("button", { name: "Toggle theme", exact: true })
      .click();
    await page
      .locator("details.model-settings")
      .first()
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "test-results/rocky-model-settings-desktop.png",
      fullPage: true,
    });
  } finally {
    await fixture.close();
  }
});
