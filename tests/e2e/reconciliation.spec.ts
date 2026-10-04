import { test, expect } from "./fixture.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
test("T-008 receipt reconciliation UI confirms known effects and preserves unknown without replay", async ({
  page,
}) => {
  const seeds = JSON.parse(
    readFileSync(
      join(
        process.env.ROCKY_E2E_ROOT ?? ".rocky-e2e",
        "reconciliation-seed.json",
      ),
      "utf8",
    ),
  ) as { workId: string; text: string; recorded: boolean; runId: string }[];
  await page.goto("/");
  for (const seed of seeds) {
    const root = join(
      process.env.ROCKY_E2E_ROOT ?? ".rocky-e2e",
      "synthetic-receipts",
      seed.runId,
    );
    const before = seed.recorded
      ? readdirSync(root).map((name) => [
          name,
          readFileSync(join(root, name), "utf8"),
        ])
      : [];
    const work = page.locator("article.work").filter({ hasText: seed.text });
    await work.getByText("工作詳情", { exact: true }).click();
    await work.getByText("操作與對帳", { exact: true }).click();
    const operations = work.locator(".work-operations");
    await expect(
      operations.getByText("結果未確認", { exact: true }),
    ).toBeVisible();
    await operations
      .getByRole("button", { name: "查詢結果", exact: true })
      .click();
    if (seed.recorded) {
      await expect(
        operations.getByText("已成功", { exact: true }),
      ).toBeVisible();
      await expect(
        operations.getByRole("button", { name: "查詢結果", exact: true }),
      ).toHaveCount(0);
    } else {
      await expect(operations.getByRole("status")).toContainText("仍無法確認");
      await expect(
        operations.getByText("結果未確認", { exact: true }),
      ).toBeVisible();
    }
    expect(
      readdirSync(root).map((name) => [
        name,
        readFileSync(join(root, name), "utf8"),
      ]),
    ).toEqual(before);
    await page.reload();
    await work.getByText("工作詳情", { exact: true }).click();
    await work.getByText("操作與對帳", { exact: true }).click();
    await expect(
      operations.getByText(seed.recorded ? "已成功" : "結果未確認", {
        exact: true,
      }),
    ).toBeVisible();
    await page.setViewportSize({ width: 320, height: 800 });
    await operations.scrollIntoViewIfNeeded();
    await operations.screenshot({
      path: `test-results/reconciliation-${seed.recorded ? "confirmed" : "unknown"}.png`,
    });
  }
});
