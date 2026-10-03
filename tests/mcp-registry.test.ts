import { test, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../apps/daemon/src/store.js";
import { McpRegistry } from "../apps/daemon/src/mcp-registry.js";
import {
  mcpConfigSchema,
  emptyMcpConfig,
} from "../packages/contracts/src/mcp-config.js";
import { createApp } from "../apps/daemon/src/http.js";
import { WorkService } from "../apps/daemon/src/work-service.js";
const config = () => ({
  mcpServers: {
    local: {
      command: "node",
      args: ["./tools/server.js"],
      env: { LOG_LEVEL: "warn" },
      enabled: true,
    },
    remote: { url: "http://127.0.0.1:54321/mcp", enabled: false },
  },
  "x-rocky": {
    version: 1,
    servers: {
      local: {
        transport: "stdio",
        envAllowlist: ["PATH"],
        envRefs: { API_TOKEN: "ROCKY_TEST_MCP_TOKEN" },
      },
      remote: {
        transport: "streamable-http",
        networkPolicyId: "explicit-company",
        bearerTokenEnvVar: "ROCKY_TEST_MCP_TOKEN",
      },
    },
  },
});
test("Rocky MCP schema rejects foreign/mixed config and plaintext credentials; defaults disabled", () => {
  const parsed = mcpConfigSchema.parse(config());
  expect(parsed["x-rocky"].servers.local?.startupTimeoutMs).toBe(30000);
  expect(() =>
    mcpConfigSchema.parse({ ...config(), "x-apsis": { version: 1 } }),
  ).toThrow();
  const mixed = config();
  Object.assign(mixed.mcpServers.local, { url: "http://localhost/mcp" });
  expect(() => mcpConfigSchema.parse(mixed)).toThrow();
  const wrong = config();
  wrong["x-rocky"].servers.local.transport = "streamable-http";
  expect(() => mcpConfigSchema.parse(wrong)).toThrow();
  const secret = config();
  Object.assign(secret.mcpServers.local.env, { API_KEY: "plaintext" });
  expect(() => mcpConfigSchema.parse(secret)).toThrow("reference");
  const args = config();
  args.mcpServers.local.args = ["--token=plaintext"];
  expect(() => mcpConfigSchema.parse(args)).toThrow("reference");
  const defaults = mcpConfigSchema.parse({
    mcpServers: { local: { command: "node" } },
    "x-rocky": { version: 1, servers: { local: { transport: "stdio" } } },
  });
  expect(defaults.mcpServers.local?.enabled).toBe(false);
});
test("MCP settings use atomic CAS and persistent receipts, isolated launch env/path and retired-secret redaction", () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-mcp-registry-"));
  let store = new Store(root);
  try {
    let registry = new McpRegistry(store, {
      PATH: "approved-path",
      HOME: "unapproved-home",
      UNRELATED_SECRET: "private",
      ROCKY_TEST_MCP_TOKEN: "synthetic-mcp-credential",
    });
    expect(registry.snapshot().config).toEqual(emptyMcpConfig());
    const input = {
        requestId: randomUUID(),
        expectedRevision: 0,
        config: config(),
      },
      saved = registry.save(input);
    expect(saved.revision).toBe(1);
    expect(registry.save(input)).toEqual(saved);
    expect(() => registry.save({ ...input, expectedRevision: 1 })).toThrow(
      "changed",
    );
    expect(() => registry.save({ ...input, requestId: randomUUID() })).toThrow(
      "reload",
    );
    const launch = registry.launchSpec("local", 1);
    expect(launch.transport).toBe("stdio");
    if (launch.transport === "stdio") {
      expect(launch.env).toEqual({
        PATH: "approved-path",
        LOG_LEVEL: "warn",
        API_TOKEN: "synthetic-mcp-credential",
      });
      expect(launch.cwd).toBe(join(root, "connections", "mcp"));
      expect(launch.args).toEqual(["./tools/server.js"]);
    }
    expect(() => registry.launchSpec("remote", 1)).toThrow("disabled");
    expect(() => registry.launchSpec("local", 0)).toThrow("changed");
    expect(() => new McpRegistry(store, {}).launchSpec("local", 1)).toThrow(
      "unavailable",
    );
    const bad = config();
    bad.mcpServers.local.args = ["synthetic-mcp-credential"];
    expect(() =>
      registry.save({
        requestId: randomUUID(),
        expectedRevision: 1,
        config: bad,
      }),
    ).toThrow("plaintext");
    expect(registry.snapshot()).toEqual(saved);
    const originalRun = store.db.prepare.bind(store.db);
    store.db.prepare = ((sql: string) => {
      if (sql.startsWith("INSERT INTO mcp_config_receipts"))
        throw Error("injected receipt failure");
      return originalRun(sql);
    }) as typeof store.db.prepare;
    expect(() =>
      registry.save({
        requestId: randomUUID(),
        expectedRevision: 1,
        config: emptyMcpConfig(),
      }),
    ).toThrow("injected");
    store.db.prepare = originalRun;
    expect(registry.snapshot()).toEqual(saved);
    registry.save({
      requestId: randomUUID(),
      expectedRevision: 1,
      config: emptyMcpConfig(),
    });
    expect(registry.redact("synthetic-mcp-credential")).toBe("[REDACTED]");
    expect(registry.redactDiagnosticTail("logged synthetic-mcp-")).toBe("logged [REDACTED]");
    store.close();
    store = new Store(root);
    registry = new McpRegistry(store);
    expect(registry.save(input)).toEqual(saved);
    expect(registry.snapshot().revision).toBe(2);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("MCP API requires owner session; config references remain references and failed input preserves stored settings", async () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-http-mcp-")),
    service = new WorkService(root),
    app = createApp(service),
    headers: Record<string, string> = {
      host: "127.0.0.1:3211",
      "content-type": "application/json",
    };
  try {
    const input = {
      requestId: randomUUID(),
      expectedRevision: 0,
      config: config(),
    };
    expect(
      (
        await app.request("/api/v1/mcp-config", {
          method: "POST",
          headers,
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(403);
    headers["x-rocky-session"] = (
      await (await app.request("/api/v1/session", { headers })).json()
    ).token;
    const response = await app.request("/api/v1/mcp-config", {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    expect(response.status).toBe(200);
    expect(
      mcpConfigSchema.parse((await response.json()).config)["x-rocky"].servers
        .local,
    ).toMatchObject({ envRefs: { API_TOKEN: "ROCKY_TEST_MCP_TOKEN" } });
    const failed = await app.request("/api/v1/mcp-config", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...input,
        requestId: randomUUID(),
        config: { ...config(), "x-apsis": {} },
      }),
    });
    expect(failed.status).toBe(400);
    expect(
      (await (await app.request("/api/v1/mcp-config", { headers })).json())
        .revision,
    ).toBe(1);
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});
