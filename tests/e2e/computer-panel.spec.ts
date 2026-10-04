import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
test("Computer opens a reference-sized pane with actual registered files and honest unavailable adapters", async ({
  page,
}) => {
  const root = await mkdtemp(join(tmpdir(), "rocky-computer-files-")),
    name = "Computer files " + Date.now();
  await writeFile(join(root, "notes.md"), "Actual local Computer file fixture");
  try {
    await page.goto("/");
    const opener = page.getByRole("button", { name: "Computer", exact: true });
    await opener.click();
    const pane = page.locator(".result-pane");
    await expect(pane).toBeVisible();
    await expect(pane).toContainText("Browser 尚不可用");
    await pane.getByRole("tab", { name: "Browser", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      pane.getByRole("tab", { name: "Files", exact: true }),
    ).toBeFocused();
    await expect(
      pane.getByRole("tab", { name: "Files", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await pane.getByLabel("名稱", { exact: true }).fill(name);
    await pane.getByLabel("資料夾絕對路徑").fill(root);
    await pane.getByRole("button", { name: "註冊工作區", exact: true }).click();
    const card = pane
      .locator(".model-card")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
    await card.getByRole("button", { name: "瀏覽檔案" }).click();
    await pane.getByRole("button", { name: "notes.md", exact: true }).click();
    await expect(
      pane.getByText("Actual local Computer file fixture", { exact: true }),
    ).toBeVisible();
    for (const [width, height] of [
      [1440, 900],
      [1280, 800],
      [390, 844],
      [320, 844],
    ]) {
      await page.setViewportSize({ width: width!, height: height! });
      await pane.locator("pre").scrollIntoViewIfNeeded();
      expect(
        await pane.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const box = await pane.boundingBox();
      expect(box!.width).toBe(width! > 1100 ? width! * 0.4 : width);
      await page.screenshot({
        path: "test-results/computer-files-" + width + ".png",
      });
    }
    await pane.getByRole("tab", { name: "Terminal", exact: true }).click();
    await expect(pane).toContainText("Terminal 尚不可用");
    await page.screenshot({
      path: "test-results/computer-unavailable-320.png",
    });
    await pane.getByRole("tab", { name: "Activity", exact: true }).click();
    await expect(pane.getByLabel("檢視工作")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(pane).toHaveCount(0);
    await expect(page.getByRole("button", { name: "開啟導覽" })).toBeFocused();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("explicit Computer activity fixture isolates Work identity and traps compact keyboard focus", async ({
  page,
}) => {
  const works = ["First work", "Empty work"].map((text) => ({
    id: randomUUID(),
    runId: randomUUID(),
    executionSessionId: randomUUID(),
    requestId: randomUUID(),
    text,
    answer: "",
    transport: "http",
    mode: "fixture",
    kind: "background",
    runMode: "normal",
    status: "completed",
    revision: 1,
    createdAt: "2026-10-04T00:00:00Z",
  }));
  const w = works[0]!;
  const event = {
    schemaVersion: 1,
    id: randomUUID(),
    sequence: "1",
    timestamp: w.createdAt,
    workId: w.id,
    runId: w.runId,
    executionSessionId: w.executionSessionId,
    payload: {
      kind: "domain",
      name: "rocky.tool.completed",
      data: {
        name: "read_file",
        callId: "read-one",
        args: { file_path: "project/visible.md" },
      },
    },
  };
  const events = [
    event,
    ...["workId", "runId", "executionSessionId"].map((key, i) => ({
      ...event,
      id: randomUUID(),
      sequence: String(i + 2),
      [key]: randomUUID(),
      payload: {
        ...event.payload,
        data: {
          ...event.payload.data,
          callId: key,
          args: { file_path: "must-not-leak-" + key },
        },
      },
    })),
  ];
  await page.route("**/api/v1/snapshot", (r) =>
    r.fulfill({ json: { works, events, cursor: "4", schemaVersion: 1 } }),
  );
  await page.route("**/api/v1/events?**", (r) =>
    r.fulfill({
      contentType: "text/event-stream",
      body: ": explicit fixture\n\n",
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Computer", exact: true }).click();
  const pane = page.getByRole("region", { name: "Computer", exact: true });
  await expect(pane).toBeVisible();
  await expect(
    page
      .locator(".icon-rail")
      .getByRole("button", { name: "文件與成果", exact: true }),
  ).toHaveCount(1);
  await pane.getByRole("tab", { name: "Browser", exact: true }).focus();
  await page.keyboard.press("End");
  await expect(
    pane.getByRole("tab", { name: "Activity", exact: true }),
  ).toBeFocused();
  await pane.getByLabel("檢視工作").selectOption(works[1]!.id);
  await expect(pane).toContainText("此工作尚無可顯示的工具活動。");
  await pane.getByLabel("檢視工作").selectOption(w.id);
  await expect(pane.locator(".inline-tool")).toHaveCount(1);
  await expect(pane).toContainText("project/visible.md");
  await expect(pane).not.toContainText("must-not-leak");
  await page.setViewportSize({ width: 320, height: 844 });
  const overlay = page.getByRole("dialog", { name: "Computer", exact: true });
  await expect(overlay).toHaveAttribute("aria-modal", "true");
  const close = overlay.getByRole("button", { name: "關閉 Computer 面板" });
  const summary = overlay.locator(".inline-tool > summary");
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(summary).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await summary.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(overlay.locator(".inline-tool-evidence summary")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/computer-activity-320.png" });
  await page.keyboard.press("Escape");
  await expect(overlay).toHaveCount(0);
  await expect(page.getByRole("button", { name: "開啟導覽" })).toBeFocused();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page.getByRole("button", { name: "Computer", exact: true }).click();
  await overlay.getByRole("tab", { name: "Activity", exact: true }).click();
  await overlay.getByLabel("Inspect Work").selectOption(w.id);
  await expect(overlay).toContainText("Returned");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/computer-activity-dark-en-320.png",
  });
});
