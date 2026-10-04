import { test, expect } from "./fixture.js";
test("OpenDots geometry, responsive navigation and keyboard focus", async ({
  page,
}) => {
  await page.goto("/");
  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
    [390, 844],
    [320, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator(".topbar")).toHaveCSS("height", "64px");
    const boxes = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      rail: document.querySelector(".icon-rail")!.getBoundingClientRect().width,
      sidebar: document.querySelector(".sidebar")!.getBoundingClientRect()
        .width,
      composer: document
        .querySelector(".chat-composer")!
        .getBoundingClientRect().bottom,
    }));
    expect(boxes.overflow).toBe(false);
    expect(boxes.composer).toBeLessThanOrEqual(height);
    if (width > 700) {
      expect(boxes.rail).toBe(48);
      expect(boxes.sidebar).toBe(220);
    } else {
      expect(boxes.sidebar).toBe(252);
      await page.getByRole("button", { name: "開啟導覽" }).click();
      await expect(page.getByRole("complementary")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "開啟導覽" }),
      ).toBeFocused();
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "收合導覽" }).click();
  await expect(page.locator(".workspace")).toHaveCSS("margin-left", "48px");
  await page.getByRole("button", { name: "收合導覽" }).click();
  await expect(page.locator(".workspace")).toHaveCSS("margin-left", "268px");
  await page.getByRole("button", { name: "設定", exact: true }).last().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "開啟導覽" }).click();
  await page.getByRole("button", { name: "設定", exact: true }).last().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "開啟導覽" })).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
