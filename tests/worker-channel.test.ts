import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Store } from "../apps/daemon/src/store.js";
import { WorkerChannel } from "../apps/daemon/src/worker-channel.js";
import { WorkerJobs } from "../apps/daemon/src/worker-jobs.js";
import type { AIMessage } from "@langchain/core/messages";
import { workSchema } from "../packages/contracts/src/index.js";
const entry = fileURLToPath(
  new URL("../fixtures/worker/channel.ts", import.meta.url),
);
test("large native checkpoint history reaches one daemon model dispatch through real bounded child IPC", async () => {
  const { SqliteSaver } =
    await import("@langchain/langgraph-checkpoint-sqlite");
  const { HumanMessage } = await import("@langchain/core/messages");
  const { createRockyAgent } =
    await import("../packages/agent-runtime/src/factory.js");
  const { fromModelWire } =
    await import("../packages/agent-runtime/src/model-wire.js");
  const f = setup("latest instruction remains exact"),
    source = randomUUID();
  const graphPath = join(f.root, "graph-checkpoints.sqlite");
  const saver = SqliteSaver.fromConnString(graphPath);
  const messages = Array.from(
    { length: 240 },
    (_, index) => new HumanMessage(`${index}:` + "岩石🙂".repeat(100)),
  );
  await createRockyAgent(saver, {
    event: () => {},
    call: async () => "unused",
  }).updateState({ configurable: { thread_id: source } }, { messages });
  saver.db.close();
  let calls = 0;
  const channel = new WorkerChannel(
    f.store,
    f.work.id,
    fileURLToPath(new URL("../apps/agent-worker/src/main.ts", import.meta.url)),
    async (_work, payload) => {
      if (payload.kind !== "model_request") throw Error("Unexpected RPC");
      calls++;
      expect(Buffer.byteLength(JSON.stringify(payload))).toBeGreaterThan(65536);
      const received = fromModelWire(payload.messages);
      expect(
        received.filter((m) => m.type === "human").map((m) => m.content),
      ).toEqual([...messages.map((m) => m.content), f.work.text]);
      return { content: "complete preserved context", tool_calls: [] };
    },
    {
      graphPath,
      sourceGraphThreadId: source,
      mode: "configured",
      event: () => {},
    },
  );
  try {
    expect(await channel.invoke()).toMatchObject({
      messages: [{ content: "complete preserved context" }],
    });
    expect(calls).toBe(1);
    expect(channel.error).toBeNull();
  } finally {
    await channel.close();
    f.store.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
function setup(text: string) {
  const root = mkdtempSync(join(tmpdir(), "rocky-worker-")),
    store = new Store(root);
  const work = workSchema.parse({
    id: randomUUID(),
    runId: randomUUID(),
    executionSessionId: randomUUID(),
    requestId: randomUUID(),
    text,
    transport: "stdio",
    mode: "fixture",
    runMode: "normal",
    status: "running",
    revision: 1,
    answer: "",
    createdAt: new Date().toISOString(),
  });
  store.add(work, "test");
  return { root, store, work };
}
test("large model response and final native result cross both real child IPC directions intact", async () => {
  const f = setup("large answer"),
    content = "岩石🙂".repeat(40000),
    graphPath = join(f.root, "graph-checkpoints.sqlite");
  let calls = 0;
  const channel = new WorkerChannel(
    f.store,
    f.work.id,
    fileURLToPath(new URL("../apps/agent-worker/src/main.ts", import.meta.url)),
    async (_work, payload) => {
      if (payload.kind !== "model_request") throw Error("Unexpected RPC");
      calls++;
      return { content, tool_calls: [] };
    },
    { graphPath, mode: "configured", event: () => {} },
  );
  try {
    const result = (await channel.invoke()) as {
      messages: { content: string }[];
    };
    expect(result.messages.at(-1)?.content).toBe(content);
    expect(calls).toBe(1);
    expect(channel.error).toBeNull();
    expect(f.store.get(f.work.id).status).toBe("running");
    const { SqliteSaver } =
      await import("@langchain/langgraph-checkpoint-sqlite");
    const saver = SqliteSaver.fromConnString(graphPath);
    try {
      const cp = await saver.getTuple({
        configurable: { thread_id: f.work.runId },
      });
      expect(JSON.stringify(cp?.checkpoint.channel_values.messages)).toContain(
        content,
      );
    } finally {
      saver.db.close();
    }
  } finally {
    await channel.close();
    f.store.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
test("large daemon tool receipt resumes exact native interrupt and offloads evidence without repeating the tool", async () => {
  const f = setup("large synthetic tool evidence"),
    evidence = "observed fixture row 岩石🙂\n".repeat(12000),
    graphPath = join(f.root, "graph-checkpoints.sqlite");
  let tools = 0;
  const channel = new WorkerChannel(
    f.store,
    f.work.id,
    fileURLToPath(new URL("../apps/agent-worker/src/main.ts", import.meta.url)),
    async (_work, payload) => {
      if (payload.kind === "tool_request") {
        expect(payload.tool).toBe("write_sample");
        tools++;
        return JSON.stringify({ fixture: true, evidence });
      }
      if (payload.kind !== "model_request") throw Error("Unexpected RPC");
      if (tools === 0)
        return {
          content: "",
          tool_calls: [
            {
              id: "large-write",
              name: "write_sample",
              args: { value: "synthetic evidence" },
              type: "tool_call",
            },
          ],
        };
      expect(JSON.stringify(payload.messages)).toContain(
        "/large_tool_results/large-write.txt",
      );
      return {
        content: "Observed synthetic receipt persisted; no host effect.",
        tool_calls: [],
      };
    },
    { graphPath, mode: "configured", event: () => {} },
  );
  try {
    expect(await channel.invoke()).toMatchObject({
      __interrupt__: expect.any(Array),
    });
    expect(tools).toBe(0);
    expect(await channel.invoke("approve")).toMatchObject({
      messages: [
        { content: "Observed synthetic receipt persisted; no host effect." },
      ],
    });
    expect(tools).toBe(1);
    expect(channel.error).toBeNull();
    const { SqliteSaver } =
      await import("@langchain/langgraph-checkpoint-sqlite");
    const saver = SqliteSaver.fromConnString(graphPath);
    try {
      const state = (await saver.getTuple({
        configurable: { thread_id: f.work.runId },
      }))!.checkpoint.channel_values;
      expect(JSON.stringify(state.files)).toContain(
        "observed fixture row 岩石🙂",
      );
      expect(
        (state.files as Record<string, { content: string }>)[
          "/large_tool_results/large-write.txt"
        ]!.content,
      ).toBe(JSON.stringify({ fixture: true, evidence }));
    } finally {
      saver.db.close();
    }
  } finally {
    await channel.close();
    f.store.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
test("T-009 real child IPC verifies ownership and correlates tool result with daemon-resolved scope", async () => {
  const f = setup("roundtrip");
  const seen: unknown[] = [];
  const channel = new WorkerChannel(
    f.store,
    f.work.id,
    entry,
    async (work, payload) => {
      expect(work.id).toBe(f.work.id);
      seen.push(payload);
      return { checked: true };
    },
  );
  try {
    expect(await channel.exited).toEqual({ code: 0, signal: null });
    expect(seen).toHaveLength(2);
    expect(seen[1]).toMatchObject({
      tool: "record_result",
      args: { result: { checked: true } },
    });
    expect(channel.error).toBeNull();
    expect(new WorkerJobs(f.store).get(channel.jobId)).toMatchObject({
      status: "exited",
      exit_code: 0,
    });
    expect(f.store.get(f.work.id).status).toBe("running");
  } finally {
    await channel.close();
    f.store.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
for (const mode of ["badcap", "flood", "stubborn"] as const)
  test("T-009 capability, queue and forced shutdown: " + mode, async () => {
    const f = setup(mode);
    let calls = 0;
    let reached!: () => void;
    const ready = new Promise<void>((resolve) => (reached = resolve));
    const channel = new WorkerChannel(
      f.store,
      f.work.id,
      entry,
      async (_work, _payload, signal) => {
        calls++;
        reached();
        await new Promise<void>((resolve, reject) => {
          if (signal.aborted) reject(signal.reason);
          else
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
        });
      },
    );
    try {
      if (mode === "stubborn") {
        await ready;
        await channel.close();
      } else await channel.exited;
      expect(channel.pendingCount).toBeLessThanOrEqual(8);
      if (mode === "badcap") expect(calls).toBe(0);
      if (mode === "flood") expect(calls).toBeLessThanOrEqual(8);
      if (mode !== "stubborn") expect(channel.error).toContain("violation");
      expect(new WorkerJobs(f.store).get(channel.jobId).status).toBe(
        mode === "stubborn" ? "cancelled" : "interrupted",
      );
    } finally {
      await channel.close();
      expect(channel.pendingCount).toBe(0);
      f.store.close();
      rmSync(f.root, { recursive: true, force: true });
    }
  });
for (const mode of ["partial-run", "incomplete-run", "foreign-result"])
  test(
    "incomplete or wrong-kind final result never completes native invocation: " +
      mode,
    async () => {
      const f = setup(mode),
        channel = new WorkerChannel(
          f.store,
          f.work.id,
          entry,
          async () => {
            throw Error("No effects expected");
          },
          { graphPath: join(f.root, "unused.sqlite"), event: () => {} },
        );
      try {
        await expect(channel.invoke()).rejects.toThrow();
        await channel.exited;
        expect(f.store.get(f.work.id).status).toBe("running");
        expect(channel.error).toBeTruthy();
      } finally {
        await channel.close();
        f.store.close();
        rmSync(f.root, { recursive: true, force: true });
      }
    },
  );

test("T-009 shutdown bounds a handler that ignores cancellation", async () => {
  const f = setup("stubborn");
  let ready!: () => void;
  const started = new Promise<void>((resolve) => (ready = resolve));
  const channel = new WorkerChannel(f.store, f.work.id, entry, async () => {
    ready();
    return new Promise(() => {});
  });
  try {
    await started;
    await channel.close();
    expect(channel.pendingCount).toBe(0);
  } finally {
    await channel.close();
    f.store.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("T-009 forced shutdown reaps a stubborn worker and its real descendant", async () => {
  const f = setup("stubborn-tree");
  let childPid = 0;
  let ready!: () => void;
  const reported = new Promise<void>((resolve) => (ready = resolve));
  const channel = new WorkerChannel(
    f.store,
    f.work.id,
    entry,
    async (_work, payload) => {
      if (payload.kind !== "tool_request")
        throw Error("Unexpected model request");
      childPid = Number(payload.args.pid);
      ready();
      return { recorded: true };
    },
  );
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  try {
    await reported;
    expect(Number.isSafeInteger(childPid) && childPid > 0).toBe(true);
    expect(alive(childPid)).toBe(true);
    await channel.close();
    for (let attempt = 0; attempt < 30 && alive(childPid); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    expect(alive(childPid)).toBe(false);
    expect(new WorkerJobs(f.store).get(channel.jobId).status).toBe("cancelled");
  } finally {
    await channel.close();
    if (childPid && alive(childPid)) {
      if (process.platform === "win32")
        spawnSync("taskkill.exe", ["/PID", String(childPid), "/T", "/F"], {
          windowsHide: true,
        });
      else process.kill(childPid, "SIGKILL");
    }
    f.store.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("T-009 restart marks an unfinished worker interrupted without completing its Work or respawning", async () => {
  const { WorkService } = await import("../apps/daemon/src/work-service.js");
  const f = setup("recovery");
  const jobs = new WorkerJobs(f.store);
  const pending = jobs.begin(f.work);
  expect(() => jobs.begin(f.work)).toThrow("already has an active worker");
  jobs.attach(pending.id, 12345);
  f.store.close();
  const service = new WorkService(f.root);
  try {
    expect(new WorkerJobs(service.store).get(pending.id)).toMatchObject({
      status: "interrupted",
      error: "Daemon restarted before worker outcome was recorded",
    });
    expect(service.store.get(f.work.id).status).toBe("blocked");
    expect(
      service.store
        .events("0")
        .filter(
          (e) =>
            e.payload.kind === "domain" &&
            e.payload.name === "rocky.worker.interrupted",
        ),
    ).toHaveLength(1);
    expect(new WorkerJobs(service.store).recover()).toBe(0);
    expect(
      service.store
        .events("0")
        .filter(
          (e) =>
            e.payload.kind === "domain" &&
            e.payload.name === "rocky.worker.interrupted",
        ),
    ).toHaveLength(1);
  } finally {
    await service.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("T-009 native Deep Agents fixture runs in child and resumes exact interrupt through daemon RPC", async () => {
  const { FixtureModel } = await import("../fixtures/models/model.js");
  const agentEntry = fileURLToPath(
    new URL("../apps/agent-worker/src/main.ts", import.meta.url),
  );
  const f = setup("native worker fixture");
  const tools: string[] = [];
  const events: string[] = [];
  let modelCalls = 0;
  const channel = new WorkerChannel(
    f.store,
    f.work.id,
    agentEntry,
    async (_work, payload) => {
      if (payload.kind === "model_request") {
        modelCalls++;
        const result = await new FixtureModel(payload.child)._generate(
          payload.messages as Parameters<
            InstanceType<typeof FixtureModel>["_generate"]
          >[0],
        );
        const message = result.generations[0]!.message as AIMessage;
        return { content: message.content, tool_calls: message.tool_calls };
      }
      if (payload.kind !== "tool_request")
        throw Error("Unexpected context RPC in this test");
      tools.push(payload.tool);
      return JSON.stringify({ synthetic: true, tool: payload.tool });
    },
    {
      graphPath: join(f.root, "graph-checkpoints.sqlite"),
      event: (_work, name) => events.push(name),
    },
  );
  try {
    const first = (await channel.invoke()) as { __interrupt__?: unknown[] };
    expect(first.__interrupt__).toHaveLength(1);
    expect(tools).toContain("inspect_sample");
    expect(tools).not.toContain("write_sample");
    expect(events).toContain("rocky.subagent.started");
    const resumed = (await channel.invoke("approve")) as {
      messages?: { content: unknown }[];
    };
    expect(tools.filter((tool) => tool === "write_sample")).toHaveLength(1);
    expect(resumed.messages?.at(-1)?.content).toContain("合成流程");
    expect(modelCalls).toBeGreaterThanOrEqual(4);
  } finally {
    await channel.close();
    f.store.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
