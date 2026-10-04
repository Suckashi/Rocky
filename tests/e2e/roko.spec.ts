import { test, expect } from "./fixture.js";
import { randomUUID } from "node:crypto";
import type { Work, PublicEvent } from "../../packages/contracts/src/index.js";

test("Roko follows production Presence with deterministic transport fixtures and pauses decoration", async ({
  page,
}) => {
  const work: Work = {
    id: randomUUID(),
    runId: randomUUID(),
    executionSessionId: randomUUID(),
    requestId: randomUUID(),
    text: "Roko transport fixture",
    transport: "http",
    mode: "fixture",
    runMode: "normal",
    kind: "main",
    status: "running",
    revision: 1,
    answer: "",
    createdAt: new Date().toISOString(),
  };
  let sequence = 1000000;
  const event = (name: string, data: Record<string, unknown>): PublicEvent => ({
    schemaVersion: 1,
    id: randomUUID(),
    sequence: String(++sequence),
    timestamp: new Date().toISOString(),
    workId: work.id,
    runId: work.runId,
    executionSessionId: work.executionSessionId,
    payload: { kind: "domain", name, data },
  });
  const started = event("rocky.model.started", { requestId: "request" });
  let latest: Work = work;
  await page.route("**/api/v1/snapshot", async (route) => {
    const snapshot = await (await route.fetch()).json();
    await route.fulfill({
      json: {
        ...snapshot,
        works: [latest],
        events: [started],
        cursor: String(sequence),
      },
    });
  });
  await page.route("**/api/v1/conversation/history*", async (route) => {
    const history = await (await route.fetch()).json();
    await route.fulfill({
      json: { ...history, messages: [], nextCursor: null },
    });
  });
  await page.addInitScript(() => {
    const state = window as typeof window & {
      rokoEvents: (value: unknown) => void;
      rokoCompletions: number;
      rokoReconnect: () => void;
    };
    state.rokoCompletions = 0;
    class FixtureStream extends EventTarget {
      onopen?: () => void;
      onmessage?: (event: { data: string }) => void;
      onerror?: () => void;
      constructor() {
        super();
        state.rokoEvents = (value) =>
          this.onmessage?.({ data: JSON.stringify(value) });
        state.rokoReconnect = () => {
          this.onerror?.();
          this.onopen?.();
        };
        queueMicrotask(() => this.onopen?.());
      }
      close() {
        this.onmessage = undefined;
      }
    }
    Object.defineProperty(window, "EventSource", { value: FixtureStream });
    new MutationObserver((changes) => {
      for (const change of changes)
        if ((change.target as HTMLElement).dataset.clip === "jumping")
          state.rokoCompletions++;
    }).observe(document, {
      attributes: true,
      subtree: true,
      attributeFilter: ["data-clip"],
    });
  });
  await page.goto("/");
  const sprite = page.locator(".rocky-presence canvas");
  const send = async (value: PublicEvent) =>
    page.evaluate(
      (value) =>
        (
          window as typeof window & { rokoEvents: (v: unknown) => void }
        ).rokoEvents(value),
      value,
    );
  const update = async (status: Work["status"]) => {
    latest = { ...latest, status, revision: latest.revision + 1 };
    const e = event("rocky.work.updated", { work: latest });
    await send(e);
    return e;
  };
  await expect(sprite).toHaveAttribute("data-loaded", "true");
  await expect(sprite).toHaveAttribute("data-playing", "true");
  await expect(page.locator(".rocky-presence [role=status]")).toContainText(
    "等待模型回應",
  );
  await page.screenshot({ path: "test-results/roko-running-desktop.png" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(sprite).toHaveAttribute("data-playing", "false");
  await expect(sprite).toHaveAttribute("data-frame", "7:0");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(sprite).toHaveAttribute("data-playing", "true");
  await page.getByRole("button", { name: /角色動畫/ }).click();
  await expect(sprite).toHaveAttribute("data-playing", "false");
  await page.getByRole("button", { name: /角色動畫/ }).click();
  await expect(sprite).toHaveAttribute("data-playing", "true");
  await sprite.evaluate((el) => {
    el.style.visibility = "hidden";
    el.style.transform = "translateY(-10000px)";
  });
  await expect(sprite).toHaveAttribute("data-playing", "false");
  await sprite.evaluate((el) => {
    el.style.visibility = "";
    el.style.transform = "";
  });
  await expect(sprite).toHaveAttribute("data-playing", "true");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(sprite).toHaveAttribute("data-playing", "false");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(sprite).toHaveAttribute("data-playing", "true");
  await update("waiting_approval");
  await expect(sprite).toHaveAttribute("data-clip", "waiting");
  await expect(sprite).toHaveAttribute("data-playing", "false");
  const completed = await update("completed");
  await expect(sprite).toHaveAttribute("data-clip", "jumping");
  await expect(sprite).toHaveAttribute("data-clip", "idle");
  await send(completed);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { rokoCompletions: number }).rokoCompletions,
    ),
  ).toBe(1);
  await page.evaluate(() =>
    (window as typeof window & { rokoReconnect: () => void }).rokoReconnect(),
  );
  await expect(sprite).toHaveAttribute("data-clip", "idle");
  await page.reload();
  await expect(sprite).toHaveAttribute("data-loaded", "true");
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { rokoCompletions: number }).rokoCompletions,
    ),
  ).toBe(0);
  await update("failed");
  await expect(sprite).toHaveAttribute("data-clip", "failed");
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await page.setViewportSize({ width: 320, height: 844 });
  await page.screenshot({ path: "test-results/roko-failed-mobile-dark.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.locator(".rocky-presence [role=status]")).toContainText(
    "連線中斷",
  );
  await expect(sprite).toHaveAttribute("data-playing", "false");
});

