import { test, expect } from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { AIMessage } from "@langchain/core/messages";
import { startAgentProvider } from "../../fixtures/models/agent-provider.js";
const exec = promisify(execFile);
test("worktree exact approval and registration at four widths", async ({
  page,
}) => {
  const base = await mkdtemp(join(tmpdir(), "rocky-browser-worktree-")),
    root = join(base, "source");
  await mkdir(root);
  const git = async (args: string[]) =>
    exec(
      "git",
      [
        "-c",
        "core.hooksPath=" +
          (process.platform === "win32" ? "NUL" : "/dev/null"),
        "-c",
        "commit.gpgSign=false",
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        ...args,
      ],
      {
        cwd: root,
        windowsHide: true,
        env: {
          ...process.env,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
        },
      },
    );
  await git(["init", "--template=", "-b", "main"]);
  await writeFile(join(root, "file.txt"), "COMMITTED");
  await git(["add", "file.txt"]);
  await git(["commit", "-m", "fixture"]);
  await writeFile(join(root, "file.txt"), "DIRTY");
  const provider = await startAgentProvider({
    reply: async (messages) => {
      const turn = messages.findLastIndex(
        (m) =>
          m.type === "human" &&
          String(m.content).startsWith("Browser worktree "),
      );
      const last = messages
        .slice(turn + 1)
        .filter((m) => m.type === "tool")
        .at(-1);
      if (last)
        return new AIMessage("Worktree receipt: " + String(last.content));
      return new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "browser-tree",
            name: "workspace_worktree",
            args: {},
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
            name: "Git source",
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
              name: "Worktree fixture",
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
    for (const mode of ["reject", "approve"]) {
      const prompt = "Browser worktree " + mode + " " + Date.now();
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
      await expect(card).toContainText("未提交與未追蹤檔案不會帶入");
      const destination = join(base, "rocky-worktree-" + work.runId);
      await expect(stat(destination)).rejects.toThrow();
      if (mode === "reject") {
        await card.getByRole("button", { name: "拒絕", exact: true }).click();
        await expect(card).not.toBeVisible();
        await expect(stat(destination)).rejects.toThrow();
        continue;
      }
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
          card.getByRole("button", { name: "核准這次操作" }),
        ).toBeVisible();
        await page.screenshot({
          path: `test-results/workspace-worktree-${width}.png`,
        });
      }
      await card
        .getByRole("button", { name: "核准這次操作" })
        .scrollIntoViewIfNeeded();
      await expect(
        card.getByRole("button", { name: "核准這次操作" }),
      ).toBeInViewport();
      await page.screenshot({
        path: "test-results/workspace-worktree-320-actions.png",
      });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await card.getByRole("button", { name: "核准這次操作" }).focus();
      await expect(
        card.getByRole("button", { name: "核准這次操作" }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(article).toContainText("Worktree receipt:");
      expect(await readFile(join(destination, "file.txt"), "utf8")).toBe(
        "COMMITTED",
      );
      expect(await readFile(join(root, "file.txt"), "utf8")).toBe("DIRTY");
      const result = await (
        await page.request.get(`/api/v1/works/${work.id}/operations`)
      ).json();
      expect(result.operations[0].outcome).toBe("succeeded");
    }
  } finally {
    await provider.close();
    await rm(base, { recursive: true, force: true });
  }
});
