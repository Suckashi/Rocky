import { test, expect } from "./fixture.js";

test("T-037 original avatar in app and all sizes/themes render without remote assets", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const avatar = page.locator("img.rocky-avatar");
  await expect(avatar).toBeVisible();
  await expect(avatar).toHaveAttribute("src", "/rocky/avatar.svg");
  await expect
    .poll(() =>
      avatar.evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
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
        .filter((e) => new URL(e.name).pathname.startsWith("/rocky/"))
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
  await expect(avatar).toBeVisible();
  await expect
    .poll(() =>
      avatar.evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
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

  await page.setViewportSize({ width: 1000, height: 700 });
  await page.setContent(
    `<html lang="en"><head><style>body{margin:0;font:16px/1.6 system-ui;background:#15181c;color:#f4f1e9}section{padding:24px}section.light{background:#f6f4ef;color:#1c232a}.row{display:flex;gap:36px;align-items:end;margin:16px 0}figure{margin:0;width:128px;text-align:center}figcaption{font-size:13px}img{display:block;margin:auto;image-rendering:auto}h1{font-size:20px;margin:0}</style></head><body>${["dark", "light"].map((theme) => `<section class="${theme}"><h1>Rocky · ${theme} · original vector baseline</h1><div class="row">${[24, 32, 48, 96].map((size) => `<figure><img src="/rocky/avatar.svg" alt="Rocky ${size}" width="${size}" height="${size}"><figcaption>Avatar ${size}px</figcaption></figure>`).join("")}<figure><img src="/rocky/mark.svg" width="24" height="24" alt="Rocky mark"><figcaption>Mark 24px</figcaption></figure><figure><img src="/rocky/mark-monochrome.svg" width="24" height="24" alt="Rocky monochrome"><figcaption>Mono 24px</figcaption></figure></div></section>`).join("")}</body></html>`,
  );
  await page
    .locator("img")
    .evaluateAll((images) =>
      Promise.all(images.map((img) => (img as HTMLImageElement).decode())),
    );
  await page.screenshot({
    path: "test-results/rocky-identity-matrix.png",
    fullPage: true,
  });
});