test("Roko image failure leaves readable fallback and usable conversation", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/roko/roko-spritesheet.png", (route) => {
    requests++;
    return route.abort();
  });
  await page.goto("/");
  await expect(page.locator(".rocky-presence span.roko-sprite")).toHaveText(
    "Roko",
  );
  await expect(page.locator("#compose textarea")).toBeVisible();
  expect(requests).toBe(1);
});

test("Roko completion is consumed across component remounts", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".rocky-presence canvas")).toHaveAttribute(
    "data-loaded",
    "true",
  );
  await page.evaluate(async () => {
    // Import the actual Vite-served component for a remount lifecycle fixture.
    // This is test-only; no demo route or additional product entry point exists.
    const componentUrl = "/src/rocky-presence.tsx";
    const reactUrl = "/node_modules/.vite/deps/react.js";
    const domUrl = "/node_modules/.vite/deps/react-dom_client.js";
    const [{ RockyPresence }, { default: React }, { default: ReactDOM }] =
      await Promise.all([
        import(componentUrl),
        import(reactUrl),
        import(domUrl),
      ]);
    const host = document.createElement("div");
    host.id = "remount-fixture";
    host.style.cssText = "position:fixed;inset:0;z-index:9999;background:white";
    document.body.append(host);
    const work = {
      id: crypto.randomUUID(),
      runId: crypto.randomUUID(),
      executionSessionId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      kind: "main",
      runMode: "normal",
      status: "completed",
    };
    const completion = {
      id: crypto.randomUUID(),
      workId: work.id,
      receivedAt: Date.now(),
    };
    const props = {
      works: [work],
      events: [],
      connected: true,
      configured: true,
      locale: "zh",
      completion,
      onOpenWork: () => {},
    };
    let root = ReactDOM.createRoot(host);
    const render = () =>
      root.render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(RockyPresence, props),
        ),
      );
    (window as typeof window & { remountRoko: () => void }).remountRoko =
      () => {
        root.unmount();
        root = ReactDOM.createRoot(host);
        render();
      };
    render();
  });
  const sprite = page.locator("#remount-fixture canvas");
  await expect(sprite).toHaveAttribute("data-clip", "jumping");
  await page.evaluate(() =>
    (window as typeof window & { remountRoko: () => void }).remountRoko(),
  );
  await expect(sprite).toHaveAttribute("data-loaded", "true");
  await expect(sprite).toHaveAttribute("data-clip", "idle");
});
