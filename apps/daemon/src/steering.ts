import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import {
  RockyError,
  type Work,
} from "../../../packages/contracts/src/index.js";
import {
  steerCommandSchema,
  steeringReceiptSchema,
  type SteeringReceipt,
} from "../../../packages/contracts/src/steering.js";
import type { Store } from "./store.js";
import { intentHash } from "./intent.js";
import { ConversationStore } from "./conversation-store.js";
export class SteeringStore {
  constructor(private readonly store: Store) {}
  initialize() {
    this.store.db.exec(
      "CREATE TABLE IF NOT EXISTS steering(request_id TEXT PRIMARY KEY,work_id TEXT NOT NULL,intent TEXT NOT NULL,staged INTEGER NOT NULL DEFAULT 0,data TEXT NOT NULL)",
    );
  }
  list(workId: string): SteeringReceipt[] {
    return (
      this.store.db
        .prepare("SELECT data FROM steering WHERE work_id=? ORDER BY rowid")
        .all(workId) as { data: string }[]
    ).map((row) => steeringReceiptSchema.parse(JSON.parse(row.data)));
  }
  private save(receipt: SteeringReceipt) {
    this.store.db
      .prepare("UPDATE steering SET data=? WHERE request_id=?")
      .run(JSON.stringify(receipt), receipt.requestId);
    this.store.event(this.store.get(receipt.workId), "rocky.steering.updated", {
      receipt: this.store.publicEvidence(receipt),
    });
  }
  accept(workId: string, input: unknown) {
    const command = steerCommandSchema.parse(input),
      intent = intentHash({ workId, ...command });
    const prior = this.store.db
      .prepare("SELECT intent,data FROM steering WHERE request_id=?")
      .get(command.requestId) as { intent: string; data: string } | undefined;
    if (prior) {
      if (prior.intent !== intent)
        throw new RockyError(
          "idempotency_conflict",
          "Steering request changed",
          409,
        );
      return steeringReceiptSchema.parse(JSON.parse(prior.data));
    }
    const work = this.store.get(workId);
    if (
      work.runId !== command.runId ||
      work.executionSessionId !== command.executionSessionId ||
      work.revision !== command.expectedRevision
    )
      throw new RockyError(
        "stale_target",
        "Work run, session or revision changed",
        409,
      );
    if (
      !["running", "waiting_approval"].includes(work.status) ||
      work.runMode !== "normal"
    )
      throw new RockyError(
        "inactive_target",
        "Steering requires an active normal Work",
        409,
      );
    if (this.list(workId).filter((r) => r.status === "accepted").length >= 8)
      throw new RockyError(
        "steering_capacity",
        "Pending steering limit reached",
        429,
      );
    const receipt = steeringReceiptSchema.parse({
      ...command,
      id: randomUUID(),
      workId,
      status: "accepted",
      createdAt: new Date().toISOString(),
    });
    return this.store.transaction(() => {
      this.store.db
        .prepare(
          "INSERT INTO steering(request_id,work_id,intent,data) VALUES(?,?,?,?)",
        )
        .run(command.requestId, workId, intent, JSON.stringify(receipt));
      this.store.event(work, "rocky.steering.updated", {
        receipt: this.store.publicEvidence(receipt),
      });
      return receipt;
    });
  }
  private owned(work: Work) {
    const current = this.store.get(work.id);
    if (
      current.status !== "running" ||
      current.runId !== work.runId ||
      current.executionSessionId !== work.executionSessionId
    )
      throw new RockyError("stale_target", "Steering owner changed", 409);
    return current;
  }
  read(work: Work) {
    this.owned(work);
    const row = this.store.db
      .prepare(
        "SELECT data FROM steering WHERE work_id=? AND staged=0 AND json_extract(data,'$.status')='accepted' ORDER BY rowid LIMIT 1",
      )
      .get(work.id) as { data: string } | undefined;
    if (!row) return null;
    const receipt = steeringReceiptSchema.parse(JSON.parse(row.data));
    this.store.db
      .prepare("UPDATE steering SET staged=1 WHERE request_id=?")
      .run(receipt.requestId);
    return receipt;
  }
  async acknowledge(work: Work, id: string, checkpointId: string) {
    this.owned(work);
    const receipt = this.list(work.id).find((r) => r.id === id);
    if (!receipt)
      throw new RockyError("not_found", "Steering receipt not found", 404);
    if (receipt.status === "applied") {
      if (receipt.checkpointId !== checkpointId)
        throw new RockyError(
          "steering_checkpoint",
          "Steering checkpoint changed",
          409,
        );
      return receipt;
    }
    if (receipt.status !== "accepted")
      throw new RockyError("steering_state", "Steering is not applicable", 409);
    const saver = SqliteSaver.fromConnString(
      join(this.store.root, "graph-checkpoints.sqlite"),
    );
    try {
      const saved = await saver.getTuple({
        configurable: { thread_id: work.runId, checkpoint_id: checkpointId },
      });
      const messages = saved?.checkpoint.channel_values.messages as
        { id?: string; content?: unknown }[] | undefined;
      if (
        !messages?.some(
          (m) => m.id === "steer:" + id && m.content === receipt.text,
        )
      )
        throw new RockyError(
          "steering_not_checkpointed",
          "Steering is not in the owned native checkpoint",
          409,
        );
    } finally {
      saver.db.close();
    }
    this.owned(work);
    return this.store.transaction(() => {
      const current = this.list(work.id).find((r) => r.id === id)!;
      if (current.status === "applied") {
        if (current.checkpointId !== checkpointId)
          throw new RockyError(
            "steering_checkpoint",
            "Steering checkpoint changed",
            409,
          );
        return current;
      }
      if (current.status !== "accepted")
        throw new RockyError(
          "steering_state",
          "Steering is not applicable",
          409,
        );
      receipt.status = "applied";
      receipt.checkpointId = checkpointId;
      new ConversationStore(this.store).steering(work, receipt);
      this.save(receipt);
      return receipt;
    });
  }
  finish(work: Work) {
    // Called inside the Work lifecycle transaction; never open a nested transaction.
    for (const receipt of this.list(work.id).filter(
      (r) => r.status === "accepted",
    )) {
      receipt.status = "not_applied";
      receipt.reason =
        "Work " + work.status + " before a confirmed steering boundary";
      this.save(receipt);
    }
  }
}
