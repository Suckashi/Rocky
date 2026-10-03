import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../apps/daemon/src/store.js";
import { GrantRegistry } from "../apps/daemon/src/grants.js";
import { intentHash } from "../apps/daemon/src/intent.js";
import { workSchema } from "../packages/contracts/src/index.js";
import { WorkService } from "../apps/daemon/src/work-service.js";
test("T-008 durable grants are scoped, expire, revoke by CAS and cannot authorize critical effects", () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-grants-")),
    store = new Store(root);
  let closed = false,
    now = Date.now();
  const registry = new GrantRegistry(store, () => now);
  const work = workSchema.parse({
    id: randomUUID(),
    runId: randomUUID(),
    executionSessionId: randomUUID(),
    requestId: randomUUID(),
    text: "Grant fixture",
    transport: "http",
    mode: "fixture",
    runMode: "normal",
    status: "running",
    revision: 1,
    answer: "",
    createdAt: new Date().toISOString(),
  });
  store.add(work, "test");
  const targetHash = intentHash({ fixture: 1 }),
    command = {
      requestId: randomUUID(),
      workId: work.id,
      targetHash,
      effect: "known_read",
      policyRevision: 1,
      expiresAt: new Date(now + 1000).toISOString(),
    };
  try {
    expect(() => registry.issue({ ...command, effect: "critical" })).toThrow();
    const grant = registry.issue(command);
    expect(registry.issue(command)).toEqual(grant);
    expect(registry.allows(work, targetHash, "known_read", 1)).toBe(true);
    expect(
      registry.allows(
        { ...work, executionSessionId: randomUUID() },
        targetHash,
        "known_read",
        1,
      ),
    ).toBe(false);
    expect(
      registry.allows(work, intentHash({ fixture: 2 }), "known_read", 1),
    ).toBe(false);
    expect(registry.allows(work, targetHash, "local_new", 1)).toBe(false);
    expect(registry.allows(work, targetHash, "known_read", 2)).toBe(false);
    now += 1001;
    expect(registry.allows(work, targetHash, "known_read", 1)).toBe(false);
    now -= 1001;
    const revoked = registry.revoke(work.id, grant.id, {
      requestId: randomUUID(),
      expectedRevision: 1,
    });
    expect(registry.allows(work, targetHash, "known_read", 1)).toBe(false);
    expect(() =>
      registry.revoke(work.id, grant.id, {
        requestId: randomUUID(),
        expectedRevision: 1,
      }),
    ).toThrow("revision changed");
    expect(registry.issue(command)).toEqual(revoked);
    store.close();
    closed = true;
    const reopened = new Store(root);
    try {
      const restored = new GrantRegistry(reopened);
      expect(restored.list(work.id)).toEqual([revoked]);
      expect(restored.allows(work, targetHash, "known_read", 1)).toBe(false);
    } finally {
      reopened.close();
    }
  } finally {
    if (!closed) store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("T-008 revoking submitted synthetic read scope prevents actual MCP read; submission replay does not regrant", async () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-grant-work-")),
    service = new WorkService(root);
  try {
    const command = {
      requestId: randomUUID(),
      text: "Revoked read",
      transport: "http",
      mode: "fixture",
    };
    const work = service.submit(command),
      grant = service.grants.list(work.id)[0]!;
    service.grants.revoke(work.id, grant.id, {
      requestId: randomUUID(),
      expectedRevision: grant.revision,
    });
    expect(service.submit(command).id).toBe(work.id);
    expect(service.grants.list(work.id)).toHaveLength(1);
    await expect
      .poll(() => service.store.get(work.id).status, { timeout: 10000 })
      .toMatch(/waiting_approval|failed|completed|blocked/);
    expect(
      service.store.db
        .prepare("SELECT * FROM operations WHERE outcome='succeeded'")
        .all(),
    ).toHaveLength(0);
    expect(service.grants.list(work.id)[0]?.revoked).toBe(true);
    expect(
      service.store
        .eventsForWork(work.id)
        .filter(
          (e) =>
            e.payload.kind === "domain" &&
            e.payload.name === "rocky.operation.dispatched",
        ),
    ).toHaveLength(0);
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T-008 grant revoke API validates session and exact receipt, preserving idempotency after restart", async () => {
  const { createApp } = await import("../apps/daemon/src/http.js");
  const root = mkdtempSync(join(tmpdir(), "rocky-grant-api-"));
  let service = new WorkService(root);
  try {
    const work = service.submit({
        requestId: randomUUID(),
        text: "Grant API",
        mode: "fixture",
        transport: "http",
      }),
      grant = service.grants.list(work.id)[0]!;
    const app = createApp(service),
      path = `/api/v1/works/${work.id}/grants/${grant.id}/revoke`,
      command = { requestId: randomUUID(), expectedRevision: grant.revision };
    const headers: Record<string, string> = {
      host: "127.0.0.1:3211",
      "content-type": "application/json",
    };
    expect(
      (
        await app.request(path, {
          method: "POST",
          headers,
          body: JSON.stringify(command),
        })
      ).status,
    ).toBe(403);
    const session = await (
      await app.request("/api/v1/session", { headers })
    ).json();
    headers["x-rocky-session"] = session.token;
    expect(
      (
        await app.request(path, {
          method: "POST",
          headers,
          body: JSON.stringify({ ...command, approved: true }),
        })
      ).status,
    ).toBe(400);
    const response = await app.request(path, {
      method: "POST",
      headers,
      body: JSON.stringify(command),
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.revoked).toBe(true);
    const events = service.store
      .eventsForWork(work.id)
      .filter(
        (e) =>
          e.payload.kind === "domain" &&
          e.payload.name === "rocky.grant.revoked",
      ).length;
    expect(
      await (
        await app.request(path, {
          method: "POST",
          headers,
          body: JSON.stringify(command),
        })
      ).json(),
    ).toEqual(result);
    expect(
      service.store
        .eventsForWork(work.id)
        .filter(
          (e) =>
            e.payload.kind === "domain" &&
            e.payload.name === "rocky.grant.revoked",
        ),
    ).toHaveLength(events);
    await service.close();
    service = new WorkService(root);
    expect(service.grants.revoke(work.id, grant.id, command)).toEqual(result);
    expect(() =>
      service.grants.revoke(work.id, grant.id, {
        ...command,
        expectedRevision: 2,
      }),
    ).toThrow("request changed");
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});
