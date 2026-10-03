import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../apps/daemon/src/http.js";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { randomUUID } from "node:crypto";
import { snapshotSchema } from "../packages/contracts/src/index.js";
test("T-007 model API requires local session, rejects raw keys and preserves unknown context", async () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-http-models-"));
  const service = new WorkService(root),
    app = createApp(service);
  const headers: Record<string, string> = {
    host: "127.0.0.1:3211",
    "content-type": "application/json",
  };
  const input = {
    requestId: randomUUID(),
    id: randomUUID(),
    expectedRevision: 0,
    config: {
      name: "API fixture",
      provider: "openai-compatible",
      baseUrl: "http://127.0.0.1:1/v1",
      modelId: "fixture",
      maxOutputTokens: 128,
    },
  };
  try {
    expect(
      (
        await app.request("/api/v1/model-connections", {
          method: "POST",
          headers,
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(403);
    const session = await (
      await app.request("/api/v1/session", { headers })
    ).json();
    headers["x-rocky-session"] = session.token;
    expect(
      (
        await app.request("/api/v1/model-connections", {
          method: "POST",
          headers,
          body: JSON.stringify({
            ...input,
            config: { ...input.config, apiKey: "synthetic-key-not-supported" },
          }),
        })
      ).status,
    ).toBe(400);
    const response = await app.request("/api/v1/model-connections", {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    expect(response.status).toBe(200);
    const dto = await response.json();
    expect(dto.config.contextWindowTokens).toBeNull();
    expect(dto.config.credentialRef).toBeUndefined();
    expect(
      (
        await app.request(`/api/v1/model-connections/${input.id}/probe`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            requestId: randomUUID(),
            expectedRevision: 2,
          }),
        })
      ).status,
    ).toBe(409);
    const capabilities = await (
      await app.request("/api/v1/capabilities", { headers })
    ).json();
    expect(capabilities.model).toEqual({
      configured: true,
      verified: false,
      runtimeAvailable: false,
      connectionProbing: true,
    });
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});
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

test("snapshot and SSE use persisted cursors; reconnect header wins over the initial query", async () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-sse-")),
    service = new WorkService(root),
    app = createApp(service);
  const headers = { host: "127.0.0.1:3211" };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const work = {
      id: randomUUID(),
      runId: randomUUID(),
      executionSessionId: randomUUID(),
      requestId: randomUUID(),
      text: "SSE fixture",
      mode: "fixture" as const,
      transport: "http" as const,
      runMode: "normal" as const,
      status: "queued" as const,
      revision: 1,
      answer: "",
      createdAt: new Date().toISOString(),
    };
    service.store.add(work, "synthetic");
    service.store.event(work, "rocky.work.updated", { work });
    const snapshot = snapshotSchema.parse(
      await (await app.request("/api/v1/snapshot", { headers })).json(),
    );
    const last = service.store.event(work, "rocky.tool.completed", {
      name: "synthetic",
    });
    const response = await app.request("/api/v1/events?after=0", {
      headers: { ...headers, "last-event-id": snapshot.cursor },
    });
    reader = response.body!.getReader();
    let text = "";
    while (!text.includes("data:")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += new TextDecoder().decode(chunk.value);
    }
    expect(text).toContain('"sequence":"' + last.sequence + '"');
    expect(text).not.toContain('"sequence":"' + snapshot.cursor + '"');
    await reader.cancel();
    reader = undefined;
    expect(
      (await app.request("/api/v1/events?after=NaN", { headers })).status,
    ).toBe(400);
    expect(
      (await app.request("/api/v1/snapshot?after=-1", { headers })).status,
    ).toBe(400);
  } finally {
    await reader?.cancel();
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("API bounds real body bytes and returns safe JSON errors before creating work", async () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-body-"));
  const service = new WorkService(root),
    app = createApp(service);
  try {
    const session = await app.request("/api/v1/session", {
      headers: { host: "127.0.0.1:3211" },
    });
    expect(session.headers.get("cache-control")).toBe("no-store");
    const { token } = await session.json();
    const headers = {
      host: "127.0.0.1:3211",
      "x-rocky-session": token,
      "content-type": "application/json",
    };
    for (const path of [
      "/api/v1/conversation/messages",
      "/api/v1/copilotkit/agent/rocky/run",
      "/api/v1/works/any/stop",
    ]) {
      const invalid = await app.request(path, {
        method: "POST",
        headers,
        body: '{"secret":"private fixture",',
      });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({
        code: "invalid_json",
        message: "Request body must be valid JSON",
      });
    }
    let cancelled = false;
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(32769));
      },
      cancel() {
        cancelled = true;
      },
    });
    const raw = new Request(
      "http://127.0.0.1:3211/api/v1/conversation/messages",
      { method: "POST", headers, body: stream, duplex: "half" } as RequestInit,
    );
    const oversized = await app.request(raw);
    expect(oversized.status).toBe(413);
    expect((await oversized.json()).code).toBe("too_large");
    expect(cancelled).toBe(true);
    const extra = await app.request("/api/v1/conversation/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({ secret: "private fixture" }),
    });
    expect(extra.status).toBe(400);
    expect(await extra.text()).not.toContain("private fixture");
    expect(service.store.list()).toHaveLength(0);
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});
