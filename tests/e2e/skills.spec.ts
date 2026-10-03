import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("owner reviews all package files and selects an older immutable revision", async ({
  page,
}) => {
  await page.goto("/");
  const { token } = await (await page.request.get("/api/v1/session")).json(),
    id = randomUUID(),
    name = "history-" + id;
  for (const expectedRevision of [0, 1]) {
    const response = await page.request.post("/api/v1/skills/import", {
      headers: { "x-rocky-session": token },
      data: {
        requestId: randomUUID(),
        id,
        expectedRevision,
        scope: { kind: "user" },
        source: {
          type: "manual",
          reference: "fixture/history",
          license: "MIT",
        },
        package: {
          directoryName: name,
          files: [
            {
              path: "SKILL.md",
              contentBase64: Buffer.from(
                `---\nname: ${name}\ndescription: Historical package\n---\nBODY_REVISION_${expectedRevision + 1}`,
              ).toString("base64"),
            },
            {
              path: "scripts/example.js",
              contentBase64: Buffer.from(
                "globalThis.SKILL_EXECUTED = true; // review only",
              ).toString("base64"),
            },
            {
              path: "assets/binary.dat",
              contentBase64: Buffer.from([0, 255, 128]).toString("base64"),
            },
          ],
        },
      },
    });
    expect(response.ok()).toBe(true);
  }
  await page.getByRole("button", { name: "技能", exact: true }).click();
  const ui = page.locator(".skill-settings");
  await ui.getByRole("button", { name: "載入／重新整理技能" }).click();
  const card = ui.locator("article").filter({ hasText: name });
  await card.getByRole("button", { name: "審查此版本" }).click();
  await expect(card.locator("pre")).toContainText("BODY_REVISION_2");
  await card.getByLabel("檢視套件檔案").selectOption("scripts/example.js");
  await expect(card.locator("pre")).toContainText("SKILL_EXECUTED");
  expect(
    await page.evaluate(() => Reflect.get(globalThis, "SKILL_EXECUTED")),
  ).toBeUndefined();
  await card.getByLabel("檢視套件檔案").selectOption("assets/binary.dat");
  await expect(card).toContainText("二進位檔案");
  await expect(card.locator("pre")).toHaveCount(0);
  await card.getByRole("button", { name: "上一版本" }).click();
  await expect(card.locator("pre")).toContainText("BODY_REVISION_1");
  await card.getByLabel("我已檢視此版本內容及來源").check();
  await card.getByRole("button", { name: "信任並啟用此版本" }).click();
  const selection = await (
    await page.request.get(`/api/v1/skills/${id}/selection`)
  ).json();
  expect(selection.selection).toMatchObject({
    skillRevision: 1,
    state: "published",
  });
  await card.getByRole("button", { name: "下一版本" }).click();
  await expect(card.locator("pre")).toContainText("BODY_REVISION_2");
  await expect(card.getByLabel("我已檢視此版本內容及來源")).not.toBeChecked();
  await expect(card).toContainText("目前選擇 r1");
  await card.getByLabel("檢視套件檔案").selectOption("scripts/example.js");
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
      path: `test-results/skill-files-${width}.png`,
      fullPage: true,
    });
  }
});

test("owner imports a real local folder as untrusted snapshot", async ({
  page,
}) => {
  const root = await mkdtemp(join(tmpdir(), "rocky-skill-browser-")),
    name = "folder-" + randomUUID(),
    folder = join(root, name);
  try {
    await mkdir(join(folder, "references"), { recursive: true });
    await writeFile(
      join(folder, "SKILL.md"),
      `---\nname: ${name}\ndescription: Folder upload fixture\n---\n# Local instructions`,
    );
    await writeFile(
      join(folder, "references", "guide.md"),
      "SOURCE_BYTES_MUST_PERSIST",
    );
    await page.goto("/");
    await page.getByRole("button", { name: "技能", exact: true }).click();
    const ui = page.locator(".skill-settings"),
      form = ui.locator(".skill-import");
    await form.locator("summary").click();
    await form.getByLabel("技能資料夾", { exact: true }).setInputFiles(folder);
    await expect(form).toContainText("已選檔案：2");
    await form
      .getByLabel("授權聲明", { exact: true })
      .fill("MIT fixture content");
    for (const [width, height] of [
      [1440, 900],
      [1280, 800],
      [390, 844],
      [320, 844],
    ]) {
      await page.setViewportSize({ width: width!, height: height! });
      await form.scrollIntoViewIfNeeded();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/skill-import-${width}.png`,
        fullPage: true,
      });
    }
    await form.getByRole("button", { name: "保存未信任套件" }).click();
    await expect(form.getByRole("status")).toContainText("已匯入");
    const card = ui.locator("article").filter({ hasText: name });
    await card.getByRole("button", { name: "審查此版本" }).click();
    await expect(card.getByRole("status")).toContainText("未信任");
    await card.locator("summary").click();
    await expect(card).toContainText("references/guide.md");
    const catalog = await (await page.request.get("/api/v1/skills")).json();
    const imported = catalog.skills.find(
      (s: { metadata: { name: string } }) => s.metadata.name === name,
    );
    const selection = await (
      await page.request.get(`/api/v1/skills/${imported.id}/selection`)
    ).json();
    expect(selection.selection).toBeNull();
    const { token } = await (await page.request.get("/api/v1/session")).json();
    expect(
      (
        await page.request.post(`/api/v1/skills/${imported.id}/selection`, {
          headers: { "x-rocky-session": token },
          data: {
            requestId: randomUUID(),
            expectedRevision: 0,
            skillRevision: 1,
            contentHash: imported.contentHash,
            action: "publish",
          },
        })
      ).ok(),
    ).toBe(true);
    await writeFile(
      join(folder, "references", "guide.md"),
      "UPDATED_REFERENCE_BYTES",
    );
    await card.getByRole("button", { name: "匯入新版", exact: true }).click();
    await expect(form.getByLabel("匯入範圍")).toBeDisabled();
    await page.setViewportSize({ width: 320, height: 844 });
    await form.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/skill-update-320.png",
      fullPage: true,
    });
    await form.getByLabel("技能資料夾", { exact: true }).setInputFiles(folder);
    await form.getByRole("button", { name: "保存未信任套件" }).click();
    await expect(card).toContainText("r2");
    const stillSelected = await (
      await page.request.get(`/api/v1/skills/${imported.id}/selection`)
    ).json();
    expect(stillSelected.selection).toMatchObject({
      skillRevision: 1,
      state: "published",
    });
    const newer = await (
      await page.request.get(`/api/v1/skills/${imported.id}/revisions/2`)
    ).json();
    expect(
      Buffer.from(
        newer.package.files.find(
          (f: { path: string }) => f.path === "references/guide.md",
        ).contentBase64,
        "base64",
      ).toString(),
    ).toBe("UPDATED_REFERENCE_BYTES");
    const detail = await (
      await page.request.get(`/api/v1/skills/${imported.id}/revisions/1`)
    ).json();
    expect(
      Buffer.from(
        detail.package.files.find(
          (f: { path: string }) => f.path === "references/guide.md",
        ).contentBase64,
        "base64",
      ).toString(),
    ).toBe("SOURCE_BYTES_MUST_PERSIST");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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
