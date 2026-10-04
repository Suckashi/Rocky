import { test, expect } from "./fixture.js";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { cpus, totalmem } from "node:os";
import { AIMessage, type ToolMessage } from "@langchain/core/messages";
import { PNG } from "pngjs";
import { startAgentProvider } from "../../fixtures/models/agent-provider.js";

test("new document revisions and restore preserve previous content", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "文件與成果", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "建立文件", exact: true }).click();
  await page
    .getByLabel("文件標題", { exact: true })
    .fill("Browser revision fixture");
  await page
    .getByRole("textbox", { name: "Markdown 原始內容", exact: true })
    .fill("# First saved revision");
  await page.getByRole("button", { name: "儲存新版本", exact: true }).click();
  await expect(page.getByText("新版本已儲存。", { exact: true })).toBeVisible();
  await page
    .getByRole("textbox", { name: "Markdown 原始內容", exact: true })
    .fill("# Second saved revision");
  await page.getByRole("button", { name: "儲存新版本", exact: true }).click();
  await expect(page.getByText("新版本已儲存。", { exact: true })).toBeVisible();
  await page.getByText("版本紀錄與還原", { exact: true }).click();
  await page.getByRole("button", { name: "載入版本清單", exact: true }).click();
  await expect(page.locator(".document-history li")).toHaveCount(3);
  await page.getByLabel("查看版本", { exact: true }).fill("2");
  await page.getByRole("button", { name: "讀取歷史版本", exact: true }).click();
  await expect(page.getByLabel("歷史版本內容", { exact: true })).toHaveText(
    "# First saved revision",
  );
  await page
    .getByRole("button", { name: "載入此版本到草稿", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Markdown 原始內容", exact: true }),
  ).toHaveValue("# First saved revision");
  await page.getByRole("button", { name: "儲存新版本", exact: true }).click();
  await expect(page.getByText("新版本已儲存。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "載入版本清單", exact: true }).click();
  await expect(page.locator(".document-history li")).toHaveCount(4);
  await page.screenshot({ path: "test-results/document-revisions.png" });
});

test("PNG upload is sanitized, bound to the submitted Work and delivered to the selected vision model", async ({
  page,
}) => {
  let attachmentId = "";
  const readCallId = randomUUID();
  const provider = await startAgentProvider({
    reply: async (messages) =>
      messages.some(
        (message) =>
          message.type === "tool" &&
          (message as ToolMessage).tool_call_id === readCallId,
      )
        ? new AIMessage("Attachment fixture received")
        : new AIMessage({
            content: "",
            tool_calls: [
              {
                id: readCallId,
                name: "attachment_read",
                args: { id: attachmentId },
                type: "tool_call",
              },
            ],
          }),
  });
  try {
    await page.goto("/");
    const { token } = await (await page.request.get("/api/v1/session")).json();
    const connectionId = randomUUID();
    const saved = await page.request.post("/api/v1/model-connections", {
      headers: { "x-rocky-session": token },
      data: {
        requestId: randomUUID(),
        id: connectionId,
        expectedRevision: 0,
        config: {
          name: "Attachment browser fixture",
          provider: "openai-compatible",
          baseUrl: provider.baseUrl,
          modelId: "fixture",
          contextWindowTokens: 65536,
          maxOutputTokens: 128,
          visionEnabled: true,
        },
      },
    });
    expect(saved.ok()).toBe(true);
    await page
      .getByRole("button", { name: "設定", exact: true })
      .last()
      .click();
    await page.getByText("模型連線設定", { exact: true }).click();
    await page
      .locator(".model-card")
      .filter({ hasText: "Attachment browser fixture" })
      .getByRole("button", { name: "使用此模型", exact: true })
      .click();
    await page.keyboard.press("Escape");
    const composer = page.locator(".composer-tools");
    await composer.locator("summary").filter({ hasText: /^附件/ }).click();
    const png = new PNG({ width: 2, height: 2 });
    png.data.fill(255);
    const uploaded = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/attachments") &&
        response.request().method() === "POST",
    );
    await composer.locator('input[type="file"]').setInputFiles({
      name: "fixture.png",
      mimeType: "image/png",
      buffer: PNG.sync.write(png),
    });
    attachmentId = (await (await uploaded).json()).id;
    await expect(
      composer.getByRole("img", { name: "fixture.png" }),
    ).toBeVisible();
    const prompt = "Inspect uploaded PNG " + randomUUID();
    await page.locator("#compose textarea").fill(prompt);
    await page.getByRole("button", { name: "送出", exact: true }).click();
    const work = page.locator("article.work").filter({ hasText: prompt });
    await expect(work.getByText("已完成", { exact: true })).toBeVisible();
    const works = (await (await page.request.get("/api/v1/works")).json())
      .works;
    const item = works.find((w: { text: string }) => w.text === prompt);
    expect(item.attachments).toHaveLength(1);
    expect(
      provider.requests.some((request) =>
        JSON.stringify(request).includes("data:image/png;base64,"),
      ),
    ).toBe(true);
    const attachment = await (
      await page.request.get(`/api/v1/attachments/${item.attachments[0].id}`)
    ).json();
    expect(attachment.sha256).toBe(item.attachments[0].sha256);
    await page.reload();
    await expect(work.getByText("已完成", { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 320, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: "test-results/attachment-work-320.png" });
  } finally {
    await provider.close();
  }
});

test("Learning Inbox edits, evaluates and withdraws a real reflected candidate without bypassing publication", async ({
  page,
}) => {
  test.setTimeout(90000);
  let evidenceId = "";
  const provider = await startAgentProvider({
    reply: async (messages) =>
      messages.some((message) => message.type === "tool")
        ? new AIMessage("Saved browser candidate")
        : new AIMessage({
            content: "",
            tool_calls: [
              {
                id: "browser-proposal",
                name: "propose_skill_create",
                type: "tool_call",
                args: {
                  candidate: {
                    name: "browser-inbox-fixture",
                    description: "Synthetic browser workflow",
                    goal: "Review observed fixture",
                    preconditions: ["Local fixture"],
                    triggers: ["Synthetic request"],
                    steps: ["Inspect observed receipt"],
                    stopConditions: ["Missing receipt"],
                    verification: ["Check actual receipt"],
                    evidenceRefs: [evidenceId],
                    requiredCapabilities: [],
                    knownLimitations: ["Synthetic test, not live efficacy"],
                  },
                },
              },
            ],
          }),
  });
  try {
    await page.goto("/");
    const { token } = await (await page.request.get("/api/v1/session")).json();
    const post = async (path: string, data: unknown) => {
      const response = await page.request.post("/api/v1" + path, {
        headers: { "x-rocky-session": token },
        data,
      });
      expect(response.ok(), await response.text()).toBe(true);
      return response.json();
    };
    const source = await post("/conversation/messages", {
      requestId: randomUUID(),
      text: "Inbox source fixture " + randomUUID(),
      mode: "fixture",
      transport: "http",
      kind: "background",
    });
    const getWork = async (id: string) =>
      (await page.request.get(`/api/v1/works/${id}`)).json();
    await expect
      .poll(async () => (await getWork(source.id)).status)
      .toBe("waiting_approval");
    const approval = (await getWork(source.id)).approval;
    await post(`/approvals/${approval.id}/decision`, {
      requestId: randomUUID(),
      expectedRevision: approval.revision,
      intentFingerprint: approval.intentFingerprint,
      decision: "approve",
    });
    await expect
      .poll(async () => (await getWork(source.id)).status)
      .toBe("completed");
    // Read only the owned fixture's immutable event identity; all mutations go through owner HTTP.
    const db = new DatabaseSync(
      join(process.env.ROCKY_E2E_ROOT!, "domain.sqlite"),
      { readOnly: true },
    );
    try {
      const row = db
        .prepare(
          "SELECT data FROM events WHERE json_extract(data,'$.workId')=? AND json_extract(data,'$.payload.name')='rocky.operation.succeeded' LIMIT 1",
        )
        .get(source.id) as { data: string };
      evidenceId = JSON.parse(row.data).id;
    } finally {
      db.close();
    }
    await post(`/works/${source.id}/learning-consent`, {
      requestId: randomUUID(),
      expectedRevision: 0,
      private: false,
      excluded: false,
      sourceReuseAllowed: true,
    });
    const policy = await (
      await page.request.get("/api/v1/learning/policy")
    ).json();
    const episode = await post("/learning/episodes", {
      requestId: randomUUID(),
      workId: source.id,
      expectedPolicyRevision: policy.revision,
      expectedConsentRevision: 1,
      trigger: "manual_request",
      goal: "Inspect actual synthetic receipt",
      constraints: [],
      corrections: [],
      verification: ["Observed source result"],
      failuresAndRepairs: [],
      preconditions: [],
      evidenceEventIds: [evidenceId],
    });
    const reviewed = await post(`/learning/episodes/${episode.id}/review`, {
      requestId: randomUUID(),
      expectedRevision: episode.revision,
      contentHash: episode.contentHash,
      decision: "approve",
    });
    const connectionId = randomUUID();
    await post("/model-connections", {
      requestId: randomUUID(),
      id: connectionId,
      expectedRevision: 0,
      config: {
        name: "Inbox reflection fixture",
        provider: "openai-compatible",
        baseUrl: provider.baseUrl,
        modelId: "fixture",
        contextWindowTokens: 65536,
        maxOutputTokens: 512,
      },
    });
    const reflection = await post("/learning/reflections", {
      requestId: randomUUID(),
      binding: {
        episodeId: episode.id,
        episodeRevision: reviewed.revision,
        episodeHash: episode.contentHash,
      },
      modelSelection: { connectionId, revision: 1 },
      modelBudget: { maxCalls: 4 },
    });
    await expect
      .poll(async () => (await getWork(reflection.id)).status, {
        timeout: 15000,
      })
      .toBe("completed");
    const suite = await post("/learning/suites", {
      requestId: randomUUID(),
      id: randomUUID(),
      expectedRevision: 0,
      name: "Inbox insufficient fixture",
      primaryMetric: "task_success",
      improvement: "task_success",
      minimumImprovement: 0.1,
      modelBudget: { maxCalls: 12 },
      maxRuns: 2,
      maxModelCalls: 24,
      maxTokens: 2000000,
      wallBudgetMs: 30000,
      reportByteBudget: 1048576,
      cases: [
        {
          id: randomUUID(),
          revision: 1,
          family: "browser-fixture",
          sourceGroup: "manual",
          split: "train",
          kind: "sample_workflow",
          prompt: "Inspect synthetic sample",
          transport: "http",
          decision: "approve",
          required: true,
          negative: false,
          expected: { writes: 1, childCompleted: true },
        },
      ],
    });
    await page.getByRole("button", { name: "Learning", exact: true }).click();
    const inbox = page.locator("details").filter({
      has: page.locator(":scope > summary", { hasText: "學習收件匣" }),
    });
    await inbox.locator(":scope > summary").click();
    await inbox
      .getByRole("button", { name: "載入／重新整理", exact: true })
      .click();
    await inbox
      .locator("article")
      .filter({ hasText: "browser-inbox-fixture" })
      .getByRole("button", { name: "審查候選" })
      .click();
    const review = inbox.getByRole("region", { name: "候選審查" });
    await expect(
      review.getByRole("button", { name: "發布確切版本" }),
    ).toBeDisabled();
    await review.getByText("編輯候選（須重新評測）", { exact: true }).click();
    await review
      .getByRole("textbox", { name: "步驟 / Steps", exact: true })
      .fill("Inspect receipt and compare its immutable identity");
    await review
      .getByLabel("修改理由", { exact: true })
      .fill("Add explicit identity verification");
    await review
      .getByRole("button", { name: "保存新版本並使舊評測失效" })
      .click();
    await expect(review.getByRole("heading")).toContainText("r2");
    await review
      .getByLabel("固定評測集", { exact: false })
      .selectOption(suite.id);
    await review.getByRole("button", { name: "執行評測／重試" }).click();
    await expect
      .poll(
        async () => {
          await review
            .getByRole("button", { name: "重新整理候選與評測" })
            .click();
          return review.locator(':scope > [role="status"]').textContent();
        },
        { timeout: 30000 },
      )
      .toContain("insufficient_evidence");
    await expect(
      review.getByRole("button", { name: "發布確切版本" }),
    ).toBeDisabled();
    await review.getByRole("button", { name: "操作歷史", exact: true }).click();
    await page.screenshot({
      path: "test-results/learning-inbox-evaluated.png",
    });
    await review.getByRole("button", { name: "撤回", exact: true }).click();
    await expect(review.locator(':scope > [role="status"]')).toContainText(
      "withdrawn",
    );
  } finally {
    await provider.close();
  }
});

test("measured warm UI and durable terminal-event projection", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  const provider = await startAgentProvider({
    reply: async () => new AIMessage("Measured fixture completion"),
  });
  const navigation: number[] = [],
    receipts: number[] = [],
    projection: number[] = [];
  try {
    for (let i = 0; i < 5; i++) {
      const start = Date.now();
      await page.goto("/");
      await expect(page.getByText("本機已連線", { exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "設定", exact: true }).last(),
      ).toBeEnabled();
      navigation.push(Date.now() - start);
    }
    const { token } = await (await page.request.get("/api/v1/session")).json(),
      connectionId = randomUUID();
    const headers = { "x-rocky-session": token };
    expect(
      (
        await page.request.post("/api/v1/model-connections", {
          headers,
          data: {
            id: connectionId,
            requestId: randomUUID(),
            expectedRevision: 0,
            config: {
              name: "Timing local fixture",
              provider: "openai-compatible",
              baseUrl: provider.baseUrl,
              modelId: "fixture",
              contextWindowTokens: 65536,
              maxOutputTokens: 128,
            },
          },
        })
      ).ok(),
    ).toBe(true);
    for (let i = 0; i < 10; i++) {
      const text = "Timed terminal event " + randomUUID(),
        start = Date.now();
      // Timestamp the rendered transition in the page. Playwright's assertion
      // backoff measures the next polling opportunity, not the UI update.
      const renderedAt = page.evaluate(
        (title) =>
          new Promise<number>((resolve, reject) => {
            const timer = setTimeout(() => {
              observer.disconnect();
              reject(Error("No rendered completion within 30 seconds"));
            }, 30000);
            const inspect = () => {
              const card = [...document.querySelectorAll("article.work")].find(
                (element) => element.getAttribute("aria-label") === title,
              );
              const status =
                card?.querySelector<HTMLElement>(".status.completed");
              if (!status || !status.getClientRects().length) return;
              observer.disconnect();
              clearTimeout(timer);
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve(Date.now())),
              );
            };
            const observer = new MutationObserver(inspect);
            observer.observe(document.body, {
              subtree: true,
              childList: true,
              attributes: true,
            });
            inspect();
          }),
        text,
      );
      const response = await page.request.post(
        "/api/v1/conversation/messages",
        {
          headers,
          data: {
            requestId: randomUUID(),
            text,
            mode: "configured",
            modelSelection: { connectionId, revision: 1 },
          },
        },
      );
      expect(response.ok()).toBe(true);
      receipts.push(Date.now() - start);
      const work = await response.json();
      await expect(
        page
          .locator("article.work")
          .filter({ hasText: text })
          .getByText("已完成", { exact: true }),
      ).toBeVisible();
      const visibleAt = await renderedAt;
      const db = new DatabaseSync(
        join(process.env.ROCKY_E2E_ROOT!, "domain.sqlite"),
        { readOnly: true },
      );
      try {
        const row = db
          .prepare(
            "SELECT data FROM events WHERE json_extract(data,'$.workId')=? AND json_extract(data,'$.payload.name')='rocky.work.updated' AND json_extract(data,'$.payload.data.work.status')='completed' ORDER BY sequence DESC LIMIT 1",
          )
          .get(work.id) as { data: string };
        projection.push(visibleAt - Date.parse(JSON.parse(row.data).timestamp));
      } finally {
        db.close();
      }
    }
    const p95 = (items: number[]) =>
      [...items].sort((a, b) => a - b)[Math.ceil(items.length * 0.95) - 1]!;
    await testInfo.attach("local-performance", {
      contentType: "application/json",
      body: JSON.stringify({
        platform: process.platform,
        node: process.version,
        cpu: cpus()[0]?.model,
        totalMemoryBytes: totalmem(),
        mode: "fixture",
        navigationMs: navigation,
        submissionReceiptMs: receipts,
        eventToVisibleUpperBoundMs: projection,
        projectionMeasurement:
          "MutationObserver followed by two animation frames",
        p95: {
          navigationMs: p95(navigation),
          submissionMs: p95(receipts),
          projectionMs: p95(projection),
        },
        targets: { navigationMs: 5000, submissionMs: 300, projectionMs: 500 },
        limitations: [
          "Dev-server UI and scripted local model; measurement includes two rendering frames and host scheduling.",
          "Current hardware baseline only; no before/after speedup claim.",
          process.env.ROCKY_TEST_BROWSER
            ? "Explicit compatibility browser override; not pinned-browser or egress acceptance."
            : "Pinned Playwright browser; this performance fixture does not establish egress acceptance.",
        ],
      }),
    });
    expect(p95(navigation)).toBeLessThan(5000);
    expect(p95(receipts)).toBeLessThan(300);
    expect(p95(projection)).toBeLessThan(500);
  } finally {
    await provider.close();
  }
});
