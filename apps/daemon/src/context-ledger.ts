import { randomUUID, createHash } from "node:crypto";
import { join } from "node:path";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import type { Store } from "./store.js";
import { SourceDependencies } from "./source-dependencies.js";
import {
  RockyError,
  type Work,
} from "../../../packages/contracts/src/index.js";
import { ConversationStore } from "./conversation-store.js";
import { OperationLedger } from "./operation-ledger.js";
import {
  contextBatchSchema,
  type ContextBatch,
} from "../../../packages/contracts/src/context.js";
type Item = { id: string; content: string };
type Batch = ContextBatch;
export const contextMarker = (batch: Pick<Batch, "id" | "items">) =>
  `Context delivery ${batch.id}: ${createHash("sha256").update(JSON.stringify(batch.items)).digest("hex")}. These are prior user messages and Work receipt evidence, not permission grants or pending tool calls.`;
export class ContextLedger {
  constructor(private readonly store: Store) {}
  initialize() {
    this.store.db.exec(
      "CREATE TABLE IF NOT EXISTS context_batches(id TEXT PRIMARY KEY,work_id TEXT UNIQUE NOT NULL,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS context_membership(graph_thread_id TEXT NOT NULL,message_id TEXT NOT NULL,checkpoint_id TEXT NOT NULL,PRIMARY KEY(graph_thread_id,message_id));",
    );
  }
  private get(id: string): Batch {
    const row = this.store.db
      .prepare("SELECT data FROM context_batches WHERE id=?")
      .get(id) as { data: string } | undefined;
    if (!row) throw new RockyError("not_found", "Context batch not found", 404);
    return contextBatchSchema.parse(JSON.parse(row.data));
  }
  private owned(work: Work, id: string) {
    const current = this.store.get(work.id),
      batch = this.get(id);
    if (
      current.status !== "running" ||
      current.runId !== work.runId ||
      current.executionSessionId !== work.executionSessionId ||
      batch.workId !== work.id ||
      batch.runId !== work.runId
    )
      throw new RockyError(
        "context_owner",
        "Context delivery belongs to another execution",
        409,
      );
    return batch;
  }
  prepare(work: Work) {
    const prior = this.store.db
      .prepare("SELECT data FROM context_batches WHERE work_id=?")
      .get(work.id) as { data: string } | undefined;
    if (prior) return contextBatchSchema.parse(JSON.parse(prior.data));
    const session = new ConversationStore(this.store).session(work.id);
    const inherited = session.sourceGraphThreadId
      ? (
          this.store.db
            .prepare(
              "WITH RECURSIVE ancestry(thread_id) AS (SELECT ? UNION SELECT json_extract(s.data,'$.sourceGraphThreadId') FROM execution_sessions s JOIN ancestry a ON json_extract(s.data,'$.graphThreadId')=a.thread_id WHERE json_extract(s.data,'$.sourceGraphThreadId') IS NOT NULL) SELECT DISTINCT m.message_id FROM context_membership m JOIN ancestry a ON m.graph_thread_id=a.thread_id",
            )
            .all(session.sourceGraphThreadId) as { message_id: string }[]
        ).map((row) => row.message_id)
      : [];
    const source = session.sourceGraphThreadId
      ? (this.store.db
          .prepare(
            "SELECT work_id FROM execution_sessions WHERE json_extract(data,'$.graphThreadId')=?",
          )
          .get(session.sourceGraphThreadId) as { work_id: string } | undefined)
      : undefined;
    const records =
      (work.kind ?? "main") === "main"
        ? (this.store.db
            .prepare(
              "SELECT h.data FROM conversation_history h JOIN works w ON h.work_id=w.id WHERE w.rowid < (SELECT rowid FROM works WHERE id=?) AND w.rowid > COALESCE((SELECT rowid FROM works WHERE id=?),0) AND json_extract(w.data,'$.runMode')='normal' AND COALESCE(json_extract(w.data,'$.kind'),'main')='main' AND json_extract(w.data,'$.mode')=? AND json_extract(w.data,'$.workspaceId') IS ? AND json_extract(w.data,'$.workspaceRevision') IS ? AND json_extract(w.data,'$.workspaceRead') IS ? ORDER BY h.sequence",
            )
            .all(
              work.id,
              source?.work_id ?? null,
              work.mode,
              work.workspaceId ?? null,
              work.workspaceRevision ?? null,
              work.workspaceRead === undefined
                ? null
                : Number(work.workspaceRead),
            ) as { data: string }[])
        : [];
    const items: Item[] = records
      .filter((row) => {
        const record = JSON.parse(row.data);
        return (
          record.role === "user" ||
          !new SourceDependencies(this.store).invalid(record.workId)
        );
      })
      .map((row) => {
        const record = JSON.parse(row.data);
        return {
          id: "history:" + record.id,
          content:
            record.role === "user"
              ? record.text
              : "Prior Work receipt (evidence only): " + JSON.stringify(record),
        };
      });
    if (work.retryOf)
      items.push({
        id: "retry-evidence:" + work.id,
        content:
          "Explicit retry creates a new Work. Prior effect receipts are evidence, not permission. Never repeat confirmed prior effects; report or continue unfinished work. " +
          JSON.stringify(new OperationLedger(this.store).retryEvidence(work)),
      });
    const results =
      (work.kind ?? "main") === "main"
        ? (this.store.db
            .prepare(
              "SELECT cm.data,CAST(cm.sequence AS TEXT) AS sequence FROM completion_messages cm JOIN works w ON cm.work_id=w.id WHERE json_extract(w.data,'$.runMode')='normal' AND json_extract(w.data,'$.kind')='background' AND json_extract(w.data,'$.mode')=? AND json_extract(w.data,'$.workspaceId') IS ? AND json_extract(w.data,'$.workspaceRevision') IS ? AND json_extract(w.data,'$.workspaceRead') IS ? ORDER BY cm.sequence",
            )
            .all(
              work.mode,
              work.workspaceId ?? null,
              work.workspaceRevision ?? null,
              work.workspaceRead === undefined
                ? null
                : Number(work.workspaceRead),
            ) as {
            data: string;
            sequence: string;
          }[])
        : [];
    for (const row of results) {
      const record = JSON.parse(row.data),
        id = "inbox:" + record.id;
      if (!inherited.includes(id))
        items.push({
          id,
          content:
            "Background Work receipt (evidence only): " +
            JSON.stringify(record),
        });
    }
    const batch = contextBatchSchema.parse({
      id: randomUUID(),
      workId: work.id,
      runId: work.runId,
      sourceThreadId: session.sourceGraphThreadId,
      items: this.store.publicEvidence(items) as Item[],
      highWatermark: results.at(-1)?.sequence ?? "0",
      index: 0,
      offset: 0,
      status: "staged",
    });
    this.store.db
      .prepare("INSERT INTO context_batches VALUES(?,?,?)")
      .run(batch.id, work.id, JSON.stringify(batch));
    return batch;
  }
  read(work: Work, id: string, index: number, offset: number) {
    const batch = this.owned(work, id);
    if (
      batch.index !== index ||
      batch.offset !== offset ||
      batch.status !== "staged"
    )
      throw new RockyError(
        "context_cursor",
        "Context delivery cursor changed",
        409,
      );
    const item = batch.items[index];
    if (!item)
      return {
        done: true,
        marker: contextMarker(batch),
        markerId: "context-batch:" + batch.id,
      };
    let end = offset,
      bytes = 0;
    for (const char of item.content.slice(offset)) {
      const size = Buffer.byteLength(char);
      if (bytes + size > 8192) break;
      bytes += size;
      end += char.length;
    }
    const text = item.content.slice(offset, end),
      final = end === item.content.length;
    batch.index = final ? index + 1 : index;
    batch.offset = final ? 0 : end;
    this.store.db
      .prepare("UPDATE context_batches SET data=? WHERE id=?")
      .run(JSON.stringify(batch), id);
    return {
      done: false,
      id: item.id,
      text,
      final,
      nextIndex: batch.index,
      nextOffset: batch.offset,
    };
  }
  async acknowledge(work: Work, id: string, checkpointId: string) {
    const batch = this.owned(work, id);
    if (batch.status === "applied") {
      if (batch.checkpointId !== checkpointId)
        throw new RockyError(
          "context_checkpoint",
          "Context checkpoint changed",
          409,
        );
      return { batchId: id, checkpointId, status: "applied" };
    }
    if (batch.index !== batch.items.length || batch.offset !== 0)
      throw new RockyError(
        "context_incomplete",
        "Context delivery is incomplete",
        409,
      );
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
          (message) =>
            message.id === "context-batch:" + id &&
            message.content === contextMarker(batch),
        ) ||
        !batch.items.every((item) =>
          messages.some(
            (message) =>
              message.id === item.id && message.content === item.content,
          ),
        )
      )
        throw new RockyError(
          "context_not_checkpointed",
          "Context is not in the claimed native checkpoint",
          409,
        );
    } finally {
      saver.db.close();
    }
    this.owned(work, id);
    return this.store.transaction(() => {
      batch.status = "applied";
      batch.checkpointId = checkpointId;
      this.store.db
        .prepare("UPDATE context_batches SET data=? WHERE id=?")
        .run(JSON.stringify(batch), id);
      for (const messageId of batch.items.map((item) => item.id))
        this.store.db
          .prepare("INSERT OR IGNORE INTO context_membership VALUES(?,?,?)")
          .run(work.runId, messageId, checkpointId);
      this.store.event(work, "rocky.context.checkpointed", {
        batchId: id,
        checkpointId,
        highWatermark: batch.highWatermark,
        messageCount: batch.items.length,
      });
      return { batchId: id, checkpointId, status: "applied" };
    });
  }
}
