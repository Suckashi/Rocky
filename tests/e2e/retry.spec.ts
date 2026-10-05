import { test, expect } from "./fixture.js";
import { randomUUID } from "node:crypto";
import { AIMessage } from "@langchain/core/messages";
import { startAgentProvider } from "../../fixtures/models/agent-provider.js";
test("retry UI reviews receipts and creates a distinct Work; mobile controls remain operable", async ({
  page,
}) => {
  const provider = await startAgentProvider({
    reply: async () => new AIMessage("Observed retry fixture result."),
  });
  const name = "Retry UI " + Date.now(),
    connectionId = randomUUID();
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    const session = await (await page.request.get("/api/v1/session")).json();
    const saved = await page.request.post("/api/v1/model-connections", {
      headers: { "x-rocky-session": session.token },
      data: {
        requestId: randomUUID(),
        id: connectionId,
        expectedRevision: 0,
        config: {
          name,
          provider: "openai-compatible",
          baseUrl: provider.baseUrl,
          modelId: "retry",
          contextWindowTokens: 65536,
          maxOutputTokens: 128,
        },
      },
    });
    expect(saved.ok()).toBe(true);
    await page.goto("/");
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
    await page.locator("#compose textarea").fill(name);
    await page.getByRole("button", { name: "送出", exact: true }).click();
    const original = page
      .locator("article.work")
      .filter({ hasText: name })
      .first();
    await expect(original.getByText("已完成", { exact: true })).toBeVisible();
    await original.locator("summary").filter({ hasText: "工作詳情" }).click();
    await original.getByText("重試為新工作", { exact: true }).click();
    await expect(
      original.getByText("沒有已記錄的工具副作用。", { exact: true }),
    ).toBeVisible();
    await expect(
      original.getByRole("button", { name: "建立重試工作", exact: true }),
    ).toBeDisabled();
    const confirmation =
      original.getByLabel("已確認上述效果紀錄，建立新的工作");
    await confirmation.check();
    await page.screenshot({ path: "test-results/retry-review-1440.png" });
    await original
      .getByRole("button", { name: "建立重試工作", exact: true })
      .click();
    const retry = page
      .locator("article.work")
      .filter({ hasText: "重試工作 · 新的執行" })
      .filter({ hasText: name });
    await expect(retry.getByText("已完成", { exact: true })).toBeVisible();
    const works = (
      await (await page.request.get("/api/v1/snapshot")).json()
    ).works.filter((w: { text: string }) => w.text === name);
    expect(works).toHaveLength(2);
    expect(works[1].retryOf).toBe(works[0].id);
    expect(works[1].runId).not.toBe(works[0].runId);
    await page.reload();
    await page.setViewportSize({ width: 320, height: 844 });
    await original.locator("summary").filter({ hasText: "工作詳情" }).click();
    await original.getByText("重試為新工作", { exact: true }).click();
    await confirmation.focus();
    await page.keyboard.press("Space");
    await expect(confirmation).toBeChecked();
    const mobileRetry = original.getByRole("button", {
      name: "建立重試工作",
      exact: true,
    });
    await mobileRetry.scrollIntoViewIfNeeded();
    await mobileRetry.focus();
    await expect(mobileRetry).toBeVisible();
    const control = await mobileRetry.boundingBox(),
      composer = await page.locator(".composer-wrap").boundingBox();
    expect(
      control && composer && control.y + control.height <= composer.y,
    ).toBeTruthy();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: "test-results/retry-mobile-320.png" });
  } finally {
    await provider.close();
  }
});
