import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { createApp } from "../apps/daemon/src/http.js";
test("Learning policy defaults off and requires scoped owner consent with CAS and durable receipts", async () => {
  const root = await mkdtemp(join(tmpdir(), "rocky-learning-"));
  let service = new WorkService(root);
  try {
    expect(service.learning.policy()).toEqual({
      revision: 0,
      mode: "off",
      scopes: [],
      updatedAt: null,
    });
    const command = {
      requestId: randomUUID(),
      expectedRevision: 0,
      mode: "propose",
      scopes: [{ kind: "user" }],
      consent: true,
    };
    const app = createApp(service),
      headers = { host: "127.0.0.1:3211", "content-type": "application/json" };
    expect(
      (
        await app.request("/api/v1/learning/policy", {
          method: "POST",
          headers,
          body: JSON.stringify(command),
        })
      ).status,
    ).toBe(403);
    const session = await (
      await app.request("/api/v1/session", { headers })
    ).json();
    const response = await app.request("/api/v1/learning/policy", {
      method: "POST",
      headers: { ...headers, "x-rocky-session": session.token },
      body: JSON.stringify(command),
    });
    expect(response.status).toBe(200);
    const enabled = await response.json();
    expect(enabled).toMatchObject({ revision: 1, mode: "propose" });
    expect(() =>
      service.learning.savePolicy({ ...command, requestId: randomUUID() }),
    ).toThrow("revision changed");
    expect(() =>
      service.learning.savePolicy({ ...command, mode: "off", scopes: [] }),
    ).toThrow("request changed");
    const disabled = service.learning.savePolicy({
      requestId: randomUUID(),
      expectedRevision: 1,
      mode: "off",
      scopes: [],
    });
    expect(service.learning.savePolicy(command)).toEqual(enabled);
    expect(service.learning.policy()).toEqual(disabled);
    await service.close();
    service = new WorkService(root);
    expect(service.learning.policy()).toEqual(disabled);
    expect(service.learning.savePolicy(command)).toEqual(enabled);
    expect(service.learning.policy().mode).toBe("off");
    for (const patch of [
      { consent: undefined },
      { scopes: [] },
      { scopes: [{ kind: "user" }, { kind: "user" }] },
      { mode: "auto" },
      { scopes: [{ kind: "project", projectId: randomUUID() }] },
    ])
      expect(() =>
        service.learning.savePolicy({
          ...command,
          requestId: randomUUID(),
          expectedRevision: 2,
          ...patch,
        }),
      ).toThrow();
    expect(service.learning.policy()).toEqual(disabled);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
