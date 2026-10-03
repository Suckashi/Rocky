import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { redactEvidence } from "../apps/daemon/src/redaction.js";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { createApp } from "../apps/daemon/src/http.js";

test("T-008 nested structured/text evidence masks credentials without hiding usage counts", () => {
  const value = {
    headers: {
      Authorization: "Bearer synthetic-bearer",
      cookie: "synthetic-cookie",
    },
    nested: [{ api_key: "synthetic-key" }],
    text: "https://user:synthetic-password@company.invalid/x?access_token=synthetic-query",
    content: [
      {
        type: "text",
        text: JSON.stringify({
          password: "synthetic-json-secret",
          inputTokens: 7,
        }),
      },
    ],
    known: "echo synthetic-known-secret",
  };
  const result = JSON.stringify(
    redactEvidence(value, ["synthetic-known-secret"]),
  );
  for (const secret of [
    "synthetic-bearer",
    "synthetic-cookie",
    "synthetic-key",
    "synthetic-password",
    "synthetic-query",
    "synthetic-json-secret",
    "synthetic-known-secret",
  ])
    expect(result).not.toContain(secret);
  expect(result).toContain("inputTokens");
  expect(result).toContain("7");
  expect(redactEvidence(' { "regular": true } ')).toBe(' { "regular": true } ');
});

test("T-008 configured credential echoes are masked before event persistence and at HTTP projection; session remains usable", async () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-redaction-"));
  const previous = process.env.ROCKY_TEST_REDACT_KEY;
  process.env.ROCKY_TEST_REDACT_KEY = "synthetic-private-model-key";
  const service = new WorkService(root),
    app = createApp(service),
    headers = { host: "127.0.0.1:3211" };
  try {
    service.models.save({
      id: randomUUID(),
      requestId: randomUUID(),
      expectedRevision: 0,
      config: {
        name: "Test",
        provider: "openai-compatible",
        baseUrl: "http://127.0.0.1:1/v1",
        modelId: "fixture",
        credentialRef: "ROCKY_TEST_REDACT_KEY",
        maxOutputTokens: 128,
      },
    });
    const work = service.submit({
      requestId: randomUUID(),
      text: "echo synthetic-private-model-key",
      mode: "fixture",
      transport: "http",
    });
    const current = service.store.get(work.id);
    service.stop(work.id, {
      requestId: randomUUID(),
      runId: current.runId,
      executionSessionId: current.executionSessionId,
      expectedRevision: current.revision,
    });
    service.store.event(service.store.get(work.id), "rocky.audit.test", {
      authorization: "Bearer synthetic-secret",
      nested: { apiKey: "synthetic-secret" },
      message: "synthetic-private-model-key",
    });
    expect(
      JSON.stringify(service.store.db.prepare("SELECT data FROM events").all()),
    ).not.toContain("synthetic-private-model-key");
    for (const path of [
      "/api/v1/works",
      "/api/v1/works/" + work.id,
      "/api/v1/snapshot",
      "/api/v1/conversation/messages",
    ]) {
      const response = await app.request(path, { headers });
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).not.toContain("synthetic-private-model-key");
      expect(text).not.toContain("synthetic-secret");
    }
    expect(service.store.get(work.id).text).toContain(
      "synthetic-private-model-key",
    );
    const session = await (
      await app.request("/api/v1/session", { headers })
    ).json();
    expect(session.token).toMatch(/^[a-f0-9]{64}$/);
  } finally {
    await service.close();
    if (previous === undefined) delete process.env.ROCKY_TEST_REDACT_KEY;
    else process.env.ROCKY_TEST_REDACT_KEY = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
