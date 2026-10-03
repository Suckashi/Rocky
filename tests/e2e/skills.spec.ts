import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("owner reviews pinned skill and enables, deactivates, quarantines", async ({
  page,
}) => {
  await page.goto("/");
  const { token } = await (await page.request.get("/api/v1/session")).json();
  const id = randomUUID(),
    name = "review-" + id;
  const response = await page.request.post("/api/v1/skills/import", {
    headers: { "x-rocky-session": token },
    data: {
      requestId: randomUUID(),
      id,
      expectedRevision: 0,
      scope: { kind: "user" },
      source: {
        type: "manual",
        reference: "browser-fixture/example",
        license: "MIT",
      },
      package: {
        directoryName: name,
        files: [
          {
            path: "SKILL.md",
            contentBase64: Buffer.from(
              `---\nname: ${name}\ndescription: Browser review fixture\n---\n# Reviewed skill\nOriginal instructions and a very long line ${"long-text-".repeat(40)}`,
            ).toString("base64"),
          },
        ],
      },
    },
  });
  expect(response.ok()).toBe(true);
  await page.getByRole("button", { name: "技能", exact: true }).first().click();
  const ui = page.locator(".skill-settings");
  await ui.getByRole("button", { name: "載入／重新整理技能" }).click();
  const card = ui.locator("article").filter({ hasText: name });
  await card.getByRole("button", { name: "審查此版本" }).click();
  const enable = card.getByRole("button", { name: "信任並啟用此版本" });
  await expect(enable).toBeDisabled();
  await expect(card.locator("pre")).toContainText("Original instructions");
  await card.getByLabel("我已檢視此版本內容及來源").check();
  await enable.click();
  await expect(card.getByRole("status")).toContainText("已啟用");
  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
    [390, 844],
    [320, 844],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    await card.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/skills-review-${width}.png`,
      fullPage: true,
    });
  }
  await card.getByRole("button", { name: "停用", exact: true }).click();
  await expect(card.getByRole("status")).toContainText("已停用");
  await card.getByLabel("我已檢視此版本內容及來源").check();
  await card.getByRole("button", { name: "隔離此版本" }).click();
  await expect(card.getByRole("status")).toContainText("已隔離");
  await expect(enable).toBeDisabled();
  const selection = await (
    await page.request.get(`/api/v1/skills/${id}/selection`)
  ).json();
  expect(selection.selection).toMatchObject({
    state: "quarantined",
    revision: 3,
    skillRevision: 1,
  });
});
