import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";

test("explicit routed history fixture pages stable Work cards without full-page overflow or fake server effects", async ({
  page,
}) => {
  const conversation = {
    id: randomUUID(),
    assistantId: randomUUID(),
    kind: "main",
    activeExecutionSessionId: null,
    revision: 1,
  };
  const works = Array.from({ length: 60 }, (_, i) => ({
    id: randomUUID(),
    runId: randomUUID(),
    executionSessionId: randomUUID(),
    requestId: randomUUID(),
    text: `History fixture ${i} — ${"長文字".repeat(35)}`,
    transport: "stdio",
    mode: "fixture",
    kind: "main",
    runMode: "normal",
    status: "completed",
    revision: 1,
    answer: `Fixture result ${i}\n\n\`\`\`text\n${"long-filename-".repeat(40)}.md\n\`\`\``,
    createdAt: new Date().toISOString(),
  }));
  const messages = works.flatMap((work, i) =>
    ["user", "assistant"].map((role, j) => ({
      id: j ? "work-result:" + work.id : "user-request:" + work.requestId,
      sequence: String(i * 2 + j + 1),
      conversationId: conversation.id,
      workId: work.id,
      runId: work.runId,
      executionSessionId: work.executionSessionId,
      role,
      source: j ? "work_result" : "submission",
      text: j ? work.answer : work.text,
      status: work.status,
      createdAt: work.createdAt,
    })),
  );
  await page.route("**/api/v1/snapshot", (route) =>
    route.fulfill({
      json: { works, events: [], cursor: "0", schemaVersion: 1 },
    }),
  );
  // Isolate this explicitly routed visual fixture from unrelated persisted daemon replay.
  await page.route("**/api/v1/events?**", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: ": isolated visual fixture\n\n",
    }),
  );
  await page.route("**/api/v1/conversation/history**", (route) => {
    const before = new URL(route.request().url()).searchParams.get("before");
    const available = messages.filter(
      (m) => !before || BigInt(m.sequence) < BigInt(before),
    );
    const result = available.slice(-50);
    return route.fulfill({
      json: {
        conversation,
        messages: result,
        nextCursor: available.length > 50 ? result[0]!.sequence : null,
      },
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator("article.work")).toHaveCount(25);
  mkdirSync(".rocky-reports/history-ui", { recursive: true });
  await page.locator(".chat-transcript").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({
    path: ".rocky-reports/history-ui/history-page-1440.png",
  });
  const transcript = page.locator(".chat-transcript");
  await transcript.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.getByRole("button", { name: "載入較早的訊息" }).click();
  await expect(page.locator("article.work")).toHaveCount(50);
  expect(
    await transcript.evaluate(
      (el) => el.scrollTop + el.clientHeight < el.scrollHeight - 100,
    ),
  ).toBe(true);
  await transcript.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.getByRole("button", { name: "載入較早的訊息" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("article.work")).toHaveCount(60);
  await expect(transcript).toBeFocused();
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
    [320, 844],
  ]) {
    await page.setViewportSize({ width, height });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await expect(page.locator(".chat-composer")).toBeInViewport();
  }
  await page.screenshot({ path: ".rocky-reports/history-ui/history-320.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: ".rocky-reports/history-ui/history-1440.png" });
});
