import { test, expect } from "@playwright/test";
import { startAgentProvider } from "../../fixtures/models/agent-provider.js";

test("real provider SSE is visible before completion and daemon stop cancels the selected stream", async ({
  page,
}) => {
  test.setTimeout(60000);
  const server = await startAgentProvider({ streamDelayMs: 300 });
  const name = `Streaming UI ${Date.now()}`;
  try {
    await page.goto("/");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page
      .getByRole("button", { name: "設定", exact: true })
      .last()
      .click();
    await page.getByText("模型連線設定", { exact: true }).click();
    await page.getByLabel("名稱", { exact: true }).fill(name);
    await page.getByLabel("API 基底網址（包含版本路徑）").fill(server.baseUrl);
    await page.getByLabel("模型 ID", { exact: true }).fill("stream-fixture");
    await page.getByLabel("Context tokens（留空表示未知）").fill("4096");
    await page.getByRole("button", { name: "保存連線", exact: true }).click();
    await page
      .locator(".model-card")
      .filter({ hasText: name })
      .getByRole("button", { name: "使用此模型", exact: true })
      .click();
    await page.keyboard.press("Escape");
    for (const cancel of [false, true]) {
      const prompt = `Stream ${cancel ? "stop" : "complete"} ${Date.now()}`;
      await page.locator("textarea").fill(prompt);
      await page.getByRole("button", { name: "傳送至模型" }).click();
      const work = page.locator("article.work").filter({ hasText: prompt });
      await work.getByRole("button", { name: "核准這次寫入" }).click();
      await expect(work.locator(".stream-label")).toBeVisible();
      await expect(work.getByText("執行中", { exact: true })).toBeVisible();
      await expect(work.getByText("已完成", { exact: true })).toHaveCount(0);
      const snapshot = await (
        await page.request.get("/api/v1/snapshot")
      ).json();
      const current = snapshot.works.find(
        (w: { text: string }) => w.text === prompt,
      );
      expect(current.status).toBe("running");
      expect(current.answer).toBe("");
      const deltas = snapshot.events.filter(
        (e: {
          workId: string;
          payload: { name?: string; data: { phase?: string } };
        }) =>
          e.workId === current.id &&
          e.payload.name === "rocky.model.stream" &&
          e.payload.data.phase === "delta",
      );
      expect(deltas.length).toBeGreaterThan(0);
      await work.screenshot({
        path: `test-results/stream-${cancel ? "before-stop" : "partial"}.png`,
      });
      await page.screenshot({
        path: `test-results/stream-${cancel ? "before-stop" : "partial"}-1440.png`,
      });
      if (cancel) {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({
          path: "test-results/stream-before-stop-390.png",
        });
        await page
          .getByRole("button", { name: "停止目前工作", exact: true })
          .click();
        await expect(work.getByText("已取消", { exact: true })).toBeVisible();
        await page.reload();
        await expect(work.getByText("已取消", { exact: true })).toBeVisible();
      } else {
        await expect(work.getByText("已完成", { exact: true })).toBeVisible();
        await expect(work.locator(".stream-label")).toHaveCount(0);
      }
    }
  } finally {
    await server.close();
  }
});
