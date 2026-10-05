import { test, expect } from "./fixture.js";

test("empty owned installation offers setup without accounts, imported history or synthetic success", async ({
  page,
}) => {
  test.skip(
    process.env.ROCKY_E2E_EMPTY !== "1",
    "Requires an explicitly empty fixture root, without reconciliation seeds",
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "先連接一個模型", exact: true }),
  ).toBeVisible();
  expect(
    (await (await page.request.get("/api/v1/works")).json()).works,
  ).toEqual([]);
  expect(
    (await (await page.request.get("/api/v1/model-connections")).json())
      .connections,
  ).toEqual([]);
  // First launch shows only model setup; nothing can be sent yet.
  await expect(
    page.getByRole("button", { name: "送出", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "設定", exact: true }).last().click();
  await expect(page.getByText("模型連線設定", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("MCP 伺服器設定", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText(/明確|explicit|網路/);
  await expect(
    page.getByText(/Upgrade Apsis|Import Apsis|Intelligence account/),
  ).not.toBeVisible();
  await page.screenshot({ path: "test-results/empty-install-setup.png" });
});
