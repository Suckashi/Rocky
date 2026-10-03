import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Store } from "../apps/daemon/src/store.js";
import { WorkerChannel } from "../apps/daemon/src/worker-channel.js";
import { workSchema } from "../packages/contracts/src/index.js";
const entry = fileURLToPath(
  new URL("../fixtures/worker/channel.ts", import.meta.url),
);
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
    } finally {
      await channel.close();
      expect(channel.pendingCount).toBe(0);
      f.store.close();
      rmSync(f.root, { recursive: true, force: true });
    }
  });

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
