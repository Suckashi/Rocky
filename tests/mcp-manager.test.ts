import { test, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../apps/daemon/src/store.js";
import { McpRegistry } from "../apps/daemon/src/mcp-registry.js";
import { McpManager } from "../apps/daemon/src/mcp-manager.js";
import { startHttpFixture } from "../fixtures/mcp/server.js";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
const command = (revision = 1) => ({
  requestId: randomUUID(),
  expectedRevision: revision,
});
test("Stop during native startup/discovery cancels only the owned process and old request does not restart it", async () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-mcp-cancel-")),
    store = new Store(root),
    registry = new McpRegistry(store),
    manager = new McpManager(store, registry);
  try {
    registry.save({
      requestId: randomUUID(),
      expectedRevision: 0,
      config: {
        mcpServers: {
          tools: {
            command: process.execPath,
            args: [
              "--import",
              "tsx",
              resolve("fixtures/mcp/lifecycle-server.ts"),
              "wait",
            ],
            cwd: process.cwd(),
            enabled: true,
          },
        },
        "x-rocky": {
          version: 1,
          servers: { tools: { transport: "stdio", startupTimeoutMs: 15000 } },
        },
      },
    });
    const input = command(),
      pending = manager.connect("tools", input);
    await expect
      .poll(() => manager.list()[0]?.pid, { timeout: 5000 })
      .toBeGreaterThan(0);
    const pid = manager.list()[0]!.pid!;
    await manager.stop("tools", command());
    await pending;
    expect(manager.list()[0]?.status).toBe("configured");
    await expect
      .poll(
        () => {
          try {
            process.kill(pid, 0);
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 5000 },
      )
      .toBe(false);
    expect((await manager.connect("tools", input))?.status).toBe("configured");
  } finally {
    await manager.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("configured HTTP redirect cannot forward credentials or initialize an unconfigured endpoint", async () => {
  let reached = 0;
  const target = createServer((_req, res) => {
    reached++;
    res.writeHead(200).end();
  });
  await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
  const redirect = createServer((_req, res) =>
    res
      .writeHead(302, {
        Location: `http://127.0.0.1:${(target.address() as AddressInfo).port}/other`,
      })
      .end(),
  );
  await new Promise<void>((resolve) =>
    redirect.listen(0, "127.0.0.1", resolve),
  );
  const root = mkdtempSync(join(tmpdir(), "rocky-mcp-redirect-")),
    store = new Store(root),
    registry = new McpRegistry(store, {
      ...process.env,
      ROCKY_REDIRECT_TEST_TOKEN: "synthetic-redirect-token",
    }),
    manager = new McpManager(store, registry);
  try {
    registry.save({
      requestId: randomUUID(),
      expectedRevision: 0,
      config: {
        mcpServers: {
          tools: {
            url: `http://127.0.0.1:${(redirect.address() as AddressInfo).port}/mcp`,
            enabled: true,
          },
        },
        "x-rocky": {
          version: 1,
          servers: {
            tools: {
              transport: "streamable-http",
              networkPolicyId: "configured-redirect-fixture",
              bearerTokenEnvVar: "ROCKY_REDIRECT_TEST_TOKEN",
            },
          },
        },
      },
    });
    expect((await manager.connect("tools", command()))?.status).toBe("failed");
    expect(reached).toBe(0);
  } finally {
    await manager.close();
    store.close();
    redirect.closeAllConnections();
    target.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => redirect.close(() => resolve())),
      new Promise<void>((resolve) => target.close(() => resolve())),
    ]);
    rmSync(root, { recursive: true, force: true });
  }
});
test.each(["pages", "repeat", "diagnostics", "overflow"])(
  "bounded actual stdio discovery/diagnostics: %s",
  async (mode) => {
    const root = mkdtempSync(join(tmpdir(), "rocky-mcp-pages-")),
      store = new Store(root),
      registry = new McpRegistry(store, {
        ...process.env,
        ROCKY_TEST_SERVER_TOKEN: "synthetic-split-credential",
      }),
      manager = new McpManager(store, registry);
    try {
      registry.save({
        requestId: randomUUID(),
        expectedRevision: 0,
        config: {
          mcpServers: {
            tools: {
              command: process.execPath,
              args: [
                "--import",
                "tsx",
                resolve("fixtures/mcp/lifecycle-server.ts"),
                mode,
              ],
              cwd: process.cwd(),
              enabled: true,
            },
          },
          "x-rocky": {
            version: 1,
            servers: {
              tools: {
                transport: "stdio",
                envRefs: { SERVER_TOKEN: "ROCKY_TEST_SERVER_TOKEN" },
                startupTimeoutMs: 3000,
              },
            },
          },
        },
      });
      const result = await manager.connect("tools", command());
      if (mode === "repeat" || mode === "overflow") {
        expect(result?.status).toBe("failed");
        expect(result?.toolsCount).toBe(0);
        expect(result?.error).toContain(
          mode === "repeat" ? "cursor repeated" : "stderr limit",
        );
      } else {
        expect(result?.status, JSON.stringify(result)).toBe("ready");
        expect(result?.toolsCount).toBe(2);
        expect(
          manager.catalog("tools", result!.registryRevision).map((t) => t.name),
        ).toEqual(["first_tool", "second_tool"]);
      }
      await manager.stop("tools", command());
      if (mode === "diagnostics") {
        const diagnostics = manager.list()[0]!.diagnostics.join("");
        expect(diagnostics).toContain("[REDACTED]");
        expect(diagnostics).not.toContain("synthetic-split-credential");
        expect(diagnostics).toContain('"profile":""');
        expect(diagnostics).toContain('"unrelated":""');
      }
    } finally {
      await manager.close();
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
test.each(["stdio", "http"] as const)(
  "configured official MCP lifecycle lists actual tools and stops without replay: %s",
  async (kind) => {
    const root = mkdtempSync(join(tmpdir(), "rocky-mcp-manager-")),
      store = new Store(root),
      registry = new McpRegistry(store),
      manager = new McpManager(store, registry),
      http = kind === "http" ? await startHttpFixture() : undefined;
    try {
      registry.save({
        requestId: randomUUID(),
        expectedRevision: 0,
        config: {
          mcpServers: {
            tools:
              kind === "stdio"
                ? {
                    command: process.execPath,
                    args: [
                      "--import",
                      "tsx",
                      resolve("fixtures/mcp/server.ts"),
                    ],
                    cwd: process.cwd(),
                    enabled: true,
                  }
                : { url: http!.url.href, enabled: true },
          },
          "x-rocky": {
            version: 1,
            servers: {
              tools:
                kind === "stdio"
                  ? { transport: "stdio" }
                  : {
                      transport: "streamable-http",
                      networkPolicyId: "explicit-loopback-fixture",
                    },
            },
          },
        },
      });
      expect(manager.list()[0]?.status).toBe("configured");
      const input = command();
      const ready = await manager.connect("tools", input);
      expect(ready?.status, ready?.error ?? "").toBe("ready");
      expect(ready?.toolsCount).toBe(2);
      expect(
        manager.catalog("tools", ready!.registryRevision).map((t) => t.name),
      ).toEqual(["inspect_sample", "write_sample"]);
      const pid = ready?.pid;
      if (kind === "stdio") expect(pid).toBeGreaterThan(0);
      expect((await manager.connect("tools", input))?.registryRevision).toBe(
        ready?.registryRevision,
      );
      await expect(
        manager.connect("tools", { ...input, expectedRevision: 2 }),
      ).rejects.toThrow("changed");
      await manager.stop("tools", command());
      expect(manager.list()[0]?.status).toBe("configured");
      expect(() => manager.catalog("tools", ready!.registryRevision)).toThrow(
        "not ready",
      );
      if (pid)
        await expect
          .poll(
            () => {
              try {
                process.kill(pid, 0);
                return true;
              } catch {
                return false;
              }
            },
            { timeout: 5000 },
          )
          .toBe(false);
      // The old connect receipt never starts a new process after Stop.
      expect((await manager.connect("tools", input))?.status).toBe(
        "configured",
      );
      const next = await manager.connect("tools", command());
      expect(next?.registryRevision).toBe(ready!.registryRevision + 1);
      registry.save({
        requestId: randomUUID(),
        expectedRevision: 1,
        config: { mcpServers: {}, "x-rocky": { version: 1, servers: {} } },
      });
      expect(() => manager.catalog("tools", next!.registryRevision)).toThrow();
      await manager.close();
      expect(manager.list()).toEqual([]);
    } finally {
      await manager.close();
      store.close();
      await http?.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
test("failed configured stdio startup is bounded, reported and not retried by old receipt", async () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-mcp-failure-")),
    store = new Store(root),
    registry = new McpRegistry(store),
    manager = new McpManager(store, registry);
  try {
    registry.save({
      requestId: randomUUID(),
      expectedRevision: 0,
      config: {
        mcpServers: {
          broken: {
            command: process.execPath,
            args: ["-e", "process.stdout.write('not protocol\\n')"],
            enabled: true,
          },
        },
        "x-rocky": {
          version: 1,
          servers: { broken: { transport: "stdio", startupTimeoutMs: 500 } },
        },
      },
    });
    const input = command(),
      failed = await manager.connect("broken", input);
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toBeTruthy();
    expect(failed?.pid).toBeNull();
    expect((await manager.connect("broken", input))?.status).toBe("failed");
  } finally {
    await manager.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
