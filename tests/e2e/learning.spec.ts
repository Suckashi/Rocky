import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
test("Learning UI requires scoped consent, preserves stale drafts and turns policy off", async ({
  page,
}) => {
  await page.goto("/");
  const { token } = await (await page.request.get("/api/v1/session")).json();
  const headers = { "x-rocky-session": token };
  const initial = await (
    await page.request.get("/api/v1/learning/policy")
  ).json();
  expect(
    (
      await page.request.post("/api/v1/learning/policy", {
        headers,
        data: {
          requestId: randomUUID(),
          expectedRevision: initial.revision,
          mode: "off",
          scopes: [],
        },
      })
    ).ok(),
  ).toBe(true);
  await page.getByRole("button", { name: "Learning", exact: true }).click();
  const ui = page.locator(".learning-settings");
  await expect(ui.locator(':scope > [role="status"]')).toContainText("off");
  await expect(ui).toContainText("尚未接通");
  await ui.getByLabel("Learning 模式").selectOption("propose");
  const save = ui.getByRole("button", { name: "保存學習政策" });
  await expect(save).toBeDisabled();
  await ui.getByLabel("個人範圍（不包含專案）").check();
  await expect(save).toBeDisabled();
  await ui.getByLabel("我同意在以上範圍提出學習候選").check();
  await save.click();
  await expect(ui.locator(':scope > [role="status"]')).toContainText("propose");
  await expect(ui.getByLabel("我同意在以上範圍提出學習候選")).not.toBeChecked();
  const current = await (
    await page.request.get("/api/v1/learning/policy")
  ).json();
  expect(current.scopes).toEqual([{ kind: "user" }]);
  expect(
    (
      await page.request.post("/api/v1/learning/policy", {
        headers,
        data: {
          requestId: randomUUID(),
          expectedRevision: current.revision,
          mode: "off",
          scopes: [],
        },
      })
    ).ok(),
  ).toBe(true);
  await ui.getByLabel("我同意在以上範圍提出學習候選").check();
  await save.click();
  await expect(ui.getByRole("alert")).toContainText("revision changed");
  await expect(ui.getByLabel("Learning 模式")).toHaveValue("propose");
  await ui.getByRole("button", { name: "重新載入政策（放棄草稿）" }).click();
  await expect(ui.getByLabel("Learning 模式")).toHaveValue("off");
  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
    [390, 844],
    [320, 844],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/learning-policy-${width}.png`,
    });
  }
  await ui.getByLabel("Learning 模式").selectOption("propose");
  await ui.getByLabel("個人範圍（不包含專案）").check();
  await ui.getByLabel("我同意在以上範圍提出學習候選").check();
  await save.click();
  await expect(ui.locator(':scope > [role="status"]')).toContainText("propose");
  await ui.getByLabel("Learning 模式").selectOption("off");
  await save.click();
  await expect(ui.locator(':scope > [role="status"]')).toContainText("off");
  expect(
    (await (await page.request.get("/api/v1/learning/policy")).json()).scopes,
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("work Learning consent defaults excluded, saves review consent and withdraws", async ({
  page,
}) => {
  const { AIMessage, ToolMessage } = await import("@langchain/core/messages");
  const { startAgentProvider } =
    await import("../../fixtures/models/agent-provider.js");
  const callId = randomUUID();
  let reflecting = false;
  const provider = await startAgentProvider({
    reply: async (messages) =>
      reflecting
        ? messages.some((m) => m instanceof ToolMessage)
          ? new AIMessage("Reflection complete")
          : new AIMessage({
              content: "",
              tool_calls: [
                {
                  id: randomUUID(),
                  name: "mark_no_learning",
                  args: { reason: "Fixture lacks independent evidence" },
                  type: "tool_call",
                },
              ],
            })
        : messages.some(
              (message) =>
                message instanceof ToolMessage &&
                message.tool_call_id === callId,
            )
          ? new AIMessage("Finished local consent fixture")
          : new AIMessage({
              content: "",
              tool_calls: [
                {
                  id: callId,
                  name: "write_todos",
                  args: {
                    todos: [
                      { content: "Record observed plan", status: "completed" },
                    ],
                  },
                  type: "tool_call",
                },
              ],
            }),
  });
  try {
    await page.goto("/");
    const { token } = await (await page.request.get("/api/v1/session")).json();
    const headers = { "x-rocky-session": token },
      connectionId = randomUUID(),
      marker = "Work consent " + randomUUID();
    expect(
      (
        await page.request.post("/api/v1/model-connections", {
          headers,
          data: {
            id: connectionId,
            requestId: randomUUID(),
            expectedRevision: 0,
            config: {
              name: "Consent fixture",
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
    const created = await response.json();
    await page.reload();
    const work = page.locator("article.work").filter({ hasText: marker });
    await work.locator(":scope > details > summary").click();
    const ui = work.locator(".work-learning");
    await ui.locator("summary").click();
    await expect(ui.locator(':scope > [role="status"]')).toContainText(
      "排除學習",
    );
    await expect(ui.getByLabel("排除此工作學習")).toBeChecked();
    await expect(ui.getByLabel("我確認來源條款允許重用")).not.toBeChecked();
    await ui.getByLabel("排除此工作學習").uncheck();
    await ui.getByLabel("我確認來源條款允許重用").check();
    await ui.getByRole("button", { name: "保存此工作學習權限" }).click();
    await expect(ui.locator(':scope > [role="status"]')).toContainText(
      "允許來源審查",
    );
    const episodeForm = ui.locator(".learning-episode-form");
    await episodeForm.locator("summary").click();
    await episodeForm
      .getByLabel("可重用的目標")
      .fill("Reusable browser summary password=fixture-private");
    await episodeForm
      .getByLabel("驗證結果（每行一項）")
      .fill("Observed plan update, not a general success claim");
    await episodeForm.getByRole("checkbox").first().check();
    await episodeForm.getByRole("button", { name: "保存待審查摘要" }).click();
    await expect(episodeForm.getByRole("status")).toContainText("待審查");
    await expect(episodeForm).toContainText("[REDACTED]");
    await expect(episodeForm).not.toContainText("fixture-private");
    const episodeId = await episodeForm.locator("code").textContent();
    await page.setViewportSize({ width: 320, height: 844 });
    await episodeForm.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: "test-results/learning-episode-320.png" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "Learning", exact: true }).click();
    const library = page.locator(".learning-episodes");
    await library.locator(":scope > summary").click();
    await library.getByRole("button", { name: "載入／重新整理摘要" }).click();
    const episodeCard = library
      .locator("article")
      .filter({ hasText: episodeId! });
    await expect(episodeCard).toHaveCount(1);
    await episodeCard.getByText("檢視摘要內容", { exact: true }).click();
    await expect(episodeCard).toContainText("Observed plan update");
    await expect(
      episodeCard.getByRole("button", { name: "核准這份摘要" }),
    ).toBeDisabled();
    await episodeCard.getByLabel("我已審查這份摘要及來源").check();
    await episodeCard.getByRole("button", { name: "核准這份摘要" }).click();
    await expect(episodeCard).toContainText("已核准摘要");
    reflecting = true;
    const reflection = episodeCard.locator(".learning-reflection");
    await reflection.locator(":scope > summary").click();
    await reflection
      .getByRole("button", { name: "載入模型與最近反思" })
      .click();
    await reflection.getByLabel("反思模型").selectOption(connectionId);
    await reflection.getByRole("button", { name: "啟動受限反思" }).click();
    await expect(reflection.getByRole("status")).toBeVisible();
    await expect
      .poll(async () => {
        await reflection
          .getByRole("button", { name: "重新整理反思結果" })
          .click();
        return await reflection.getByRole("status").textContent();
      })
      .toContain("已完成");
    await expect(reflection).toContainText("沒有可重用的結論");
    await expect(reflection).toContainText(
      "Fixture lacks independent evidence",
    );
    for (const [width, height] of [
      [1440, 900],
      [1280, 800],
      [390, 844],
      [320, 844],
    ]) {
      await page.setViewportSize({ width: width!, height: height! });
      await reflection.scrollIntoViewIfNeeded();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: "test-results/reflection-" + width + ".png",
      });
    }

    await page.setViewportSize({ width: 320, height: 844 });
    await episodeCard.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: "test-results/learning-library-320.png" });
    await page.keyboard.press("Escape");
    await ui.getByLabel("私人來源，不用於學習").check();
    await ui.getByRole("button", { name: "保存此工作學習權限" }).click();
    await expect(ui.locator(':scope > [role="status"]')).toContainText(
      "排除學習",
    );
    expect(
      (
        await page.request.get(`/api/v1/learning/episodes/${episodeId}`)
      ).status(),
    ).toBe(403);
    expect(
      (
        await (await page.request.get("/api/v1/learning/episodes")).json()
      ).items.some((item: { id: string }) => item.id === episodeId),
    ).toBe(false);
    const saved = await (
      await page.request.get(`/api/v1/works/${created.id}/learning-consent`)
    ).json();
    expect(saved).toMatchObject({ private: true, revision: 2 });
    for (const [width, height] of [
      [1440, 900],
      [1280, 800],
      [390, 844],
      [320, 844],
    ]) {
      await page.setViewportSize({ width: width!, height: height! });
      await ui.scrollIntoViewIfNeeded();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/work-learning-${width}.png`,
      });
    }
    await page.reload();
    await work.locator(":scope > details > summary").click();
    await ui.locator("summary").click();
    await expect(ui.getByLabel("私人來源，不用於學習")).toBeChecked();
  } finally {
    await provider.close();
  }
});

