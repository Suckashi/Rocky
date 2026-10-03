import { test, expect } from "@playwright/test";
import { startAgentProvider } from "../../fixtures/models/agent-provider.js";
test("T-007 UI selected model → CopilotKit → configured Work → approval → recorded usage", async ({
  page,
}) => {
  const server = await startAgentProvider();
  const name = `Configured UI ${Date.now()}`,
    prompt = `Inspect synthetic sample ${Date.now()}`;
  try {
    await page.goto("/");
    await page
      .getByRole("button", { name: "設定", exact: true })
      .last()
      .click();
    await page.getByText("模型連線設定", { exact: true }).click();
    await page.getByLabel("名稱", { exact: true }).fill(name);
    await page.getByLabel("API 基底網址（包含版本路徑）").fill(server.baseUrl);
    await page.getByLabel("模型 ID", { exact: true }).fill("scripted");
    await page.getByLabel("Context tokens（留空表示未知）").fill("4096");
    await page.getByRole("button", { name: "保存連線", exact: true }).click();
    const model = page.locator(".model-card").filter({ hasText: name });
    await model
      .getByRole("button", { name: "使用此模型", exact: true })
      .click();
    expect(server.requests).toHaveLength(0);
    await page.keyboard.press("Escape");
    await page.locator("textarea").fill(prompt);
    await page
      .getByRole("button", { name: "傳送至模型", exact: false })
      .click();
    const work = page.locator("article.work").filter({ hasText: prompt });
    await expect(
      work.getByRole("button", { name: "核准這次寫入", exact: true }),
    ).toBeVisible();
    await work
      .getByRole("button", { name: "核准這次寫入", exact: true })
      .click();
    await expect(work.getByText("已完成", { exact: true })).toBeVisible();
    const works = (await (await page.request.get("/api/v1/works")).json())
      .works;
    const saved = works.find((w: { text: string }) => w.text === prompt);
    expect(saved.mode).toBe("configured");
    expect(saved.modelSelection.revision).toBe(1);
    const usage = await (
      await page.request.get(`/api/v1/works/${saved.id}/model-usage`)
    ).json();
    expect(usage.calls).toBe(server.requests.length);
    expect(usage.unknownUsageCalls).toBe(0);
    await page.reload();
    await expect(work.getByText("已完成", { exact: true })).toBeVisible();
    await work.screenshot({ path: "test-results/configured-work-result.png" });
  } finally {
    await server.close();
  }
});
