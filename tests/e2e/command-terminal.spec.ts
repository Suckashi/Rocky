import { test, expect } from "./fixture.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { AIMessage } from "@langchain/core/messages";
import { startAgentProvider } from "../../fixtures/models/agent-provider.js";

test("exact owner command approval, refusal and unknown receipt reach the same Computer Work", async ({
  page,
}) => {
  test.setTimeout(90000);
  const root = await mkdtemp(join(tmpdir(), "rocky-command-browser-"));
  const provider = await startAgentProvider({
    reply: async (messages) => {
      const turn = messages.findLastIndex(
        (message) =>
          message.type === "human" &&
          String(message.content).startsWith("Command browser "),
      );
      const prompt = String(messages[turn]?.content);
      if (messages.slice(turn + 1).some((message) => message.type === "tool"))
        return new AIMessage(
          "Observed command receipt; no external-effect claim.",
        );
      return new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "browser-command",
            type: "tool_call",
            name: "workspace_command",
            args: {
              executable: process.execPath,
              args: [
                "-e",
                `console.log('BROWSER_STDOUT');console.error('BROWSER_STDERR');${prompt.includes("unknown") ? "process.exit(2)" : ""}`,
              ],
              timeoutMs: 5000,
              maxOutputBytes: 4096,
            },
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
            name: "Command browser fixture",
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
              name: "Command browser fixture",
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
    for (const mode of ["reject", "approve", "unknown"] as const) {
      const prompt = `Command browser ${mode} ${randomUUID()}`;
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
      const card = page
        .locator("article.work")
        .filter({ hasText: prompt })
        .locator(".approval");
      await expect(card).toBeVisible();
      await expect(card).toContainText("BROWSER_STDOUT");
      await expect(card).toContainText(process.execPath);
      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await card.screenshot({
        path: `test-results/command-approval-${mode}.png`,
      });
      await card
        .getByRole("button", {
          name: mode === "reject" ? "拒絕" : "核准這次操作",
          exact: true,
        })
        .click();
      await expect
        .poll(
          async () =>
            (
              await (
                await page.request.get(`/api/v1/works/${work.id}/commands`)
              ).json()
            ).commands[0]?.phase,
        )
        .toBe("settled");
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.getByRole("button", { name: "Computer", exact: true }).click();
      const pane = page.locator(".result-pane");
      await pane.getByRole("tab", { name: "Terminal", exact: true }).click();
      await pane.getByLabel("檢視工作").selectOption(work.id);
      if (mode === "reject") {
        await expect(pane).toContainText("已拒絕，沒有執行");
        await expect(pane.locator('pre[aria-label="stdout"]')).toHaveCount(0);
      } else {
        await expect(pane.locator('pre[aria-label="stdout"]')).toContainText(
          "BROWSER_STDOUT",
        );
        await expect(pane.locator('pre[aria-label="stderr"]')).toContainText(
          "BROWSER_STDERR",
        );
        await expect(pane).toContainText(
          mode === "unknown" ? "效果未知" : "succeeded",
        );
      }
      await pane.getByText("工作與操作識別", { exact: true }).click();
      await expect(pane).toContainText(work.runId);
      await pane.screenshot({
        path: `test-results/command-terminal-${mode}.png`,
      });
      await page.keyboard.press("Escape");
    }
  } finally {
    await provider.close();
    const target = resolve(root),
      rel = relative(resolve(tmpdir()), target);
    if (!rel || rel.startsWith("..") || isAbsolute(rel))
      throw Error("Unsafe fixture cleanup");
    await rm(target, { recursive: true, force: true });
  }
});
