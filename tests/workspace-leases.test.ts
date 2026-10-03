import { test, expect } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AIMessage } from "@langchain/core/messages";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { workspaceRootsOverlap } from "../apps/daemon/src/workspaces.js";
import { startAgentProvider } from "../fixtures/models/agent-provider.js";

test("canonical overlap checks both ancestors and descendants without prefix collisions", () => {
  const root = join(tmpdir(), "rocky-lease-check");
  expect(workspaceRootsOverlap(root, join(root, "child"))).toBe(true);
  expect(workspaceRootsOverlap(join(root, "child"), root)).toBe(true);
  expect(workspaceRootsOverlap(root, root + "-other")).toBe(false);
  if (process.platform === "win32")
    expect(workspaceRootsOverlap(root.toUpperCase(), root.toLowerCase())).toBe(
      true,
    );
});

test.each(["release", "reverse", "cancel-waiter", "blocked"] as const)(
  "root-owned admission for nested registrations: %s",
  async (mode) => {
    const base = await mkdtemp(join(tmpdir(), "rocky-root-lease-")),
      root = join(base, "project"),
      child = join(root, "nested"),
      independent = join(base, "project-other");
    await mkdir(child, { recursive: true });
    await mkdir(independent);
    let service = new WorkService(join(base, "data"));
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = await startAgentProvider({
      reply: async (messages) => {
        if (
          messages.some((m) => m.type === "human" && m.content === "HELD_OWNER")
        )
          await held;
        return new AIMessage("Observed configured completion");
      },
    });
    try {
      const connectionId = randomUUID();
      service.models.save({
        id: connectionId,
        requestId: randomUUID(),
        expectedRevision: 0,
        config: {
          name: "Root lease fixture",
          provider: "openai-compatible",
          baseUrl: provider.baseUrl,
          modelId: "fixture",
          contextWindowTokens: 65536,
          maxOutputTokens: 256,
        },
      });
      const register = (root: string) =>
        service.workspaces.save({
          id: randomUUID(),
          requestId: randomUUID(),
          expectedRevision: 0,
          name: "Lease root",
          root,
        });
      const parent = await register(root),
        nested = await register(child),
        unrelated = await register(independent);
      const submit = (
        workspaceId: string,
        text: string,
        kind: "main" | "background",
      ) =>
        service.submit({
          requestId: randomUUID(),
          workspaceId,
          workspaceRevision: 1,
          workspaceRead: false,
          text,
          kind,
          mode: "configured",
          modelSelection: { connectionId, revision: 1 },
        });
      const owner = submit(
        mode === "reverse" ? nested.id : parent.id,
        "HELD_OWNER",
        "main",
      );
      await expect
        .poll(() => provider.requests.length, { timeout: 10000 })
        .toBeGreaterThan(0);
      const waiting = submit(
          mode === "reverse" ? parent.id : nested.id,
          "NESTED_WAITER",
          "background",
        ),
        free = submit(unrelated.id, "UNRELATED_RUN", "background");
      const unstarted = () => {
        expect(service.store.get(waiting.id).status).toBe("queued");
        expect(service.modelBudgets.snapshot(waiting.runId).calls).toBe(0);
        expect(
          service.store.db
            .prepare("SELECT 1 FROM worker_jobs WHERE run_id=?")
            .get(waiting.runId),
        ).toBeUndefined();
      };
      unstarted();
      await expect
        .poll(() => service.store.get(free.id).status, { timeout: 10000 })
        .toBe("completed");
      unstarted();
      if (mode === "cancel-waiter") {
        service.stop(waiting.id, {
          requestId: randomUUID(),
          runId: waiting.runId,
          executionSessionId: waiting.executionSessionId,
          expectedRevision: service.store.get(waiting.id).revision,
        });
        expect(service.store.get(waiting.id).status).toBe("cancelled");
      }
      if (mode === "blocked") {
        // Exact persisted crash image: interrupted owner is recovered as blocked.
        await service.close();
        release();
        const { Store } = await import("../apps/daemon/src/store.js");
        const store = new Store(join(base, "data"));
        store.db
          .prepare(
            "UPDATE works SET data=json_set(data,'$.status','running') WHERE id=?",
          )
          .run(owner.id);
        store.db
          .prepare(
            "UPDATE works SET data=json_set(data,'$.status','queued') WHERE id=?",
          )
          .run(waiting.id);
        store.close();
        const recovered = new WorkService(join(base, "data"));
        service = recovered;

        expect(recovered.store.get(owner.id).status).toBe("blocked");
        expect(recovered.store.get(waiting.id).status).toBe("queued");
        expect(
          recovered.store.db
            .prepare("SELECT 1 FROM worker_jobs WHERE run_id=?")
            .get(waiting.runId),
        ).toBeUndefined();
      } else {
        release();
        await expect
          .poll(() => service.store.get(owner.id).status, { timeout: 10000 })
          .toBe("completed");
        if (mode === "release" || mode === "reverse")
          await expect
            .poll(() => service.store.get(waiting.id).status, {
              timeout: 10000,
            })
            .toBe("completed");
        else
          expect(
            service.store.db
              .prepare("SELECT 1 FROM worker_jobs WHERE run_id=?")
              .get(waiting.runId),
          ).toBeUndefined();
      }
    } finally {
      release();
      await service.close();
      await provider.close();
      await rm(base, { recursive: true, force: true });
    }
  },
);
