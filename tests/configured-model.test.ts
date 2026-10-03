import { test, expect } from "vitest";
import { MemorySaver, Command } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../apps/daemon/src/store.js";
import { ModelBudgetLedger } from "../apps/daemon/src/model-budget.js";
import {
  ConfiguredModel,
  providerUsage,
} from "../packages/agent-runtime/src/configured-model.js";
import { modelConfigSchema } from "../packages/contracts/src/models.js";
import { createRockyAgent } from "../packages/agent-runtime/src/factory.js";
import { startAgentProvider } from "../fixtures/models/agent-provider.js";
import { ModelRegistry } from "../apps/daemon/src/model-registry.js";

test("T-007 editing configuration aborts in-flight model I/O without retry or leaked credentials", async () => {
  const server = await startAgentProvider({ hold: true }),
    root = mkdtempSync(join(tmpdir(), "rocky-lease-abort-")),
    store = new Store(root),
    registry = new ModelRegistry(store, {
      ROCKY_TEST_MODEL_KEY: "synthetic-private-key",
    });
  let reserved = 0,
    settled = 0;
  try {
    const id = randomUUID(),
      config = modelConfigSchema.parse({
        name: "abort fixture",
        provider: "openai-compatible",
        baseUrl: server.baseUrl,
        modelId: "scripted",
        maxOutputTokens: 128,
        contextWindowTokens: 4096,
        credentialRef: "ROCKY_TEST_MODEL_KEY",
      });
    registry.save({ id, requestId: randomUUID(), expectedRevision: 0, config });
    const lease = registry.acquireModel(
      id,
      1,
      {
        reserve: () => {
          reserved++;
        },
        settle: () => {
          settled++;
        },
      },
      new AbortController().signal,
    );
    expect(JSON.stringify(lease.model)).not.toContain("synthetic-private-key");
    const pending = lease.model
      .invoke([new HumanMessage("synthetic request")])
      .then(
        () => "unexpected_success",
        () => "cancelled",
      );
    await expect.poll(() => server.requests.length).toBe(1);
    registry.save({ id, requestId: randomUUID(), expectedRevision: 1, config });
    expect(await pending).toBe("cancelled");
    expect(reserved).toBe(1);
    expect(settled).toBe(0);
    expect(server.requests).toHaveLength(1);
    await lease.release();
  } finally {
    await registry.close();
    await server.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T-007 registry model leases pin revision, require context, revoke on edits, and enforce bounds before dispatch", async () => {
  const server = await startAgentProvider(),
    root = mkdtempSync(join(tmpdir(), "rocky-model-lease-")),
    store = new Store(root),
    registry = new ModelRegistry(store, {});
  const id = randomUUID();
  const config = modelConfigSchema.parse({
    name: "lease fixture",
    provider: "openai-compatible",
    baseUrl: server.baseUrl,
    modelId: "scripted",
    maxOutputTokens: 128,
  });
  const accounting = { reserve: () => {}, settle: () => {} };
  const controller = new AbortController();
  try {
    registry.save({ id, requestId: randomUUID(), expectedRevision: 0, config });
    expect(() =>
      registry.acquireModel(id, 1, accounting, controller.signal),
    ).toThrow("context window");
    registry.save({
      id,
      requestId: randomUUID(),
      expectedRevision: 1,
      config: { ...config, contextWindowTokens: 256 },
    });
    const lease = registry.acquireModel(
      id,
      2,
      { ...accounting, inputTokenBound: () => 200 },
      controller.signal,
    );
    expect(lease.model.profile.maxInputTokens).toBe(128);
    await expect(
      lease.model.invoke([new HumanMessage("too large")]),
    ).rejects.toThrow("context window");
    expect(server.requests).toHaveLength(0);
    registry.save({
      id,
      requestId: randomUUID(),
      expectedRevision: 2,
      config: { ...config, contextWindowTokens: 4096 },
    });
    await expect(
      lease.model.invoke([new HumanMessage("revoked")]),
    ).rejects.toThrow();
    expect(server.requests).toHaveLength(0);
    await lease.release();
    await lease.release();
    await expect(
      lease.model.invoke([new HumanMessage("closed")]),
    ).rejects.toThrow("closed");
  } finally {
    await registry.close();
    await server.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

for (const provider of ["openai-compatible", "anthropic"] as const)
  test(`T-007 configured ${provider} → native child/interrupt/resume shares root usage ledger`, async () => {
    const server = await startAgentProvider(),
      root = mkdtempSync(join(tmpdir(), "rocky-configured-")),
      store = new Store(root),
      ledger = new ModelBudgetLedger(store),
      runId = randomUUID();
    const config = modelConfigSchema.parse({
      name: "agent protocol fixture",
      provider,
      baseUrl: server.baseUrl,
      modelId: "scripted",
      contextWindowTokens: 4096,
      maxOutputTokens: 128,
    });
    ledger.open(runId, { maxCalls: 12 });
    const abort = new AbortController();
    function model(purpose: "target" | "subagent") {
      return new ConfiguredModel(
        config,
        {
          reserve: (requestId, inputTokenBound, outputTokenBound) => {
            ledger.reserve(runId, {
              requestId,
              purpose,
              inputTokenBound,
              outputTokenBound,
            });
          },
          settle: (id, usage) => {
            ledger.settle(runId, id, usage);
          },
        },
        abort.signal,
        {},
      );
    }
    const primary = model("target"),
      child = model("subagent");
    let writes = 0;
    const events: string[] = [];
    const agent = createRockyAgent(
      new MemorySaver(),
      {
        event: (name) => events.push(name),
        call: async (name) => {
          if (name === "write_sample") writes++;
          return JSON.stringify({
            checked: true,
            written: name === "write_sample",
          });
        },
      },
      { root: primary, child },
    );
    const invocation = { configurable: { thread_id: runId } };
    try {
      const waiting = await agent.invoke(
        { messages: [new HumanMessage("Inspect then write synthetic data")] },
        invocation,
      );
      expect(waiting.__interrupt__).toHaveLength(1);
      expect(writes).toBe(0);
      expect(events).toContain("rocky.subagent.completed");
      const result = await agent.invoke(
        new Command({ resume: { decisions: [{ type: "approve" }] } }),
        invocation,
      );
      expect(writes).toBe(1);
      expect(String(result.messages.at(-1)?.content)).toContain("核准後寫入");
      const usage = ledger.snapshot(runId);
      expect(usage.calls).toBe(server.requests.length);
      expect(usage.unknownUsageCalls).toBe(0);
      expect(usage.knownUsage).toEqual({
        inputTokens: 7 * usage.calls,
        outputTokens: 3 * usage.calls,
      });
      expect(usage.entries.some((e) => e.purpose === "subagent")).toBe(true);
      expect(JSON.stringify(server.requests)).toContain("write_sample");
    } finally {
      await primary.close();
      await child.close();
      await server.close();
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

test("T-007 provider usage preserves missing/cache-priced uncertainty and validates negative counts", () => {
  expect(providerUsage({}, "openai")).toBeNull();
  expect(
    providerUsage(
      { usage: { prompt_tokens: 3, completion_tokens: 2 } },
      "openai",
    ),
  ).toEqual({ inputTokens: 3, outputTokens: 2 });
  expect(
    providerUsage(
      {
        usage: {
          prompt_tokens: 3,
          completion_tokens: 2,
          prompt_tokens_details: { cached_tokens: 1 },
        },
      },
      "openai",
    ),
  ).toBeNull();
  expect(
    providerUsage(
      {
        usage: {
          input_tokens: 3,
          output_tokens: 2,
          cache_read_input_tokens: 1,
        },
      },
      "anthropic",
    ),
  ).toBeNull();
  expect(() =>
    providerUsage(
      { usage: { prompt_tokens: -1, completion_tokens: 2 } },
      "openai",
    ),
  ).toThrow();
});
