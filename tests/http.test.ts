import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../apps/daemon/src/http.js";
import { WorkService } from "../apps/daemon/src/work-service.js";
test("local API validates Host, Origin and session before mutation", async () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-http-")),
    service = new WorkService(root),
    app = createApp(service);
  try {
    expect(
      (
        await app.request("/api/v1/health", {
          headers: { host: "evil.example" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request("/api/v1/health", {
          headers: { host: "127.0.0.1:3211", origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request("/api/v1/conversation/messages", {
          method: "POST",
          headers: { host: "127.0.0.1:3211" },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    const r = await app.request("/api/v1/copilotkit/info", {
      headers: { host: "127.0.0.1:3211" },
    });
    expect((await r.json()).agents.rocky).toBeDefined();
    expect(service.store.list()).toHaveLength(0);
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});
