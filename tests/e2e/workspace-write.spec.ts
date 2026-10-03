import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { AIMessage } from "@langchain/core/messages";
import { startAgentProvider } from "../../fixtures/models/agent-provider.js";

test("real workspace approval card: responsive preview, reject, approve and stale file", async ({
  page,
}) => {
  const root = await mkdtemp(join(tmpdir(), "rocky-browser-write-"));
  const content =
    "# Owner approved document\n\n" +
    "long_code_without_spaces_".repeat(30) +
    "\n🐾";
  const original = "\uFEFF# Original document\r\n\r\nOLD_OWNER_TEXT\r\n";
  await writeFile(join(root, "replace.md"), original);
  const originalHash = createHash("sha256").update(original).digest("hex");
  const provider = await startAgentProvider({
    reply: async (messages) => {
      const turn = messages.findLastIndex(
        (m) =>
          m.type === "human" && String(m.content).startsWith("Browser write "),
      );
      const prompt = String(messages[turn]?.content);
      const last = messages
        .slice(turn + 1)
        .filter((m) => m.type === "tool")
        .at(-1);
      if (last) return new AIMessage("Write receipt: " + String(last.content));
      return new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "browser-write",
            name: "workspace_write",
            args: {
              path: prompt.includes("reject")
                ? "reject.md"
                : prompt.includes("stale")
                  ? "stale.md"
                  : prompt.includes("replace")
                    ? "replace.md"
                    : "approved.md",
              content,
              expectedHash: prompt.includes("replace") ? originalHash : null,
            },
            type: "tool_call",
          },
        ],
      });
    },
  });
  try {
    await page.goto("/");
    const { token } = await (await page.request.get("/api/v1/session")).json(),
      headers = { "x-rocky-session": token };
    const workspaceId = randomUUID(),
      connectionId = randomUUID();
    expect(
      (
        await page.request.post("/api/v1/workspaces", {
          headers,
          data: {
            id: workspaceId,
            requestId: randomUUID(),
            expectedRevision: 0,
            name: "Approval workspace",
            root,
          },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await page.request.post("/api/v1/model-connections", {
          headers,
          data: {
            id: connectionId,
            requestId: randomUUID(),
            expectedRevision: 0,
            config: {
              name: "Write provider fixture",
              provider: "openai-compatible",
              baseUrl: provider.baseUrl,
              modelId: "fixture",
              contextWindowTokens: 65536,
              maxOutputTokens: 256,
            },
          },
        })
      ).ok(),
    ).toBe(true);
    for (const mode of ["reject", "approve", "replace", "stale"]) {
      const prompt = "Browser write " + mode + " " + Date.now();
      const response = await page.request.post(
        "/api/v1/conversation/messages",
        {
          headers,
          data: {
            requestId: randomUUID(),
            text: prompt,
            mode: "configured",
            modelSelection: { connectionId, revision: 1 },
            workspaceId,
            workspaceRevision: 1,
            workspaceRead: false,
          },
        },
      );
      expect(response.ok()).toBe(true);
      const work = await response.json();
      const article = page.locator("article.work").filter({ hasText: prompt }),
        card = article.locator(".approval");
      await expect(card).toBeVisible();
      await expect(card).toContainText("待寫入完整內容");
      await expect(card.locator("pre")).toHaveText(content);
      if (mode === "replace") {
        await card
          .getByRole("button", { name: "檢視差異", exact: true })
          .click();
        await expect(card.getByLabel("檔案差異")).toContainText(
          "OLD_OWNER_TEXT",
        );
        await expect(card.getByLabel("檔案差異")).toContainText(
          "Owner approved document",
        );
        await expect(card).toContainText("UTF-8 BOM: yes → no");
        await expect(card).toContainText("CRLF → LF");
        expect(await readFile(join(root, "replace.md"), "utf8")).toBe(original);
      }
      if (mode === "approve" || mode === "replace") {
        for (const [width, height] of [
          [1440, 900],
          [1280, 800],
          [390, 844],
          [320, 844],
        ]) {
          await page.setViewportSize({ width, height });
          await card
            .getByRole("button", { name: "核准這次操作" })
            .scrollIntoViewIfNeeded();
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          await expect(
            card.getByRole("button", { name: "核准這次操作" }),
          ).toBeVisible();
          await page.screenshot({
            path: `test-results/${mode === "replace" ? "workspace-diff" : "workspace-write"}-${width}.png`,
          });
        }
        await page.emulateMedia({ reducedMotion: "reduce" });
        await card.getByRole("button", { name: "核准這次操作" }).focus();
        await expect(
          card.getByRole("button", { name: "核准這次操作" }),
        ).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(article).toContainText("Write receipt:");
        expect(
          await readFile(
            join(root, mode === "replace" ? "replace.md" : "approved.md"),
            "utf8",
          ),
        ).toBe(content);
        if (mode === "approve") {
          await article.getByText("工作詳情", { exact: true }).click();
          await article.getByText("操作與對帳", { exact: true }).click();
          await article.getByRole("button", { name: "保存成果快照" }).click();
          await expect(article).toContainText("成果已保存");
          await writeFile(
            join(root, "approved.md"),
            "SOURCE_CHANGED_AFTER_PUBLICATION",
          );
          await page
            .getByRole("button", { name: "開啟導覽", exact: true })
            .click();
          await page
            .locator(".sidebar")
            .getByRole("button", { name: "文件與成果", exact: true })
            .click();
          const library = page.locator(".artifact-library");
          await library
            .getByRole("button", { name: "預覽", exact: true })
            .first()
            .click();
          await expect(library.getByLabel("成果內容")).toHaveText(content);
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
            await expect(
              library.getByRole("link", { name: "下載原始檔案" }),
            ).toBeVisible();
            const pane = await page.locator(".result-pane").boundingBox();
            expect(pane?.width).toBe(
              width! > 1100
                ? Math.min(660, Math.max(390, width! * 0.4))
                : width!,
            );
            expect(pane?.y).toBe(64);
            await page.screenshot({
              path: `test-results/artifact-preview-${width}.png`,
            });
          }
          const href = await library
            .getByRole("link", { name: "下載原始檔案" })
            .getAttribute("href");
          const downloaded = await page.request.get(href!);
          expect((await downloaded.body()).toString("utf8")).toBe(content);
          const downloadEvent = page.waitForEvent("download");
          await library.getByRole("link", { name: "下載原始檔案" }).click();
          const actualDownload = await downloadEvent;
          expect(await readFile((await actualDownload.path())!, "utf8")).toBe(
            content,
          );
          await library.getByRole("button", { name: "返回成果" }).click();
          await expect(
            library.getByRole("button", { name: "預覽", exact: true }).first(),
          ).toBeFocused();
          await page.screenshot({
            path: "test-results/artifact-library-320.png",
          });
          await library
            .getByRole("button", { name: "預覽", exact: true })
            .first()
            .press("Enter");
          await expect(
            library.getByRole("heading", { name: "工作成果", exact: true }),
          ).toBeFocused();
          await page.setViewportSize({ width: 1440, height: 900 });
          await page
            .getByRole("button", { name: "English", exact: true })
            .click();
          await page
            .getByRole("button", { name: "Toggle theme", exact: true })
            .click();
          await expect(library.getByLabel("Artifact content")).toHaveText(
            content,
          );
          await page.screenshot({
            path: "test-results/artifact-preview-1440-dark-en.png",
          });
          await page
            .getByRole("button", { name: "繁體中文", exact: true })
            .click();
          await page
            .getByRole("button", { name: "Toggle theme", exact: true })
            .click();
          await page.setViewportSize({ width: 320, height: 844 });
          await page.keyboard.press("Escape");
          await expect(library).not.toBeVisible();
          await expect(
            page.getByRole("button", { name: "開啟導覽", exact: true }),
          ).toBeFocused();
        }
      } else if (mode === "reject") {
        await card.getByRole("button", { name: "拒絕", exact: true }).click();
        await expect(card).not.toBeVisible();
        await expect(readFile(join(root, "reject.md"))).rejects.toThrow();
      } else {
        await writeFile(
          join(root, "stale.md"),
          "EXTERNAL_FILE_MUST_BE_PRESERVED",
        );
        await card
          .getByRole("button", { name: "檢視差異", exact: true })
          .click();
        await expect(card.getByRole("alert")).toContainText(
          "File state changed",
        );
        await card.getByRole("button", { name: "核准這次操作" }).click();
        await expect(article).toContainText("File state changed");
        expect(await readFile(join(root, "stale.md"), "utf8")).toBe(
          "EXTERNAL_FILE_MUST_BE_PRESERVED",
        );
        const result = await (
          await page.request.get(`/api/v1/works/${work.id}/operations`)
        ).json();
        expect(
          result.operations.every(
            (o: { outcome: string }) => o.outcome === "not_executed",
          ),
        ).toBe(true);
      }
    }
  } finally {
    await provider.close();
    await rm(root, { recursive: true, force: true });
  }
});
