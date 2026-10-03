import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
test("owner memory UI preserves stale drafts, persists edits and deletes search entries", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "設定", exact: true }).first().click();
  const ui = page.locator(".memory-settings");
  await ui.locator("summary").click();
  const text = "Memory browser " + randomUUID();
  await ui.getByRole("button", { name: "新增記憶", exact: true }).click();
  await ui.getByLabel("記憶內容").fill(text);
  await ui.getByRole("button", { name: "儲存記憶" }).click();
  const card = ui.locator("article").filter({ hasText: text });
  await expect(card).toContainText("私密");
  await ui.getByLabel("搜尋記憶").fill(text);
  await ui.getByRole("button", { name: "搜尋／重新整理" }).click();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "編輯", exact: true }).click();
  await ui.getByLabel("記憶內容").fill(text + " draft");
  const { token } = await (await page.request.get("/api/v1/session")).json();
  const headers = { "x-rocky-session": token };
  const result = await (
    await page.request.post("/api/v1/memories/search", {
      headers,
      data: { scope: { kind: "user" }, query: text },
    })
  ).json();
  const item = result.items[0];
  expect(
    (
      await page.request.post("/api/v1/memories", {
        headers,
        data: {
          requestId: randomUUID(),
          id: item.id,
          expectedRevision: 1,
          scope: item.scope,
          content: text + " newer",
        },
      })
    ).ok(),
  ).toBe(true);
  await ui.getByRole("button", { name: "儲存記憶" }).click();
  await expect(ui.getByRole("alert")).toBeVisible();
  await expect(ui.getByLabel("記憶內容")).toHaveValue(text + " draft");
  await ui.getByRole("button", { name: "放棄草稿" }).click();
  await ui.getByRole("button", { name: "搜尋／重新整理" }).click();
  await expect(card).toContainText("newer");
  await card.getByRole("button", { name: "編輯", exact: true }).click();
  await ui.getByLabel("記憶內容").fill(text + " saved");
  await ui.getByRole("button", { name: "儲存記憶" }).click();
  await expect(card).toContainText("saved");
  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
    [390, 844],
    [320, 844],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    await card.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: ".rocky-reports/memory-ui/after-" + width + ".png",
    });
  }
  await page.reload();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "設定", exact: true }).first().click();
  await ui.locator("summary").click();
  await ui.getByLabel("搜尋記憶").fill(text);
  await ui.getByRole("button", { name: "搜尋／重新整理" }).click();
  await expect(card).toContainText("saved");
  await card.getByRole("button", { name: "刪除", exact: true }).click();
  await card.getByRole("button", { name: "確認刪除" }).click();
  await expect(card).toHaveCount(0);
});
