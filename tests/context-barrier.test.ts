import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { HumanMessage } from "@langchain/core/messages";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { Store } from "../apps/daemon/src/store.js";
import {
  ContextLedger,
  contextMarker,
} from "../apps/daemon/src/context-ledger.js";
import { createRockyAgent } from "../packages/agent-runtime/src/factory.js";
import type { Work } from "../packages/contracts/src/index.js";
function work(kind: "main" | "background"): Work {
  return {
    id: randomUUID(),
    runId: randomUUID(),
    executionSessionId: randomUUID(),
    requestId: randomUUID(),
    text: "barrier fixture",
    kind,
    transport: "stdio",
    mode: "fixture",
    runMode: "normal",
    status: "running",
    revision: 1,
    answer: "",
    createdAt: new Date().toISOString(),
  };
}
test("context ack cannot precede own native checkpoint and domain fault rolls back all membership/receipt writes", async () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-context-barrier-"));
  const store = new Store(root),
    ledger = new ContextLedger(store);
  const saver = SqliteSaver.fromConnString(
    join(root, "graph-checkpoints.sqlite"),
  );
  try {
    const background = work("background");
    store.add(background, "bg");
    background.status = "completed";
    background.answer = "漢字🙂".repeat(4500);
    background.revision++;
    store.save(background, 1);
    store.event(background, "rocky.work.updated", { work: background });
    store.dispatchOutbox(() => {});
    const main = work("main");
    store.add(main, "main");
    const batch = ledger.prepare(main);
    expect(ledger.prepare(main).id).toBe(batch.id);
    await expect(
      ledger.acknowledge(main, batch.id, randomUUID()),
    ).rejects.toThrow(/incomplete/);
    expect(() => ledger.read(main, batch.id, 1, 0)).toThrow(/cursor/);
    const other = work("main");
    store.add(other, "other");
    expect(() => ledger.read(other, batch.id, 0, 0)).toThrow(
      /another execution/,
    );
    let index = 0,
      offset = 0,
      reconstructed = "";
    for (;;) {
      const part = ledger.read(main, batch.id, index, offset);
      if (part.done) break;
      expect(Buffer.byteLength(part.text!)).toBeLessThanOrEqual(8192);
      expect(part.text).not.toContain("�");
      reconstructed += part.text;
      index = part.nextIndex!;
      offset = part.nextOffset!;
    }
    expect(reconstructed).toBe(
      batch.items.map((item) => item.content).join(""),
    );
    await expect(
      ledger.acknowledge(main, batch.id, randomUUID()),
    ).rejects.toThrow(/claimed native checkpoint/);
    const agent = createRockyAgent(saver, {
      event: () => {},
      call: async () => {
        throw Error("No tools in checkpoint proof");
      },
    });
    const messages = [
      ...batch.items.map(
        (item) => new HumanMessage({ id: item.id, content: item.content }),
      ),
      new HumanMessage({
        id: "context-batch:" + batch.id,
        content: contextMarker(batch),
      }),
    ];
    await agent.updateState(
      { configurable: { thread_id: other.runId } },
      { messages },
    );
    const foreign = await saver.getTuple({
      configurable: { thread_id: other.runId },
    });
    await expect(
      ledger.acknowledge(main, batch.id, foreign!.checkpoint.id),
    ).rejects.toThrow(/claimed native checkpoint/);
    await agent.updateState(
      { configurable: { thread_id: main.runId } },
      { messages },
    );
    const saved = await saver.getTuple({
      configurable: { thread_id: main.runId },
    });
    store.db.exec(
      "CREATE TRIGGER fail_context_ack BEFORE INSERT ON events WHEN json_extract(NEW.data,'$.payload.name')='rocky.context.checkpointed' BEGIN SELECT RAISE(ABORT,'injected context ack failure'); END;",
    );
    await expect(
      ledger.acknowledge(main, batch.id, saved!.checkpoint.id),
    ).rejects.toThrow(/injected/);
    expect(
      JSON.parse(
        (
          store.db
            .prepare("SELECT data FROM context_batches WHERE id=?")
            .get(batch.id) as { data: string }
        ).data,
      ).status,
    ).toBe("staged");
    expect(
      store.db.prepare("SELECT * FROM context_membership").all(),
    ).toHaveLength(0);
    store.db.exec("DROP TRIGGER fail_context_ack");
    const receipt = await ledger.acknowledge(
      main,
      batch.id,
      saved!.checkpoint.id,
    );
    expect(receipt.status).toBe("applied");
    expect(
      await ledger.acknowledge(main, batch.id, saved!.checkpoint.id),
    ).toEqual(receipt);
    expect(
      store
        .events()
        .filter(
          (event) =>
            event.payload.kind === "domain" &&
            event.payload.name === "rocky.context.checkpointed",
        ),
    ).toHaveLength(1);
    expect(store.get(main.id).status).toBe("running");
  } finally {
    saver.db.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
