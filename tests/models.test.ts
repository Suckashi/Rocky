import { test, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../apps/daemon/src/store.js";
import { ModelRegistry } from "../apps/daemon/src/model-registry.js";
import {
  modelConfigSchema,
  endpointSchema,
} from "../packages/contracts/src/models.js";
import {
  bypassProxy,
  resolveProxy,
} from "../packages/agent-runtime/src/model-network.js";
import { startProbeFixture } from "../fixtures/models/probe-server.js";

function setup(env: NodeJS.ProcessEnv = {}) {
  const root = mkdtempSync(join(tmpdir(), "rocky-models-"));
  const store = new Store(root),
    models = new ModelRegistry(store, env);
  return {
    root,
    store,
    models,
    close: async () => {
      await models.close();
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
const config = (baseUrl = "http://127.0.0.1:1/v1") =>
  modelConfigSchema.parse({
    name: "Synthetic model",
    provider: "openai-compatible",
    modelId: "probe-fixture",
    baseUrl,
    maxOutputTokens: 128,
  });
const save = (baseUrl?: string) => ({
  requestId: randomUUID(),
  id: randomUUID(),
  expectedRevision: 0,
  config: config(baseUrl),
});

test("T-007 R-022: explicit URL/context/ref validation never invents defaults or accepts raw keys", () => {
  expect(config().contextWindowTokens).toBeNull();
  expect(config().credentialRef).toBeNull();
  expect(endpointSchema.parse("HTTP://LOCALHOST:80/v1/")).toBe(
    "http://localhost/v1",
  );
  for (const url of [
    "https://user:secret@company.invalid/v1",
    "file:///x",
    "https://company.invalid/v1?key=secret",
    "https://company.invalid/#x",
  ])
    expect(endpointSchema.safeParse(url).success).toBe(false);
  expect(
    modelConfigSchema.safeParse({ ...config(), apiKey: "synthetic" }).success,
  ).toBe(false);
  expect(
    modelConfigSchema.safeParse({
      ...config(),
      credentialRef: "sk-synthetic-secret",
    }).success,
  ).toBe(false);
  expect(
    modelConfigSchema.safeParse({ ...config(), contextWindowTokens: 100 })
      .success,
  ).toBe(false);
});

test("T-007 AT-22: registry CAS/idempotency, ref redaction, replacement and restart persistence", async () => {
  const ctx = setup({ ROCKY_SYNTHETIC_KEY: "synthetic-only-value" });
  const command = {
    ...save(),
    config: { ...config(), credentialRef: "ROCKY_SYNTHETIC_KEY" },
  };
  try {
    const first = ctx.models.save(command);
    expect(first.credential).toEqual({ configured: true, available: true });
    expect(JSON.stringify(first)).not.toContain("ROCKY_SYNTHETIC_KEY");
    expect(ctx.models.save(command)).toEqual(first);
    expect(() =>
      ctx.models.save({
        ...command,
        config: { ...command.config, name: "changed" },
      }),
    ).toThrow("different settings");
    expect(() =>
      ctx.models.save({ ...command, requestId: randomUUID() }),
    ).toThrow("changed");
    ctx.models.save({
      ...command,
      requestId: randomUUID(),
      expectedRevision: 1,
      config: config("http://127.0.0.1:2/v1"),
    });
    expect(ctx.models.list()[0]?.credential.configured).toBe(false);
    expect(
      JSON.stringify(
        ctx.store.db.prepare("SELECT data FROM model_connections").all(),
      ),
    ).not.toContain("synthetic-only-value");
    await ctx.models.close();
    ctx.store.close();
    const reopened = new Store(ctx.root);
    const models = new ModelRegistry(reopened);
    expect(models.list()[0]?.revision).toBe(2);
    await models.close();
    reopened.close();
  } finally {
    await ctx.close();
  }
});

for (const provider of [
  "openai-compatible",
  "anthropic",
  "openai",
  "ollama-compatible",
] as const)
  test(`T-007 AT-03: ${provider} text/tool roundtrip/stream/cancel use only configured local endpoint`, async () => {
    const fixture = await startProbeFixture();
    const ctx = setup({ ROCKY_SYNTHETIC_KEY: "fixture-secret" });
    try {
      const command = save(fixture.baseUrl);
      command.config.provider = provider;
      command.config.credentialRef = "ROCKY_SYNTHETIC_KEY";
      ctx.models.save(command);
      const input = { requestId: randomUUID(), expectedRevision: 1 };
      const result = await ctx.models.probe(command.id, input);
      expect(result.checks).toEqual({
        text: "passed",
        tools: "passed",
        stream: "passed",
        cancellation: "passed",
      });
      expect(result.requests).toBe(5);
      expect(fixture.requests).toHaveLength(5);
      expect(
        fixture.requests.every(
          (r) =>
            r.authorization ===
            (provider === "anthropic"
              ? "fixture-secret"
              : "Bearer fixture-secret"),
        ),
      ).toBe(true);
      expect(fixture.requests[2]?.body.messages).toHaveLength(3);
      await expect.poll(() => fixture.cancelled).toBe(1);
      expect(await ctx.models.probe(command.id, input)).toEqual(result);
      expect(fixture.requests).toHaveLength(5);
      expect(JSON.stringify(ctx.models.list())).not.toContain("fixture-secret");
      await expect(
        ctx.models.probe(command.id, {
          requestId: randomUUID(),
          expectedRevision: 2,
        }),
      ).rejects.toThrow("changed");
      ctx.models.save({
        ...command,
        requestId: randomUUID(),
        expectedRevision: 1,
      });
      expect(ctx.models.list()[0]?.probe).toBeNull();
    } finally {
      await ctx.close();
      await fixture.close();
    }
  });

test("T-007 AT-23: redirects never reach an unconfigured destination; invalid replies are redacted", async () => {
  const target = await startProbeFixture(),
    redirect = await startProbeFixture({
      redirect: target.baseUrl + "/chat/completions",
    }),
    invalid = await startProbeFixture({ invalid: true });
  const ctx = setup();
  try {
    for (const fixture of [redirect, invalid]) {
      const command = save(fixture.baseUrl);
      ctx.models.save(command);
      const result = await ctx.models.probe(command.id, {
        requestId: randomUUID(),
        expectedRevision: 1,
      });
      expect(result.status).toBe("failed");
      expect(result.requests).toBe(1);
      expect(result.error).toBe(
        fixture === redirect ? "redirect_denied" : "invalid_probe_response",
      );
      expect(JSON.stringify(result)).not.toContain(
        "synthetic-private-response",
      );
    }
    expect(target.requests).toHaveLength(0);
  } finally {
    await ctx.close();
    await Promise.all([target.close(), redirect.close(), invalid.close()]);
  }
});

test("T-007 AT-22: changing a connection cancels its outstanding probe and restart never replays it", async () => {
  const fixture = await startProbeFixture({ hold: true }),
    ctx = setup();
  try {
    const command = save(fixture.baseUrl);
    ctx.models.save(command);
    const input = { requestId: randomUUID(), expectedRevision: 1 };
    const pending = ctx.models.probe(command.id, input);
    await expect.poll(() => fixture.requests.length).toBe(1);
    ctx.models.save({
      ...command,
      requestId: randomUUID(),
      expectedRevision: 1,
    });
    expect((await pending).error).toBe("probe_cancelled");
    expect(ctx.models.list()[0]?.probe).toBeNull();
    ctx.store.db
      .prepare(
        "UPDATE model_probes SET data=json_set(data,'$.status','running')",
      )
      .run();
    const recovered = new ModelRegistry(ctx.store);
    expect((await recovered.probe(command.id, input)).status).toBe(
      "interrupted",
    );
    expect(fixture.requests).toHaveLength(1);
    await recovered.close();
  } finally {
    await ctx.close();
    await fixture.close();
  }
});

test("T-007 AT-24: explicit/environment/direct proxy precedence and NO_PROXY host/port/IPv6 patterns", () => {
  expect(
    resolveProxy(config(), { HTTP_PROXY: "http://proxy.invalid:8080" }),
  ).toBeUndefined();
  const c = { ...config(), proxy: { mode: "environment" as const } };
  expect(
    resolveProxy(c, {
      HTTP_PROXY: "http://proxy.invalid:8080",
      http_proxy: "",
    }),
  ).toBeUndefined();
  expect(resolveProxy(c, { HTTP_PROXY: "http://proxy.invalid:8080" })).toBe(
    "http://proxy.invalid:8080",
  );
  expect(
    resolveProxy(c, {
      HTTP_PROXY: "http://proxy.invalid",
      NO_PROXY: "127.0.0.1",
    }),
  ).toBeUndefined();
  expect(
    resolveProxy(
      { ...c, baseUrl: "https://models.company.invalid/v1" },
      {
        HTTPS_PROXY: "http://secure-proxy.invalid",
        HTTP_PROXY: "http://wrong.invalid",
      },
    ),
  ).toBe("http://secure-proxy.invalid");
  for (const pattern of [
    "company.invalid",
    ".company.invalid",
    "*.company.invalid",
    "*",
    "models.company.invalid:443",
  ])
    expect(
      bypassProxy(new URL("https://models.company.invalid"), pattern),
    ).toBe(true);
  expect(
    bypassProxy(new URL("https://notcompany.invalid"), "company.invalid"),
  ).toBe(false);
  expect(bypassProxy(new URL("http://[::1]:123"), "[::1]:123")).toBe(true);
  expect(bypassProxy(new URL("http://[::1]:123"), "[::1]:456")).toBe(false);
});
