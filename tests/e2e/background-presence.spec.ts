import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AIMessage } from "@langchain/core/messages";
import { test, expect } from "./fixture.js";
import { randomUUID } from "node:crypto";
import { startAgentProvider } from "../../fixtures/models/agent-provider.js";
test("background attention navigates to authoritative terminal Work without changing foreground", async ({
  page,
}) => {
  const provider = await startAgentProvider({
    reply: async () => {
      throw Error("Explicit fixture provider failure");
    },
  });
  try {
    await page.goto("/");
    const { token } = await (await page.request.get("/api/v1/session")).json(),
      headers = { "x-rocky-session": token },
      connectionId = randomUUID(),
      title = "Background failure " + randomUUID();
    expect(
      (
        await page.request.post("/api/v1/model-connections", {
          headers,
          data: {
            requestId: randomUUID(),
            id: connectionId,
            expectedRevision: 0,
            config: {
              name: "Background failure fixture",
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
    const response = await page.request.post("/api/v1/conversation/messages", {
      headers,
      data: {
        requestId: randomUUID(),
        kind: "background",
        text: title,
        mode: "configured",
        modelSelection: { connectionId, revision: 1 },
      },
    });
    expect(response.ok()).toBe(true);
    const work = await response.json();
    await expect
      .poll(
        async () =>
          (await (await page.request.get("/api/v1/works/" + work.id)).json())
            .status,
      )
      .toBe("failed");
    await page.reload();
    const presence = page.locator(".rocky-presence"),
      summary = page.locator(".presence-background summary");
    await expect(summary).toBeVisible();
    const foreground = await presence.getAttribute("data-presence");
    for (const [width, height] of [
      [1440, 900],
      [1280, 800],
      [390, 844],
      [320, 844],
    ]) {
      await page.setViewportSize({ width: width!, height: height! });
      await summary.click();
      const item = page
        .locator(".presence-background button")
        .filter({ hasText: title });
      await expect(item).toContainText("工作失敗");
      await item.scrollIntoViewIfNeeded();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: "test-results/background-presence-" + width + ".png",
      });
      await item.focus();
      await page.keyboard.press("Enter");
      const target = page.locator("#work-" + work.id);
      await expect(target).toBeFocused();
      await expect(target.locator(".status")).toHaveText("失敗");
      await expect(presence).toHaveAttribute("data-presence", foreground!);
      await expect(page.locator(".presence-background")).not.toHaveAttribute(
        "open",
        "",
      );
    }
  } finally {
    await provider.close();
  }
});

test("workspace wait is persisted, visible and cleared on exact cancel", async ({
  page,
}) => {
  const root = await mkdtemp(join(tmpdir(), "rocky-presence-wait-"));
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const provider = await startAgentProvider({
    reply: async () => {
      await held;
      return new AIMessage("released fixture");
    },
  });
  try {
    await page.goto("/");
    const { token } = await (await page.request.get("/api/v1/session")).json(),
      headers = { "x-rocky-session": token },
      connectionId = randomUUID(),
      workspaceId = randomUUID();
    expect(
      (
        await page.request.post("/api/v1/model-connections", {
          headers,
          data: {
            requestId: randomUUID(),
            id: connectionId,
            expectedRevision: 0,
            config: {
              name: "Held presence fixture",
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
    expect(
      (
        await page.request.post("/api/v1/workspaces", {
          headers,
          data: {
            requestId: randomUUID(),
            id: workspaceId,
            expectedRevision: 0,
            name: "Wait fixture",
            root,
          },
        })
      ).ok(),
    ).toBe(true);
    const submit = async (kind: string) => {
      const response = await page.request.post(
        "/api/v1/conversation/messages",
        {
          headers,
          data: {
            requestId: randomUUID(),
            kind,
            text: "Workspace wait " + kind,
            mode: "configured",
            modelSelection: { connectionId, revision: 1 },
            workspaceId,
            workspaceRevision: 1,
          },
        },
      );
      expect(response.ok()).toBe(true);
      return response.json();
    };
    const owner = await submit("main");
    await expect
      .poll(
        async () =>
          (await (await page.request.get("/api/v1/works/" + owner.id)).json())
            .status,
      )
      .toBe("running");
    const waiter = await submit("main");
    await expect
      .poll(
        async () =>
          (await (await page.request.get("/api/v1/works/" + waiter.id)).json())
            .waitingFor,
      )
      .toBe("workspace");
    await page.reload();
    await expect(page.locator(".rocky-presence")).toHaveAttribute(
      "data-presence",
      "waiting_resource",
    );
    await expect(page.locator("#work-" + waiter.id + " .status")).toHaveText(
      "等待工作區可用",
    );
    await expect(page.locator(".rocky-presence .rocky-avatar")).not.toHaveClass(
      /presence-moving/,
    );
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
        path: "test-results/workspace-wait-" + width + ".png",
      });
    }
    const current = await (
      await page.request.get("/api/v1/works/" + waiter.id)
    ).json();
    expect(
      (
        await page.request.post("/api/v1/works/" + waiter.id + "/stop", {
          headers,
          data: {
            requestId: randomUUID(),
            runId: current.runId,
            executionSessionId: current.executionSessionId,
            expectedRevision: current.revision,
          },
        })
      ).ok(),
    ).toBe(true);
    const stopped = await (
      await page.request.get("/api/v1/works/" + waiter.id)
    ).json();
    expect(stopped.status).toBe("cancelled");
    expect(stopped.waitingFor).toBeUndefined();
    await expect(page.locator(".rocky-presence")).toHaveAttribute(
      "data-presence",
      "cancelled",
    );
  } finally {
    release();
    await provider.close();
    await rm(root, { recursive: true, force: true });
  }
});
