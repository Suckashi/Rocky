import { test, expect } from "./fixture.js";

test("T-037 Roko avatar in app and both themes render from the shared local atlas", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.getByText("本機已連線", { exact: true })).toBeVisible();
  const avatar = page.locator("canvas.rocky-avatar");
  await expect(avatar).toBeVisible();
  await expect(avatar).toHaveAttribute("aria-label", "Roko");
  await expect
    .poll(() =>
      avatar.evaluate(
        (canvas: HTMLCanvasElement) => canvas.dataset.loaded === "true",
      ),
    )
    .toBe(true);
  const profile = await (await page.request.get("/api/v1/assistant")).json();
  expect(profile.displayName).toBe("Rocky");
  expect(profile.personaVersion).toBe("1.0.0");
  const timing = () =>
    page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .filter((e) => new URL(e.name).pathname.startsWith("/roko/"))
        .map((e) => {
          const r = e as PerformanceResourceTiming;
          return {
            asset: new URL(r.name).pathname,
            duration: r.duration,
            transferSize: r.transferSize,
            decodedBodySize: r.decodedBodySize,
          };
        }),
    );
  const cold = await timing();
  await page.reload();
  await expect(page.getByText("本機已連線", { exact: true })).toBeVisible();
  await expect(avatar).toBeVisible();
  await expect
    .poll(() =>
      avatar.evaluate(
        (canvas: HTMLCanvasElement) => canvas.dataset.loaded === "true",
      ),
    )
    .toBe(true);
  const warm = await timing();
  await testInfo.attach("avatar-cold-warm", {
    body: JSON.stringify({
      cold,
      warm,
      limitation:
        "Local fixture browser measurements; not a low-end-device benchmark.",
    }),
    contentType: "application/json",
  });
  await page.getByRole("button", { name: "Toggle theme" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Rocky|Let’s work through it./ }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/identity-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    document.body.style.zoom = "2";
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/identity-zoom.png",
    fullPage: true,
  });
});
