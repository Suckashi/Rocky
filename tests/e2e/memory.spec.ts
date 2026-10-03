import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { startAgentProvider } from "../../fixtures/models/agent-provider.js";
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

test("owner grants private memory in Work UI and native model receives only authorized search", async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const marker = "Grant browser " + randomUUID();
  const callId = randomUUID();
  const provider = await startAgentProvider({
    reply: async (messages) => {
      await held;
      const last = messages
        .filter((m) => m instanceof ToolMessage && m.tool_call_id === callId)
        .at(-1);
      if (last)
        return new AIMessage(
          String(last.content).includes(marker)
            ? "AUTHORIZED_MEMORY_RECEIVED"
            : "NO_MEMORY_RECEIVED",
        );
      return new AIMessage({
        content: "",
        tool_calls: [
          {
            id: callId,
            name: "memory_search",
            args: { scope: "user", includePrivate: true, query: marker },
            type: "tool_call",
          },
        ],
      });
    },
  });
  try {
    await page.goto("/");
    const { token } = await (await page.request.get("/api/v1/session")).json();
    const headers = { "x-rocky-session": token };
    const connectionId = randomUUID();
    expect(
      (
        await page.request.post("/api/v1/model-connections", {
          headers,
          data: {
            id: connectionId,
            requestId: randomUUID(),
            expectedRevision: 0,
            config: {
              name: "Memory browser provider",
              provider: "openai-compatible",
              baseUrl: provider.baseUrl,
              modelId: "fixture",
              contextWindowTokens: 65536,
              maxOutputTokens: 256,
            },
          },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await page.request.post("/api/v1/memories", {
          headers,
          data: {
            id: randomUUID(),
            requestId: randomUUID(),
            expectedRevision: 0,
            scope: { kind: "user" },
            content: marker,
            private: true,
          },
        })
      ).ok(),
    ).toBe(true);
    const response = await page.request.post("/api/v1/conversation/messages", {
      headers,
      data: {
        requestId: randomUUID(),
        text: marker,
        mode: "configured",
        modelSelection: { connectionId, revision: 1 },
      },
    });
    expect(response.ok()).toBe(true);
    const record = await response.json();
    await page.reload();
    const work = page.locator("article.work").filter({ hasText: marker });
    await work.getByText("工作詳情", { exact: true }).click();
    await work.getByText("此工作權限", { exact: true }).click();
    const grants = work.locator(".work-grants");
    await expect(grants.getByLabel("授權記憶範圍")).toHaveValue("task");
    const privateControl =
      grants.getByLabel("包含私密記憶（可能送至此工作的模型）");
    await expect(privateControl).not.toBeChecked();
    await grants.getByLabel("授權記憶範圍").selectOption("user");
    await privateControl.check();
    await grants.getByRole("button", { name: "授權讀取此範圍" }).click();
    await expect(grants).toContainText("個人 · 包含私密");
    await expect(
      grants.getByRole("button", { name: "授權讀取此範圍" }),
    ).toBeDisabled();
    for (const [width, height] of [
      [1440, 900],
      [1280, 800],
      [390, 844],
      [320, 844],
    ]) {
      await page.setViewportSize({ width: width!, height: height! });
      await grants.scrollIntoViewIfNeeded();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: "test-results/memory-grant-" + width + ".png",
      });
    }
    release();
    await expect(work).toContainText("AUTHORIZED_MEMORY_RECEIVED");
    await expect(
      grants.getByRole("button", { name: "授權讀取此範圍" }),
    ).toHaveCount(0);
    await grants.getByRole("button", { name: "撤銷此權限" }).click();
    await expect(grants).toContainText("已撤銷");
    const saved = await (
      await page.request.get("/api/v1/works/" + record.id + "/grants")
    ).json();
    expect(saved.grants[0]).toMatchObject({
      revoked: true,
      memory: { scope: "user", includePrivate: true },
    });
  } finally {
    release();
    await provider.close();
  }
});
