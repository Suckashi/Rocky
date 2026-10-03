import { test, expect } from "vitest";
import { AIMessage } from "@langchain/core/messages";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { ConversationStore } from "../apps/daemon/src/conversation-store.js";
import { startAgentProvider } from "../fixtures/models/agent-provider.js";

test("confirmed native checkpoint context reaches next main worker, survives restart, and stays out of background/evaluation", async () => {
  const provider = await startAgentProvider({
    reply: async (messages) => {
      const last = messages.findLast((message) => message.type === "human");
      if (String(last?.content) === "wait for owner")
        return new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "new-wait",
              name: "write_sample",
              args: { value: "not dispatched" },
              type: "tool_call",
            },
          ],
        });
      if (String(last?.content) === "Remember colour violet")
        return new AIMessage("Remembered violet.");
      return new AIMessage(
        messages.some(
          (message) => String(message.content) === "Remember colour violet",
        )
          ? "violet"
          : "missing",
      );
    },
  });
  const root = mkdtempSync(join(tmpdir(), "rocky-continuous-"));
  let service = new WorkService(root);
  const connectionId = randomUUID();
  try {
    service.models.save({
      requestId: randomUUID(),
      id: connectionId,
      expectedRevision: 0,
      config: {
        name: "context fixture",
        provider: "openai-compatible",
        baseUrl: provider.baseUrl,
        modelId: "context",
        contextWindowTokens: 4096,
        maxOutputTokens: 128,
      },
    });
    const submit = (
      text: string,
      kind: "main" | "background" = "main",
      evaluation = false,
    ) =>
      service.submit(
        {
          requestId: randomUUID(),
          text,
          kind,
          mode: "configured",
          transport: "http",
          modelSelection: { connectionId, revision: 1 },
        },
        evaluation ? "evaluation" : "normal",
      );
    const finish = async (id: string) => {
      await expect
        .poll(() => service.store.get(id).status, { timeout: 10000 })
        .toBe("completed");
      return service.store.get(id);
    };
    const first = submit("Remember colour violet");
    await finish(first.id);
    const second = submit("What colour?");
    expect((await finish(second.id)).answer).toBe("violet");
    const sessions = new ConversationStore(service.store);
    expect(sessions.session(second.id)).toMatchObject({
      graphThreadId: second.runId,
      sourceGraphThreadId: first.runId,
      generation: 2,
    });
    expect(second.executionSessionId).not.toBe(first.executionSessionId);
    expect(second.runId).not.toBe(first.runId);
    expect((await finish(submit("What colour?", "background").id)).answer).toBe(
      "missing",
    );
    expect((await finish(submit("What colour?", "main", true).id)).answer).toBe(
      "missing",
    );
    await service.close();
    service = new WorkService(root);
    const third = submit("What colour after restart?");
    expect((await finish(third.id)).answer).toBe("violet");
    expect(
      new ConversationStore(service.store).session(third.id).generation,
    ).toBe(3);
    const waiting = submit("wait for owner");
    await expect
      .poll(() => service.store.get(waiting.id).status, { timeout: 10000 })
      .toBe("waiting_approval");
    const target = service.store.get(waiting.id);
    service.stop(target.id, {
      requestId: randomUUID(),
      runId: target.runId,
      executionSessionId: target.executionSessionId,
      expectedRevision: target.revision,
    });
    const fresh = submit("What colour after cancelled turn?");
    expect((await finish(fresh.id)).answer).toBe("violet");
    expect(
      new ConversationStore(service.store).session(fresh.id)
        .sourceGraphThreadId,
    ).toBe(third.runId);
    const restoredBatch = JSON.parse(
      (
        service.store.db
          .prepare("SELECT data FROM context_batches WHERE work_id=?")
          .get(fresh.id) as { data: string }
      ).data,
    );
    expect(
      restoredBatch.items.some(
        (item: { content: string }) => item.content === "wait for owner",
      ),
    ).toBe(true);
    expect(
      restoredBatch.items.some((item: { content: string }) =>
        item.content.includes('"status":"cancelled"'),
      ),
    ).toBe(true);
    expect(
      service.store.db
        .prepare("SELECT id FROM operations WHERE outcome='succeeded'")
        .all(),
    ).toHaveLength(0);
    const warm = submit("Remember colour violet");
    await finish(warm.id);
    const alternate = randomUUID();
    service.models.save({
      requestId: randomUUID(),
      id: alternate,
      expectedRevision: 0,
      config: {
        name: "alternate configured model",
        provider: "openai-compatible",
        baseUrl: provider.baseUrl,
        modelId: "alternate",
        contextWindowTokens: 4096,
        maxOutputTokens: 128,
      },
    });
    const switched = service.submit({
      requestId: randomUUID(),
      text: "What colour after model switch?",
      mode: "configured",
      transport: "http",
      modelSelection: { connectionId: alternate, revision: 1 },
    });
    expect((await finish(switched.id)).answer).toBe("violet");
    expect(
      new ConversationStore(service.store).session(switched.id)
        .sourceGraphThreadId,
    ).toBe(warm.runId);
    const changedWorkspace = service.submit({
      requestId: randomUUID(),
      text: "What colour in a different workspace?",
      workspaceId: randomUUID(),
      mode: "configured",
      transport: "http",
      modelSelection: { connectionId, revision: 1 },
    });
    expect((await finish(changedWorkspace.id)).answer).toBe("missing");
    expect(
      new ConversationStore(service.store).session(changedWorkspace.id)
        .sourceGraphThreadId,
    ).toBeUndefined();
  } finally {
    await service.close();
    await provider.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);

test("new native fixture turn requests fresh approval without replaying any completed operation", async () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-context-effects-"));
  const service = new WorkService(root);
  try {
    const first = service.submit({
      requestId: randomUUID(),
      text: "first goal",
      mode: "fixture",
      transport: "stdio",
    });
    await expect
      .poll(() => service.store.get(first.id).status, { timeout: 10000 })
      .toBe("waiting_approval");
    const waiting = service.store.get(first.id);
    service.decide(first.id, {
      requestId: randomUUID(),
      expectedRevision: waiting.approval!.revision,
      intentFingerprint: waiting.approval!.intentFingerprint,
      decision: "approve",
    });
    await expect
      .poll(() => service.store.get(first.id).status, { timeout: 10000 })
      .toBe("completed");
    const before = service.store.db
      .prepare("SELECT * FROM operations WHERE id LIKE ? ORDER BY id")
      .all(first.runId + ":%");
    const second = service.submit({
      requestId: randomUUID(),
      text: "second new goal",
      mode: "fixture",
      transport: "stdio",
    });
    await expect
      .poll(() => service.store.get(second.id).status, { timeout: 10000 })
      .toBe("waiting_approval");
    expect(
      new ConversationStore(service.store).session(second.id)
        .sourceGraphThreadId,
    ).toBe(first.runId);
    expect(service.store.get(second.id).approval?.operationId).not.toBe(
      waiting.approval!.operationId,
    );
    expect(
      service.store.db
        .prepare("SELECT * FROM operations WHERE id LIKE ? ORDER BY id")
        .all(first.runId + ":%"),
    ).toEqual(before);
    expect(
      service.operations.get(
        service.store.get(second.id).approval!.operationId!,
      )?.outcome,
    ).toBe("not_executed");
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});
