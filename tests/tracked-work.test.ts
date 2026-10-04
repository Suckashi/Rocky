import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Store } from "../apps/daemon/src/store.js";
import { TrackedWorks } from "../apps/daemon/src/tracked-work.js";
import type { McpManager } from "../apps/daemon/src/mcp-manager.js";
import type { Work } from "../packages/contracts/src/index.js";

test("background MCP tracking dedupes status, bounds follow-ups, pins schema and stops unknown queries", async () => {
  const root = await mkdtemp(join(tmpdir(), "rocky-tracking-")),
    store = new Store(root);
  let now = Date.parse("2026-10-04T00:00:00Z"),
    calls = 0,
    changed = false,
    fail = false;
  const identity = {
    serverId: "fixture",
    configRevision: 1,
    registryRevision: 1,
    toolName: "status",
    schemaHash: "a".repeat(64),
  };
  const mcp = {
    prepareTool: (
      _id: string,
      _revision: number,
      _name: string,
      args: unknown,
    ) => ({
      identity: { ...identity, registryRevision: changed ? 2 : 1 },
      tool: { name: "status" },
      args,
    }),
    dispatchTool: async () => {
      calls++;
      if (fail) throw new Error("Unknown network result");
      return { structuredContent: { state: "failed" }, content: [] };
    },
  } as unknown as McpManager;
  const source: Work = {
    id: randomUUID(),
    requestId: randomUUID(),
    runId: randomUUID(),
    executionSessionId: randomUUID(),
    mode: "configured",
    modelSelection: { connectionId: randomUUID(), revision: 1 },
    transport: "http",
    kind: "background",
    runMode: "normal",
    text: "Original background fix",
    answer: "PR prepared",
    status: "completed",
    revision: 1,
    createdAt: new Date(now).toISOString(),
  };
  store.add(source, source.requestId);
  const submissions: unknown[] = [];
  const tracking = new TrackedWorks(
    store,
    mcp,
    (input) => {
      const body = input as { requestId: string; text: string };
      submissions.push(input);
      const work = {
        ...source,
        id: randomUUID(),
        runId: randomUUID(),
        executionSessionId: randomUUID(),
        requestId: body.requestId,
        text: body.text,
        status: "queued" as const,
      };
      store.add(work, work.requestId);
      return work;
    },
    () => now,
  );
  try {
    const command = {
      requestId: randomUUID(),
      id: randomUUID(),
      expectedRevision: 0,
      workId: source.id,
      config: {
        name: "CI status",
        mapping: {
          serverId: "fixture",
          registryRevision: 1,
          toolName: "status",
          arguments: { pr: 42 },
        },
        statusPath: ["state"],
        followupStatuses: ["failed"],
        followupInstruction: "Fix failures within the original scope",
        pollSeconds: 60,
        cooldownSeconds: 60,
        maxPolls: 10,
        maxFollowups: 1,
        enabled: true,
        confirmReadOnly: true,
      },
    };
    tracking.save(command);
    await tracking.tick();
    await tracking.tick();
    expect(calls).toBe(1);
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({
      kind: "background",
      text: expect.stringContaining("Original background fix"),
    });
    now += 60000;
    await tracking.tick();
    expect(calls).toBe(2);
    expect(submissions).toHaveLength(1);
    changed = true;
    now += 60000;
    await tracking.tick();
    expect(calls).toBe(2);
    expect(tracking.get(command.id).state).toBe("unsupported");
    changed = false;
    fail = true;
    const current = tracking.get(command.id);
    tracking.save({
      ...command,
      requestId: randomUUID(),
      expectedRevision: current.revision,
    });
    await tracking.tick();
    expect(tracking.get(command.id).state).toBe("unknown");
    const before = calls;
    now += 60000;
    await tracking.tick();
    expect(calls).toBe(before);
    expect(tracking.history(command.id).followups).toHaveLength(1);
  } finally {
    await tracking.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
