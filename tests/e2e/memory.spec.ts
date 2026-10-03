import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("memory scope isolation, private flags, error recovery and keyboard controls in dark English settings", async ({
  page,
}) => {
  const root = await mkdtemp(join(tmpdir(), "rocky-memory-scope-"));
  try {
    await page.goto("/");
    const { token } = await (await page.request.get("/api/v1/session")).json();
    const headers = { "x-rocky-session": token };
    const id = randomUUID(),
      marker = "Scope " + randomUUID();
    expect(
      (
        await page.request.post("/api/v1/workspaces", {
          headers,
          data: {
            id,
            requestId: randomUUID(),
            expectedRevision: 0,
            name: marker,
            root,
          },
        })
      ).ok(),
    ).toBe(true);
    for (const [scope, content] of [
      [{ kind: "user" }, marker + " USER_ONLY"],
      [
        { kind: "project", id },
        marker + " PROJECT_ONLY " + "長文字".repeat(90),
      ],
    ] as const) {
      expect(
        (
          await page.request.post("/api/v1/memories", {
            headers,
            data: {
              id: randomUUID(),
              requestId: randomUUID(),
              expectedRevision: 0,
              scope,
              content,
            },
          })
        ).ok(),
      ).toBe(true);
    }
    await page.reload();
    await page
      .getByRole("button", { name: "設定", exact: true })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "English", exact: true }).click();
    await dialog.getByRole("button", { name: "Toggle theme" }).click();
    const ui = page.locator(".memory-settings");
    await ui.locator("summary").focus();
    await page.keyboard.press("Enter");
    await ui.getByLabel("Search memory", { exact: true }).fill(marker);
    const search = ui.getByRole("button", { name: "Search / refresh" });
    await search.click();
    await expect(ui.locator("article")).toHaveCount(1);
    await expect(ui.locator("article")).toContainText("USER_ONLY");
    await ui.getByLabel("Memory scope").selectOption("project:" + id);
    await expect(ui.locator("article")).toHaveCount(0);
    await search.click();
    await expect(ui.locator("article")).toContainText("PROJECT_ONLY");
    await expect(ui.locator("article")).not.toContainText("USER_ONLY");
    await ui
      .locator("article")
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    await expect(ui.getByLabel("Memory scope")).toBeDisabled();
    await ui.getByLabel("Verification status").selectOption("conflicted");
    await ui.getByLabel("Private (excluded from Learning)").uncheck();
    await ui.getByRole("button", { name: "Save memory", exact: true }).click();
    await expect(ui.locator("article")).toContainText("Conflicted");
    await expect(ui.locator("article")).toContainText("Not private");
    await page.route(
      "**/api/v1/memories/search",
      (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Explicit browser failure fixture" }),
        }),
      { times: 1 },
    );
    await search.click();
    await expect(ui.getByRole("alert")).toBeVisible();
    await expect(ui.locator("article")).toContainText("PROJECT_ONLY");
    await search.focus();
    await page.keyboard.press("Enter");
    await expect(ui.getByRole("alert")).toHaveCount(0);
    for (const [width, height] of [
      [1440, 900],
      [1280, 800],
      [390, 844],
      [320, 844],
    ]) {
      await page.setViewportSize({ width: width!, height: height! });
      await ui.locator("article").scrollIntoViewIfNeeded();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: ".rocky-reports/memory-ui/dark-en-" + width + ".png",
      });
    }
    await ui.getByLabel("Memory scope").selectOption("user");
    await expect(ui.locator("article")).toHaveCount(0);
    await search.click();
    await expect(ui.locator("article")).toContainText("USER_ONLY");
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
