import { test, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AIMessage } from "@langchain/core/messages";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { SteeringStore } from "../apps/daemon/src/steering.js";
import { ConversationStore } from "../apps/daemon/src/conversation-store.js";
import { startAgentProvider } from "../fixtures/models/agent-provider.js";
import type { Work } from "../packages/contracts/src/index.js";
const command = (work: Work, text: string) => ({
  requestId: randomUUID(),
  runId: work.runId,
  executionSessionId: work.executionSessionId,
  expectedRevision: work.revision,
  text,
});
async function setup(nextBoundary: boolean | "child") {
  let release!: () => void,
    entered = false;
  const held = new Promise<void>((resolve) => (release = resolve));
  const provider = await startAgentProvider({
    reply: async (messages, child) => {
      const last = String(
        messages.findLast((m) => m.type === "human")?.content,
      );
      if (last === "background independent")
        return new AIMessage("background result");
      if (child) {
        expect(last).toBe("child inspection");
        return new AIMessage("observed child result");
      }
      if (last === "initial goal") {
        entered = true;
        await held;
        return nextBoundary
          ? new AIMessage({
              content: "",
              tool_calls: [
                {
                  id: "todo",
                  name: nextBoundary === "child" ? "task" : "write_todos",
                  args:
                    nextBoundary === "child"
                      ? {
                          description: "child inspection",
                          subagent_type: "general-purpose",
                        }
                      : {
                          todos: [
                            { content: "initial work", status: "in_progress" },
                          ],
                        },
                  type: "tool_call",
                },
              ],
            })
          : new AIMessage("original completed result");
      }
      expect(last).toBe("Correction: verify only; do not publish.");
      return new AIMessage("corrected result");
    },
  });
  const root = mkdtempSync(join(tmpdir(), "rocky-steering-")),
    service = new WorkService(root),
    id = randomUUID();
  service.models.save({
    requestId: randomUUID(),
    id,
    expectedRevision: 0,
    config: {
      name: "steering fixture",
      provider: "openai-compatible",
      baseUrl: provider.baseUrl,
      modelId: "steering",
      contextWindowTokens: 65536,
      maxOutputTokens: 128,
    },
  });
  const submit = (text: string, kind: "main" | "background" = "main") =>
    service.submit({
      requestId: randomUUID(),
      text,
      kind,
      mode: "configured",
      transport: "http",
      modelSelection: { connectionId: id, revision: 1 },
    });
  return {
    service,
    provider,
    root,
    submit,
    release,
    entered: () => entered,
    close: async () => {
      release();
      await service.close();
      await provider.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test.each([true, "child"] as const)(
  "steering is accepted idempotently and becomes applied only in its owned root checkpoint boundary (%s)",
  async (boundary) => {
    const f = await setup(boundary);
    try {
      const main = f.submit("initial goal");
      await expect.poll(f.entered, { timeout: 10000 }).toBe(true);
      const current = f.service.store.get(main.id),
        input = command(current, "Correction: verify only; do not publish.");
      const receipt = f.service.steer(main.id, input) as {
        id: string;
        status: string;
      };
      expect(receipt.status).toBe("accepted");
      expect(f.service.steer(main.id, input)).toEqual(receipt);
      expect(() =>
        f.service.steer(main.id, { ...input, text: "changed" }),
      ).toThrow("changed");
      expect(() =>
        f.service.steer(main.id, {
          ...input,
          requestId: randomUUID(),
          runId: randomUUID(),
        }),
      ).toThrow("changed");
      expect(
        new ConversationStore(f.service.store)
          .page()
          .messages.some((m) => m.source === "steering"),
      ).toBe(false);
      const background = f.submit("background independent", "background");
      await expect
        .poll(() => f.service.store.get(background.id).status, {
          timeout: 10000,
        })
        .toBe("completed");
      expect(() =>
        f.service.steer(background.id, { ...input, requestId: randomUUID() }),
      ).toThrow("changed");
      f.release();
      await expect
        .poll(() => f.service.store.get(main.id).status, { timeout: 10000 })
        .toBe("completed");
      expect(f.service.store.get(main.id).answer).toBe("corrected result");
      const applied = new SteeringStore(f.service.store).list(main.id)[0]!;
      expect(applied.status).toBe("applied");
      expect(applied.checkpointId).toBeTruthy();
      const history = new ConversationStore(f.service.store)
        .page()
        .messages.filter((m) => m.source === "steering");
      expect(history).toHaveLength(1);
      expect(history[0]!.text).toBe(input.text);
      expect(
        f.service.store.db
          .prepare("SELECT COUNT(*) AS n FROM operations")
          .get(),
      ).toMatchObject({ n: 0 });
    } finally {
      await f.close();
    }
  },
);
for (const stop of [false, true])
  test(
    "pending steering is not_applied when " +
      (stop ? "stopped" : "terminal before next boundary") +
      ", with no ghost history",
    async () => {
      const f = await setup(false);
      try {
        const work = f.submit("initial goal");
        await expect.poll(f.entered, { timeout: 10000 }).toBe(true);
        const current = f.service.store.get(work.id),
          input = command(current, "Correction: verify only; do not publish.");
        f.service.steer(work.id, input);
        if (stop)
          f.service.stop(work.id, {
            requestId: randomUUID(),
            runId: current.runId,
            executionSessionId: current.executionSessionId,
            expectedRevision: current.revision,
          });
        f.release();
        await expect
          .poll(() => f.service.store.get(work.id).status, { timeout: 10000 })
          .toBe(stop ? "cancelled" : "completed");
        const receipt = new SteeringStore(f.service.store).list(work.id)[0]!;
        expect(receipt.status).toBe("not_applied");
        expect(receipt.reason).toBeTruthy();
        expect(
          new ConversationStore(f.service.store)
            .page()
            .messages.some((m) => m.source === "steering"),
        ).toBe(false);
        expect(f.service.steer(work.id, input)).toMatchObject({
          status: "not_applied",
        });
      } finally {
        await f.close();
      }
    },
  );
