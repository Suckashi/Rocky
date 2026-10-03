import { test, expect } from "@playwright/test";
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
