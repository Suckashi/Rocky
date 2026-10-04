import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
