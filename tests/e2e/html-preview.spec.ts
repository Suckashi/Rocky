import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { AIMessage } from "@langchain/core/messages";
import { startAgentProvider } from "../../fixtures/models/agent-provider.js";
test("restricted HTML artifact renders without script, storage, API or network authority", async ({
  page,
}) => {
  const hits: string[] = [];
  const canary = createServer((req, res) => {
    hits.push(req.url ?? "");
    res.end("CANARY");
  });
  canary.listen(0, "127.0.0.1");
  await once(canary, "listening");
  const address = canary.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}`;
  const root = await mkdtemp(join(tmpdir(), "rocky-html-preview-"));
  const content = `<!doctype html><meta http-equiv=refresh content="0;url=${url}/refresh"><base href="${url}/"><style>@import url('${url}/import');body{color:rgb(18,52,86);background-image:url('${url}/css')}h1{font-size:24px}.report{padding:12px;border:1px solid #ddd}</style><script>window.ARTIFACT_SCRIPT_RAN=true;parent.localStorage.setItem('artifact-attack','yes');fetch('${url}/script');fetch('/api/v1/session')</script><section class=report onclick="fetch('${url}/click')"><h1>Verified local report</h1><p>Static HTML from an immutable artifact.</p><table><tr><th>Result</th><th>Status</th></tr><tr><td>Fixture report</td><td>Actual saved bytes</td></tr></table><a id=attack-link href='${url}/navigate' target=_top ping='${url}/ping'>Navigation disabled</a><img src='${url}/image' onerror="fetch('${url}/handler')"><iframe src='${url}/frame'></iframe><form action='${url}/form'><button>Submit</button></form></section>`;
  const title = "HTML preview " + randomUUID();
  const provider = await startAgentProvider({
    reply: async (messages) =>
      messages.filter((m) => m.type === "tool").length >= 2
        ? new AIMessage("HTML receipt")
        : messages.some((m) => m.type === "tool")
          ? new AIMessage({
              content: "",
              tool_calls: [
                {
                  id: "html-publish",
                  name: "artifact_publish",
                  args: { writeCallId: "html-write", title },
                  type: "tool_call",
                },
              ],
            })
          : new AIMessage({
              content: "",
              tool_calls: [
                {
                  id: "html-write",
                  name: "workspace_write",
                  args: { path: "report.html", content, expectedHash: null },
                  type: "tool_call",
                },
              ],
            }),
  });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const { token } = await (await page.request.get("/api/v1/session")).json(),
      headers = { "x-rocky-session": token },
      workspaceId = randomUUID(),
      connectionId = randomUUID();
    expect(
      (
        await page.request.post("/api/v1/workspaces", {
          headers,
          data: {
            requestId: randomUUID(),
            id: workspaceId,
            expectedRevision: 0,
            name: "HTML source",
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
            requestId: randomUUID(),
            id: connectionId,
            expectedRevision: 0,
            config: {
              name: "HTML fixture",
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
        text: "HTML_PREVIEW_FIXTURE",
        mode: "configured",
        modelSelection: { connectionId, revision: 1 },
        workspaceId,
        workspaceRevision: 1,
      },
    });
    expect(response.ok()).toBe(true);
    const work = await response.json();
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`/api/v1/works/${work.id}`)).json())
            .status,
      )
      .toBe("waiting_approval");
    await page
      .locator("article.work")
      .filter({ hasText: "HTML_PREVIEW_FIXTURE" })
      .getByRole("button", { name: "核准這次操作" })
      .click();
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`/api/v1/works/${work.id}`)).json())
            .status,
      )
      .toBe("completed");
    const { artifacts } = await (
      await page.request.get("/api/v1/artifacts")
    ).json();
    const artifact = artifacts.find(
      (item: { workId: string }) => item.workId === work.id,
    );
    expect(artifact).toBeTruthy();
    const delivery = page
      .locator(".delivered-artifact")
      .filter({ hasText: title });
    await expect(delivery).toBeVisible();
    for (const [width, height] of [
      [1440, 900],
      [1280, 800],
      [390, 844],
      [320, 844],
    ]) {
      await page.setViewportSize({ width: width!, height: height! });
      await delivery.scrollIntoViewIfNeeded();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: "test-results/artifact-card-" + width + ".png",
      });
    }
    const openResult = delivery.getByRole("button", { name: "開啟成果" });
    await openResult.click();
    await expect(page.locator(".artifact-library h2")).toHaveText(title);
    await page.keyboard.press("Escape");
    await expect(openResult).toBeFocused();
    await page.reload();
    await expect(delivery).toBeVisible();
    await openResult.click();
    const iframe = page.locator("iframe.html-artifact-preview");
    await expect(iframe).toHaveAttribute("sandbox", "");
    const frame = page.frameLocator("iframe.html-artifact-preview");
    await expect(
      frame.getByRole("heading", { name: "Verified local report" }),
    ).toBeVisible();
    await expect(frame.locator("body")).toHaveCSS("color", "rgb(18, 52, 86)");
    await expect(frame.locator("script,iframe,form,base")).toHaveCount(0);
    await expect(frame.locator("#attack-link")).not.toHaveAttribute(
      "href",
      /.+/,
    );
    const inner = await (await iframe.elementHandle())!.contentFrame();
    const probes = await inner!.evaluate(async () => {
      let parentBlocked = false,
        storageBlocked = false,
        cookieBlocked = false,
        fetchBlocked = false;
      try {
        void parent.document.body;
      } catch {
        parentBlocked = true;
      }
      try {
        void localStorage.length;
      } catch {
        storageBlocked = true;
      }
      try {
        void document.cookie;
      } catch {
        cookieBlocked = true;
      }
      try {
        await fetch("/api/v1/session");
      } catch {
        fetchBlocked = true;
      }
      return {
        parentBlocked,
        storageBlocked,
        cookieBlocked,
        fetchBlocked,
        scriptRan:
          (window as typeof window & { ARTIFACT_SCRIPT_RAN?: boolean })
            .ARTIFACT_SCRIPT_RAN === true,
      };
    });
    expect(probes).toEqual({
      parentBlocked: true,
      storageBlocked: true,
      cookieBlocked: true,
      fetchBlocked: true,
      scriptRan: false,
    });
    await frame.locator("#attack-link").click();
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
      await page.screenshot({ path: `test-results/html-preview-${width}.png` });
    }
    expect(hits).toEqual([]);
    expect((await page.request.get(url + "/positive-control")).ok()).toBe(true);
    expect(hits).toEqual(["/positive-control"]);
    const library = page.locator(".artifact-library");
    await library.getByRole("button", { name: "顯示原始碼" }).click();
    await expect(library.getByLabel("成果內容")).toHaveText(content);
    await expect(iframe).not.toBeAttached();
    const bytes = await (
      await page.request.get(
        `/api/v1/artifacts/${artifact.id}/files/${artifact.entry}`,
      )
    ).body();
    expect(bytes.toString("utf8")).toBe(content);
    await library.getByRole("button", { name: "顯示 HTML 預覽" }).focus();
    await page.keyboard.press("Escape");
    await expect(library).not.toBeVisible();
  } finally {
    await provider.close();
    await new Promise<void>((resolve) => canary.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
