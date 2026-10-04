import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
test("explicit activity fixture matches compact inline tool layout", async ({
  page,
}) => {
  const w = {
    id: randomUUID(),
    runId: randomUUID(),
    executionSessionId: randomUUID(),
    requestId: randomUUID(),
    text: "Inspect the local project",
    transport: "http",
    mode: "fixture",
    kind: "main",
    runMode: "normal",
    status: "completed",
    revision: 1,
    answer:
      "The readable result remains separate from tool execution evidence.",
    createdAt: "2026-10-04T00:00:00Z",
  };
  const events = [
    ["started", "read_file", "one"],
    ["completed", "read_file", "one"],
    ["started", "write_file", "two"],
    ["failed", "write_file", "two"],
    ["started", "task", "three"],
  ].map(([state, name, callId], i) => ({
    schemaVersion: 1,
    id: randomUUID(),
    sequence: String(i + 1),
    timestamp: w.createdAt,
    workId: w.id,
    runId: w.runId,
    executionSessionId: w.executionSessionId,
    payload: {
      kind: "domain",
      name: `rocky.${name === "task" ? "subagent" : "tool"}.${state}`,
      data: {
        name,
        callId,
        args: { file_path: "project/notes.md" },
        child: false,
      },
    },
  }));
  await page.route("**/api/v1/snapshot", (r) =>
    r.fulfill({ json: { works: [w], events, cursor: "5", schemaVersion: 1 } }),
  );
  await page.route("**/api/v1/events?**", (r) =>
    r.fulfill({
      contentType: "text/event-stream",
      body: ": explicit fixture\n\n",
    }),
  );
  await page.route("**/api/v1/conversation/history**", (r) =>
    r.fulfill({
      json: {
        conversation: {
          id: randomUUID(),
          assistantId: randomUUID(),
          kind: "main",
          activeExecutionSessionId: null,
          revision: 1,
        },
        messages: [
          {
            id: "user-request:" + w.requestId,
            sequence: "1",
            conversationId: randomUUID(),
            workId: w.id,
            runId: w.runId,
            executionSessionId: w.executionSessionId,
            role: "user",
            source: "submission",
            text: w.text,
            status: w.status,
            createdAt: w.createdAt,
          },
          {
            id: "work-result:" + w.id,
            sequence: "2",
            conversationId: randomUUID(),
            workId: w.id,
            runId: w.runId,
            executionSessionId: w.executionSessionId,
            role: "assistant",
            source: "work_result",
            text: w.answer,
            status: w.status,
            createdAt: w.createdAt,
          },
        ],
        nextCursor: null,
      },
    }),
  );
  await page.goto("/");
  await expect(page.locator("article.work")).toHaveCount(1);
  if (process.env.ROCKY_CAPTURE_PHASE !== "before") {
    await expect(page.locator(".inline-tool")).toHaveCount(3);
    await expect(page.locator(".inline-tool header").first()).toHaveCSS(
      "padding",
      "12px 14px",
    );
    await expect(page.locator(".inline-tool header").first()).toHaveCSS(
      "font-size",
      "12px",
    );
    await expect(page.locator(".inline-tool header").first()).toHaveCSS(
      "gap",
      "9px",
    );
    await expect(page.locator(".inline-tool").nth(0)).toContainText("已返回");
    await expect(page.locator(".inline-tool").nth(1)).toContainText("失敗");
    await expect(page.locator(".inline-tool").nth(2)).toContainText(
      "結果未確認",
    );
    await expect(page.locator(".inline-tool").first()).toHaveCSS(
      "border-radius",
      "14px",
    );
  }
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
      path: `.rocky-reports/tool-alignment/${process.env.ROCKY_CAPTURE_PHASE ?? "after"}-${width}.png`,
    });
  }
});
