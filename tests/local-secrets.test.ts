import { test, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { LocalSecrets } from "../apps/daemon/src/local-secrets.js";
import { createApp } from "../apps/daemon/src/http.js";
import { WorkService } from "../apps/daemon/src/work-service.js";

test("local secrets file stores names only in status and never overrides explicit env", () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-secrets-"));
  try {
    writeFileSync(join(root, "secrets.env"), "FROM_FILE=a\nEXPLICIT=file\n");
    const env: NodeJS.ProcessEnv = { EXPLICIT: "process" };
    const secrets = new LocalSecrets(root, env);
    expect(env.FROM_FILE).toBe("a");
    expect(env.EXPLICIT).toBe("process");
    expect(secrets.status()).toMatchObject({
      encrypted: false,
      names: ["EXPLICIT", "FROM_FILE"],
    });
    expect(JSON.stringify(secrets.status())).not.toContain("process");

    secrets.save({ requestId: randomUUID(), name: "NEW_KEY", value: "sk-x" });
    expect(env.NEW_KEY).toBe("sk-x");
    expect(readFileSync(join(root, "secrets.env"), "utf8")).toContain(
      "NEW_KEY=sk-x\n",
    );
    expect(() =>
      secrets.save({ requestId: randomUUID(), name: "BAD", value: "a\nB=c" }),
    ).toThrow();
    const blocked = new LocalSecrets(
      mkdtempSync(join(tmpdir(), "rocky-secrets-")),
      { PATH: "x" },
    );
    expect(() =>
      blocked.save({ requestId: randomUUID(), name: "PATH", value: "y" }),
    ).toThrow(/already set/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("local secrets API requires the local session and redacts values", async () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-http-secrets-"));
  const service = new WorkService(root),
    app = createApp(service);
  const headers: Record<string, string> = {
    host: "127.0.0.1:3211",
    "content-type": "application/json",
  };
  const name = `ROCKY_TEST_${randomUUID().replaceAll("-", "_")}`;
  const body = JSON.stringify({
    requestId: randomUUID(),
    name,
    value: "secret-value-123",
  });
  try {
    expect(
      (
        await app.request("/api/v1/local-secrets", {
          method: "POST",
          headers,
          body,
        })
      ).status,
    ).toBe(403);
    const { token } = await (
      await app.request("/api/v1/session", { headers })
    ).json();
    const saved = await app.request("/api/v1/local-secrets", {
      method: "POST",
      headers: { ...headers, "x-rocky-session": token },
      body,
    });
    expect(saved.status).toBe(200);
    const listed = await (
      await app.request("/api/v1/local-secrets", { headers })
    ).text();
    expect(listed).toContain(name);
    expect(listed).not.toContain("secret-value-123");
  } finally {
    delete process.env[name];
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});
