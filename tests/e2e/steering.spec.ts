import { test, expect } from "./fixture.js";
import { AIMessage } from "@langchain/core/messages";
import { startAgentProvider } from "../../fixtures/models/agent-provider.js";
test("owner steering shows accepted then checkpoint-applied and survives reload on mobile", async ({
  page,
}) => {
  let release!: () => void,
    entered = false;
  const held = new Promise<void>((resolve) => (release = resolve));
  const prompt = `Steering UI ${Date.now()}`,
    correction = "Correction: inspect only; publish nothing.";
  const server = await startAgentProvider({
    reply: async (messages) => {
      const last = String(
        messages.findLast((m) => m.type === "human")?.content,
      );
      if (last === prompt) {
        entered = true;
        await held;
        return new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "ui-todo",
              name: "write_todos",
              args: { todos: [{ content: "verify", status: "in_progress" }] },
              type: "tool_call",
            },
          ],
        });
      }
      expect(last).toBe(correction);
      return new AIMessage("Correction confirmed by fixture.");
    },
  });
  try {
    await page.goto("/");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page
      .getByRole("button", { name: "設定", exact: true })
      .last()
      .click();
    await page.getByText("模型連線設定", { exact: true }).click();
    await page.getByLabel("名稱", { exact: true }).fill(prompt);
    await page.getByLabel("API 基底網址（包含版本路徑）").fill(server.baseUrl);
    await page.getByLabel("模型 ID", { exact: true }).fill("steering");
    await page.getByLabel("Context tokens（留空表示未知）").fill("65536");
    await page.getByRole("button", { name: "保存連線", exact: true }).click();
    await page
      .locator(".model-card")
      .filter({ hasText: prompt })
      .getByRole("button", { name: "使用此模型", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await page.locator("#compose textarea").fill(prompt);
    await page
      .getByRole("button", { name: "傳送至模型", exact: false })
      .click();
    await expect.poll(() => entered).toBe(true);
    const work = page.locator("article.work").filter({ hasText: prompt });
    await work.locator("summary").filter({ hasText: "工作詳情" }).click();
    await work.getByText("修正工作", { exact: true }).click();
    await work.getByLabel("工作修正內容").fill(correction);
    await work.getByRole("button", { name: "送出修正", exact: true }).click();
    await expect(
      work.getByText("修正已收件，尚未套用", { exact: true }),
    ).toBeVisible();
    await work.screenshot({ path: "test-results/steering-accepted-1440.png" });
    release();
    await expect(work.getByText("已完成", { exact: true })).toBeVisible();
    await expect(
      work.getByText("修正已套用至執行脈絡", { exact: true }),
    ).toBeVisible();
    await work.screenshot({ path: "test-results/steering-applied-1440.png" });
    await page.reload();
    await page.setViewportSize({ width: 390, height: 844 });
    await work.locator("summary").filter({ hasText: "工作詳情" }).click();
    await work.getByText("修正工作", { exact: true }).click();
    await expect(
      work.getByText("修正已套用至執行脈絡", { exact: true }),
    ).toBeVisible();
    await expect(work.getByText(correction, { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await work.screenshot({ path: "test-results/steering-applied-390.png" });
  } finally {
    release();
    await server.close();
  }
});
