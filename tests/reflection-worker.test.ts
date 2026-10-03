import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Store } from "../apps/daemon/src/store.js";
import { WorkerChannel } from "../apps/daemon/src/worker-channel.js";
import { workSchema } from "../packages/contracts/src/index.js";
import { parseIpcMessage } from "../packages/contracts/src/ipc.js";
const binding = {
  episodeId: randomUUID(),
  episodeRevision: 2,
  episodeHash: "a".repeat(64),
};
test("reflection profile traverses real worker IPC without normal skill discovery or conversation inheritance", async () => {
  const root = await mkdtemp(join(tmpdir(), "rocky-reflection-worker-")),
    store = new Store(join(root, "data"));
  let channel: WorkerChannel | undefined;
  try {
    const work = workSchema.parse({
      id: randomUUID(),
      runId: randomUUID(),
      executionSessionId: randomUUID(),
      requestId: randomUUID(),
      text: "Read the bound reviewed episode and assess reuse",
      transport: "http",
      mode: "configured",
      modelSelection: { connectionId: randomUUID(), revision: 1 },
      runMode: "normal",
      status: "running",
      revision: 1,
      answer: "",
      createdAt: new Date().toISOString(),
    });
    store.add(work, work.id);
    const entry = fileURLToPath(
        new URL("../apps/agent-worker/src/main.ts", import.meta.url),
      ),
      graphPath = join(root, "graph.sqlite");
    let modelCalls = 0;
    const tools: string[] = [];
    const options = {
      graphPath,
      mode: "configured" as const,
      reflection: binding,
      event: () => {},
    };
    expect(
      () =>
        new WorkerChannel(store, work.id, entry, async () => null, {
          ...options,
          sourceGraphThreadId: randomUUID(),
        }),
    ).toThrow("inherit");
    channel = new WorkerChannel(
      store,
      work.id,
      entry,
      async (owned, payload) => {
        expect(owned.runId).toBe(work.runId);
        if (payload.kind === "model_request") {
          expect(payload.child).toBe(false);
          expect(JSON.stringify(payload.tools)).toContain(
            "read_learning_episode",
          );
          expect(JSON.stringify(payload.tools)).not.toContain(
            '"name":"mcp_call"',
          );
          modelCalls++;
          return modelCalls > 2
            ? { content: "No supported reusable lesson", tool_calls: [] }
            : {
                content: "",
                tool_calls: [
                  {
                    id: randomUUID(),
                    name:
                      modelCalls === 1
                        ? "read_learning_episode"
                        : "mark_no_learning",
                    args:
                      modelCalls === 1
                        ? {}
                        : { reason: "Insufficient evidence" },
                    type: "tool_call",
                  },
                ],
              };
        }
        if (payload.kind !== "tool_request")
          throw Error("Unexpected RPC " + payload.kind);
        expect(payload.args.binding).toEqual(binding);
        if (payload.tool === "rocky_reflection_check") return "ok";
        expect(payload.tool).toBe("rocky_reflection_tool");
        tools.push(String(payload.args.name));
        return JSON.stringify({ status: "fixture_received" });
      },
      options,
    );
    expect(await channel.invoke()).toMatchObject({
      messages: [{ content: "No supported reusable lesson" }],
    });
    expect(tools).toEqual(["read_learning_episode", "mark_no_learning"]);
    expect(modelCalls).toBe(3);
  } finally {
    await channel?.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("reflection wire start rejects context, fixture, steering and unconfigured combinations", () => {
  const envelope = {
    schemaVersion: 1,
    requestId: randomUUID(),
    runId: randomUUID(),
    executionSessionId: randomUUID(),
    runCapability: "a".repeat(64),
    sequence: "1",
  };
  const payload = {
    kind: "start",
    mode: "configured",
    text: "Bound episode",
    reflection: binding,
  };
  expect(
    parseIpcMessage(JSON.stringify({ ...envelope, payload })).payload.kind,
  ).toBe("start");
  for (const patch of [
    { mode: "fixture" },
    { sourceGraphThreadId: randomUUID() },
    { contextBatchId: randomUUID() },
    { testFixtureTools: true },
    { steering: true },
    { imageInputs: true },
  ])
    expect(() =>
      parseIpcMessage(
        JSON.stringify({ ...envelope, payload: { ...payload, ...patch } }),
      ),
    ).toThrow("Reflection");
});
