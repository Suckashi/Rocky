import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("owner registers actual workspace, browses text, rejects traversal and restores drawer focus at four widths", async ({
  page,
}) => {
  const root = await mkdtemp(join(tmpdir(), "rocky-browser-workspace-")),
    name = "Workspace " + Date.now(),
    filename = "long-source-" + "x".repeat(110) + ".md";
  await mkdir(join(root, "docs"));
  await writeFile(
    join(root, "docs", filename),
    "# Actual owner file\n\n" +
      "long-word-".repeat(150) +
      "\n```ts\nconst evidence = true;\n```\n",
  );
  await writeFile(join(root, ".env"), "must remain hidden");
  await writeFile(join(root, "binary.bin"), Buffer.from([0, 255]));
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "工作區", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("名稱", { exact: true }).fill(name);
    await dialog.getByLabel("資料夾絕對路徑").fill(root);
    await dialog
      .getByRole("button", { name: "註冊工作區", exact: true })
      .click();
    const card = dialog
      .locator(".model-card")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "瀏覽檔案" }).click();
    await expect(
      dialog.getByRole("button", { name: "binary.bin", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: ".env", exact: true }),
    ).toHaveCount(0);
    await dialog
      .getByRole("button", { name: "binary.bin", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText("UTF-8");
    await dialog.getByRole("button", { name: "docs", exact: true }).click();
    await dialog.getByRole("button", { name: filename, exact: true }).click();
    await expect(
      dialog.getByText("# Actual owner file", { exact: false }),
    ).toBeVisible();
    await expect(dialog.getByText(/SHA-256:/)).toBeVisible();
    for (const [width, height] of [
      [1440, 900],
      [1280, 800],
      [390, 844],
      [320, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await dialog.locator("pre").scrollIntoViewIfNeeded();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
        true,
      );
      await page.screenshot({ path: `test-results/workspace-${width}.png` });
      await dialog.getByLabel("文字預覽", { exact: true }).focus();
      await expect(
        dialog.getByLabel("文字預覽", { exact: true }),
      ).toBeFocused();
      await dialog
        .getByRole("heading", { name: "本機工作區", exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `test-results/workspace-${width}-form.png`,
      });
    }
    const list = await (await page.request.get("/api/v1/workspaces")).json(),
      workspace = list.workspaces.find(
        (w: { name: string }) => w.name === name,
      );
    expect(
      (
        await page.request.get(
          `/api/v1/workspaces/${workspace.id}/file?revision=1&path=${encodeURIComponent("../outside")}`,
        )
      ).status(),
    ).toBe(403);
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "開啟導覽", exact: true }),
    ).toBeFocused();
    await page.getByRole("button", { name: "開啟導覽", exact: true }).click();
    await page.getByRole("button", { name: "工作區", exact: true }).click();
    await expect(
      page.getByRole("dialog").getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.keyboard.press("Tab");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Toggle theme" }).click();
    await page.getByRole("button", { name: "開啟導覽", exact: true }).click();
    await page.getByRole("button", { name: "工作區", exact: true }).click();
    await page.screenshot({ path: "test-results/workspace-320-dark.png" });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "English", exact: true })
      .click();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("heading", { name: "Local workspaces", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog").getByLabel("Absolute folder path"),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: "test-results/workspace-320-dark-en.png" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
