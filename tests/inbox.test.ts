import { test, expect } from "vitest";
import { AIMessage } from "@langchain/core/messages";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { startAgentProvider } from "../fixtures/models/agent-provider.js";

test("actual background inbox freezes its boundary and re-delivers checkpointed evidence from a failed main branch", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered = false;
  const fixture = await startAgentProvider({
    reply: async (messages) => {
      const last = String(
        messages.findLast((message) => message.type === "human")?.content,
      );
      if (last === "background alpha") return new AIMessage("alpha receipt");
      if (last === "background beta") return new AIMessage("beta receipt");
      if (last === "background gamma") return new AIMessage("gamma receipt");
      if (last === "first main") {
        entered = true;
        await held;
      }
      if (last === "failed main")
        throw Error("Injected fixture response failure");
      const receipts = messages.filter((message) =>
        String(message.content).startsWith("Background Work receipt"),
      );
      return new AIMessage(
        receipts
          .map((message) =>
            ["alpha", "beta", "gamma"].find((word) =>
              String(message.content).includes(word + " receipt"),
            ),
          )
          .join(","),
      );
    },
  });
  const root = mkdtempSync(join(tmpdir(), "rocky-inbox-"));
  const service = new WorkService(root);
  try {
    const connectionId = randomUUID();
    service.models.save({
      requestId: randomUUID(),
      id: connectionId,
      expectedRevision: 0,
      config: {
        name: "inbox fixture",
        provider: "openai-compatible",
        baseUrl: fixture.baseUrl,
        modelId: "inbox",
        contextWindowTokens: 4096,
        maxOutputTokens: 128,
      },
    });
    const submit = (text: string, kind: "main" | "background" = "main") =>
      service.submit({
        requestId: randomUUID(),
        text,
        kind,
        mode: "configured",
        transport: "stdio",
        modelSelection: { connectionId, revision: 1 },
      });
    const finish = async (id: string, status = "completed") => {
      await expect
        .poll(() => service.store.get(id).status, { timeout: 10000 })
        .toBe(status);
      return service.store.get(id);
    };
    const early = submit("background alpha", "background");
    await finish(early.id);
    const first = submit("first main");
    await expect.poll(() => entered, { timeout: 10000 }).toBe(true);
    const batch = JSON.parse(
      (
        service.store.db
          .prepare("SELECT data FROM context_batches WHERE work_id=?")
          .get(first.id) as { data: string }
      ).data,
    );
    expect(batch.status).toBe("applied");
    expect(batch.items.map((item: { id: string }) => item.id)).toContain(
      "inbox:work-result:" + early.id,
    );
    const late = submit("background beta", "background");
    await finish(late.id);
    expect(batch.items.map((item: { id: string }) => item.id)).not.toContain(
      "inbox:work-result:" + late.id,
    );
    release();
    expect((await finish(first.id)).answer).toBe("alpha");
    const second = submit("second main");
    expect((await finish(second.id)).answer).toBe("alpha,beta");
    const secondBatch = JSON.parse(
      (
        service.store.db
          .prepare("SELECT data FROM context_batches WHERE work_id=?")
          .get(second.id) as { data: string }
      ).data,
    );
    expect(
      secondBatch.items.filter((item: { id: string }) =>
        item.id.startsWith("inbox:"),
      ),
    ).toHaveLength(1);
    expect(secondBatch.items[0].id).toBe("inbox:work-result:" + late.id);
    const gamma = submit("background gamma", "background");
    await finish(gamma.id);
    const failed = submit("failed main");
    await finish(failed.id, "failed");
    expect(
      JSON.parse(
        (
          service.store.db
            .prepare("SELECT data FROM context_batches WHERE work_id=?")
            .get(failed.id) as { data: string }
        ).data,
      ).status,
    ).toBe("applied");
    const recovered = submit("recovered main");
    expect((await finish(recovered.id)).answer).toBe("alpha,beta,gamma");
    expect(
      service.store.db
        .prepare(
          "SELECT message_id FROM context_membership WHERE graph_thread_id=? AND message_id=?",
        )
        .all(recovered.runId, "inbox:work-result:" + gamma.id),
    ).toHaveLength(1);
    expect(
      service.store.db.prepare("SELECT id FROM operations").all(),
    ).toHaveLength(0);
  } finally {
    release();
    await service.close();
    await fixture.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);
