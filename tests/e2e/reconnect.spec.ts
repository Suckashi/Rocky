import { test, expect } from "./fixture.js";
import type { APIRequestContext } from "@playwright/test";
import type { Work } from "../../packages/contracts/src/index.js";

async function visibleWork(request: APIRequestContext): Promise<Work[]> {
  const { works } = await (await request.get("/api/v1/works")).json();
  const { messages } = await (
    await request.get("/api/v1/conversation/history")
  ).json();
  const ids = new Set(
    messages.map((message: { workId: string }) => message.workId),
  );
  return works.filter(
    (work: Work) =>
      work.runMode === "normal" &&
      (ids.has(work.id) ||
        ["queued", "running", "waiting_approval"].includes(work.status)),
  );
}

test("volatile daemon degradation preserves prior Work state and disables the connected claim", async ({
  page,
}) => {
  const prior = await visibleWork(page.request);
  await page.route("**/api/v1/events?*", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: 'event: daemon_degraded\ndata: {"message":"Fixture storage failure","persisted":false}\n\n',
    }),
  );
  await page.goto("/");
  await expect(
    page.getByText(/Execution storage or cleanup failed/),
  ).toBeVisible();
  await expect(page.getByText("本機已連線", { exact: true })).not.toBeVisible();
  await expect(page.locator("article.work")).toHaveCount(prior.length);
  for (const work of prior) {
    // Completed history from earlier scenarios remains completed; degradation
    // must preserve each authoritative status, not require an empty history.
    await expect(
      page.locator(`#work-${work.id} > .work-heading > .status`),
    ).toHaveClass(`status ${work.status}`);
  }
});

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
  await page
    .locator("#compose textarea")
    .fill("Must not submit while disconnected");
  await page.locator("#compose textarea").press("Enter");
  expect(submissions).toEqual([]);
  await page.unroute(snapshot);
  await page.getByRole("button", { name: "重新連線", exact: true }).click();
  await expect(page.getByText("本機已連線", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Snapshot fixture unavailable", { exact: false }),
  ).toHaveCount(0);
  const visible = await visibleWork(page.request);
  await expect(page.locator("article.work")).toHaveCount(visible.length);
  for (const work of visible) {
    // Different Works can legitimately have identical text.
    await expect(page.locator(`#work-${work.id}`)).toHaveCount(1);
  }
});
