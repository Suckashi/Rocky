import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { EventSchemas } from "@ag-ui/core/schemas";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { createApp } from "../apps/daemon/src/http.js";

test("AG-UI replay drains all owned event pages before the terminal receipt", async () => {
  const prefix = join(tmpdir(), "rocky-agui-replay-");
  const root = mkdtempSync(prefix),
    service = new WorkService(root),
    app = createApp(service);
  try {
    const runId = randomUUID(),
      text = "Explicit replay test fixture";
    const work = service.submit({
      requestId: runId,
      text,
      mode: "fixture",
      transport: "http",
    });
    await expect
      .poll(() => service.store.get(work.id).status, { timeout: 10000 })
      .toBe("waiting_approval");
    const approval = service.store.get(work.id).approval!;
    service.decide(work.id, {
      requestId: randomUUID(),
      expectedRevision: approval.revision,
      intentFingerprint: approval.intentFingerprint,
      decision: "approve",
    });
    await expect
      .poll(() => service.store.get(work.id).status, { timeout: 10000 })
      .toBe("completed");
    const requestId = randomUUID(),
      current = service.store.get(work.id);
    // Explicit persisted-event fixture for a >1000 event replay; never product activity.
    service.store.transaction(() => {
      service.store.event(current, "rocky.model.stream", {
        requestId,
        phase: "start",
      });
      for (let i = 0; i < 1001; i++)
        service.store.event(current, "rocky.model.stream", {
          requestId,
          phase: "delta",
          delta: "x",
        });
      service.store.event(current, "rocky.model.stream", {
        requestId,
        phase: "end",
      });
    });
    const replay = service.store.eventsForWork(work.id);
    expect(
      replay.every(
        (e, i) =>
          i === 0 || BigInt(e.sequence) > BigInt(replay[i - 1]!.sequence),
      ),
    ).toBe(true);
    const snapshot = service.store.snapshot();
    expect(
      snapshot.events.every(
        (e, i) =>
          i === 0 ||
          BigInt(e.sequence) > BigInt(snapshot.events[i - 1]!.sequence),
      ),
    ).toBe(true);
    const token = (
      await (
        await app.request("/api/v1/session", {
          headers: { host: "127.0.0.1:3211" },
        })
      ).json()
    ).token;
    const response = await app.request("/api/v1/copilotkit/agent/rocky/run", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3211",
        "content-type": "application/json",
        "x-rocky-session": token,
      },
      body: JSON.stringify({
        threadId: randomUUID(),
        runId,
        messages: [{ id: randomUUID(), role: "user", content: text }],
        state: {},
        tools: [],
        context: [],
        forwardedProps: { mode: "fixture", transport: "http" },
      }),
    });
    expect(response.status).toBe(200);
    const events = (await response.text())
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => EventSchemas.parse(JSON.parse(line.slice(5))));
    const id = "model-stream:" + requestId;
    const parts = events.filter(
      (event) =>
        event.type === "TEXT_MESSAGE_CONTENT" && event.messageId === id,
    );
    expect(parts).toHaveLength(1001);
    expect(
      events.filter(
        (event) => event.type === "TEXT_MESSAGE_END" && event.messageId === id,
      ),
    ).toHaveLength(1);
    expect(events.at(-1)?.type).toBe("RUN_FINISHED");
    expect(service.store.list()).toHaveLength(1); // Request replay never creates a second Work.
  } finally {
    await service.close();
    if (!root.startsWith(prefix)) throw Error("Unexpected test directory");
    rmSync(root, { recursive: true, force: true });
  }
});
