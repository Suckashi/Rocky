import { test, expect } from "@playwright/test";

test("initial snapshot failure reconnects to authoritative snapshot without inventing Work", async ({
  page,
}) => {
  const snapshot = "**/api/v1/snapshot";
  await page.route(snapshot, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Snapshot fixture unavailable" }),
    }),
  );
  await page.goto("/");
  await expect(
    page.getByText("Snapshot fixture unavailable", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "開始驗證" })).toBeDisabled();
  const submissions: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/copilotkit/agent/rocky/run"))
      submissions.push(request.url());
  });
  await page.getByText("模型與工具", { exact: true }).click();
  await page.getByLabel("啟用合成測試").check();
  await page.getByText("模型與工具", { exact: true }).click();
  await page.locator("textarea").fill("Must not submit while disconnected");
  await page.locator("textarea").press("Enter");
  expect(submissions).toEqual([]);
  await page.unroute(snapshot);
  await page.getByRole("button", { name: "重新連線", exact: true }).click();
  await expect(page.getByText("本機已連線", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Snapshot fixture unavailable", { exact: false }),
  ).toHaveCount(0);
  const state = await (await page.request.get("/api/v1/snapshot")).json();
  const history = await (
    await page.request.get("/api/v1/conversation/history")
  ).json();
  const visibleIds = new Set(
    history.messages.map((message: { workId: string }) => message.workId),
  );
  const visible = state.works.filter(
    (work: { id: string; runMode: string; status: string }) =>
      work.runMode === "normal" &&
      (visibleIds.has(work.id) ||
        ["queued", "running", "waiting_approval"].includes(work.status)),
  );
  await expect(page.locator("article.work")).toHaveCount(visible.length);
  for (const work of visible) {
    await expect(
      page.locator("article.work").filter({ hasText: work.text }),
    ).toHaveCount(1);
  }
});
