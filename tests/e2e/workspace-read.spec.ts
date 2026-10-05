import { test, expect } from "./fixture.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { AIMessage } from "@langchain/core/messages";
import { startAgentProvider } from "../../fixtures/models/agent-provider.js";

test("explicit workspace selection and read scope reaches real native Work through composer", async ({
  page,
}) => {
  const requestFailures: { path: string; error?: string }[] = [];
  page.on("requestfailed", (req) =>
    requestFailures.push({
      path: new URL(req.url()).pathname,
      error: req.failure()?.errorText,
    }),
  );
  const root = await mkdtemp(join(tmpdir(), "rocky-browser-native-read-")),
    name = "Workspace read " + Date.now(),
    model = "Workspace model " + Date.now();
  await writeFile(join(root, "actual.md"), "BROWSER_ACTUAL_OWNER_FILE");
  const provider = await startAgentProvider({
    reply: async (messages) => {
      const turn = messages.findLastIndex(
        (m) =>
          m.type === "human" &&
          String(m.content).startsWith("Workspace browser read "),
      );
      const last = messages
        .slice(turn + 1)
        .filter((m) => m.type === "tool")
        .at(-1);
      if (last?.name === "workspace_read")
        return new AIMessage("Read receipt: " + String(last.content));
      const tool = !last
        ? "workspace_info"
        : last.name === "workspace_info"
          ? "workspace_files"
          : "workspace_read";
      return new AIMessage({
        content: "",
        tool_calls: [
          {
            id: tool + "-browser",
            name: tool,
            args: tool === "workspace_read" ? { path: "actual.md" } : {},
            type: "tool_call",
          },
        ],
      });
    },
  });
  try {
    await page.goto("/");
    const { token } = await (await page.request.get("/api/v1/session")).json(),
      headers = { "x-rocky-session": token };
    const workspaceId = randomUUID(),
      connectionId = randomUUID();
    expect(
      (
        await page.request.post("/api/v1/workspaces", {
          headers,
          data: {
            id: workspaceId,
            requestId: randomUUID(),
            expectedRevision: 0,
            name,
            root,
          },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await page.request.post("/api/v1/model-connections", {
          headers,
          data: {
            id: connectionId,
            requestId: randomUUID(),
            expectedRevision: 0,
            config: {
              name: model,
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
    await page.getByRole("button", { name: "工作區", exact: true }).click();
    await page
      .getByRole("dialog")
      .locator(".model-card")
      .filter({ has: page.getByRole("heading", { name, exact: true }) })
      .getByRole("button", { name: "選擇給下一個工作" })
      .click();
    await page.keyboard.press("Escape");
    await page.getByText("進階選項", { exact: true }).click();
    const scope = page.getByRole("checkbox", {
      name: "允許此工作讀取工作區（含臨時子任務）",
      exact: true,
    });
    await expect(scope).not.toBeChecked();
    await expect(scope).toBeDisabled();
    await page
      .getByRole("button", { name: "設定", exact: true })
      .last()
      .click();
    await page.getByText("模型連線設定", { exact: true }).click();
    await page
      .getByRole("dialog")
      .locator(".model-card")
      .filter({ hasText: model })
      .getByRole("button", { name: "使用此模型", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await scope.check();
    const prompt = "Workspace browser read " + Date.now();
    await page.locator("#compose textarea").fill(prompt);
    await page.getByRole("button", { name: "送出", exact: true }).click();
    const work = page.locator("article.work").filter({ hasText: prompt });
    await expect(work).toContainText("BROWSER_ACTUAL_OWNER_FILE");
    const list = await (await page.request.get("/api/v1/works")).json(),
      record = list.works.find((w: { text: string }) => w.text === prompt);
    expect(record.workspaceId).toBe(workspaceId);
    expect(record.workspaceRevision).toBe(1);
    expect(record.status).toBe("completed");
    const operations = await (
      await page.request.get(`/api/v1/works/${record.id}/operations`)
    ).json();
    expect(operations.operations).toHaveLength(3);
    expect(
      operations.operations.every(
        (op: { outcome: string }) => op.outcome === "succeeded",
      ),
    ).toBe(true);
    await work.getByText("工作詳情", { exact: true }).click();
    await work.getByText("此工作權限", { exact: true }).click();
    await expect(
      work.getByText("讀取綁定的工作區", { exact: true }),
    ).toBeVisible();
    await page.getByText("進階選項", { exact: true }).click();
    await expect(scope).not.toBeChecked();
    for (const [width, height] of [
      [1440, 900],
      [1280, 800],
      [390, 844],
      [320, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await scope.scrollIntoViewIfNeeded();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/workspace-read-${width}.png`,
      });
    }
  } finally {
    if (requestFailures.length)
      await test.info().attach("request-failures", {
        body: JSON.stringify(requestFailures),
        contentType: "application/json",
      });
    await provider.close();
    await rm(root, { recursive: true, force: true });
  }
});
