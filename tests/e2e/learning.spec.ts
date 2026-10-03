import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
test("Learning UI requires scoped consent, preserves stale drafts and turns policy off", async ({
  page,
}) => {
  await page.goto("/");
  const { token } = await (await page.request.get("/api/v1/session")).json();
  const headers = { "x-rocky-session": token };
  const initial = await (
    await page.request.get("/api/v1/learning/policy")
  ).json();
  expect(
    (
      await page.request.post("/api/v1/learning/policy", {
        headers,
        data: {
          requestId: randomUUID(),
          expectedRevision: initial.revision,
          mode: "off",
          scopes: [],
        },
      })
    ).ok(),
  ).toBe(true);
  await page.getByRole("button", { name: "Learning", exact: true }).click();
  const ui = page.locator(".learning-settings");
  await expect(ui.getByRole("status")).toContainText("off");
  await expect(ui).toContainText("尚未接通");
  await ui.getByLabel("Learning 模式").selectOption("propose");
  const save = ui.getByRole("button", { name: "保存學習政策" });
  await expect(save).toBeDisabled();
  await ui.getByLabel("個人範圍（不包含專案）").check();
  await expect(save).toBeDisabled();
  await ui.getByLabel("我同意在以上範圍提出學習候選").check();
  await save.click();
  await expect(ui.getByRole("status")).toContainText("propose");
  await expect(ui.getByLabel("我同意在以上範圍提出學習候選")).not.toBeChecked();
  const current = await (
    await page.request.get("/api/v1/learning/policy")
  ).json();
  expect(current.scopes).toEqual([{ kind: "user" }]);
  expect(
    (
      await page.request.post("/api/v1/learning/policy", {
        headers,
        data: {
          requestId: randomUUID(),
          expectedRevision: current.revision,
          mode: "off",
          scopes: [],
        },
      })
    ).ok(),
  ).toBe(true);
  await ui.getByLabel("我同意在以上範圍提出學習候選").check();
  await save.click();
  await expect(ui.getByRole("alert")).toContainText("revision changed");
  await expect(ui.getByLabel("Learning 模式")).toHaveValue("propose");
  await ui.getByRole("button", { name: "重新載入政策（放棄草稿）" }).click();
  await expect(ui.getByLabel("Learning 模式")).toHaveValue("off");
  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
    [390, 844],
    [320, 844],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/learning-policy-${width}.png`,
    });
  }
  await ui.getByLabel("Learning 模式").selectOption("propose");
  await ui.getByLabel("個人範圍（不包含專案）").check();
  await ui.getByLabel("我同意在以上範圍提出學習候選").check();
  await save.click();
  await expect(ui.getByRole("status")).toContainText("propose");
  await ui.getByLabel("Learning 模式").selectOption("off");
  await save.click();
  await expect(ui.getByRole("status")).toContainText("off");
  expect(
    (await (await page.request.get("/api/v1/learning/policy")).json()).scopes,
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});