test("explicit UI fixture renders renewed-review state and sends the new exact hash", async ({
  page,
}) => {
  const id = randomUUID(),
    hash = "b".repeat(64);
  let state = "needs_review";
  const item = {
    id,
    workId: randomUUID(),
    createdAt: "2026-10-04T00:00:00Z",
    revision: 2,
    contentHash: hash,
    status: state,
    summary: {
      goal: "Changed redacted summary fixture",
      constraints: [],
      corrections: [],
      verification: ["UI fixture only"],
      failuresAndRepairs: [],
      preconditions: [],
    },
    evidence: [],
  };
  await page.route("**/api/v1/learning/episodes", (route) =>
    route.fulfill({
      json: { items: [{ ...item, status: state }], nextCursor: null },
    }),
  );
  await page.route(
    `**/api/v1/learning/episodes/${id}/review`,
    async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        expectedRevision: 2,
        contentHash: hash,
        decision: "approve",
      });
      state = "approved";
      await route.fulfill({
        json: { id, revision: 3, status: state, reviewedHash: hash },
      });
    },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Learning", exact: true }).click();
  const ui = page.locator(".learning-episodes");
  await ui.locator(":scope > summary").click();
  await ui.getByRole("button", { name: "載入／重新整理摘要" }).click();
  const card = ui.locator("article");
  await expect(card).toContainText("需要重新審查");
  await card.getByText("檢視摘要內容", { exact: true }).click();
  const approve = card.getByRole("button", { name: "核准這份摘要" });
  await expect(approve).toBeDisabled();
  await card.getByLabel("我已審查這份摘要及來源").check();
  await page.setViewportSize({ width: 320, height: 844 });
  await approve.scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/learning-rereview-320.png" });
  await approve.click();
  await expect(card).toContainText("已核准摘要");
});
