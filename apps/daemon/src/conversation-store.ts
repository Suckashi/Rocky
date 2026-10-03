import { randomUUID } from "node:crypto";
import type { Store } from "./store.js";
import {
  RockyError,
  sequenceSchema,
  type Work,
} from "../../../packages/contracts/src/index.js";
import {
  conversationSchema,
  executionSessionSchema,
  conversationMessageSchema,
  conversationPageSchema,
  conversationViewSchema,
} from "../../../packages/contracts/src/conversation.js";
// Visible history is separate from graph state; this does not acknowledge an inbox checkpoint.
export class ConversationStore {
  constructor(private readonly store: Store) {}
  initialize() {
    this.store.db.exec(
      "CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,kind TEXT UNIQUE NOT NULL,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS execution_sessions(id TEXT PRIMARY KEY,work_id TEXT UNIQUE NOT NULL,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS conversation_history(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,conversation_id TEXT NOT NULL,work_id TEXT NOT NULL,data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS conversation_history_page ON conversation_history(conversation_id,sequence);",
    );
    const value = conversationSchema.parse({
      id: randomUUID(),
      assistantId: this.store.assistant().id,
      kind: "main",
      activeExecutionSessionId: null,
      revision: 1,
    });
    this.store.db
      .prepare("INSERT OR IGNORE INTO conversations VALUES(?,'main',?)")
      .run(value.id, JSON.stringify(value));
  }
  main() {
    const row = this.store.db
      .prepare("SELECT data FROM conversations WHERE kind='main'")
      .get() as { data: string };
    return conversationSchema.parse(JSON.parse(row.data));
  }
  view() {
    const page = this.page();
    const row = page.conversation.activeExecutionSessionId
      ? (this.store.db
          .prepare("SELECT data FROM execution_sessions WHERE id=?")
          .get(page.conversation.activeExecutionSessionId) as
          { data: string } | undefined)
      : undefined;
    if (page.conversation.activeExecutionSessionId && !row)
      throw new RockyError(
        "session_projection_missing",
        "Active execution session is missing",
        500,
      );
    return conversationViewSchema.parse({
      ...page.conversation,
      activeSession: row
        ? executionSessionSchema.parse(JSON.parse(row.data))
        : null,
      messages: page.messages,
      cursor: page.messages.at(-1)?.sequence ?? "0",
      nextCursor: page.nextCursor,
    });
  }
  session(workId: string) {
    const row = this.store.db
      .prepare("SELECT data FROM execution_sessions WHERE work_id=?")
      .get(workId) as { data: string } | undefined;
    if (!row)
      throw new RockyError("not_found", "Execution session not found", 404);
    return executionSessionSchema.parse(JSON.parse(row.data));
  }
  register(work: Work, recordSubmission = true) {
    const session = executionSessionSchema.parse({
      id: work.executionSessionId,
      conversationId: this.main().id,
      workId: work.id,
      kind:
        work.runMode === "evaluation" ? "evaluation" : (work.kind ?? "main"),
      graphThreadId: work.runId,
      workspaceId: work.workspaceId ?? null,
      generation: 1,
      status: work.status,
    });
    this.store.db
      .prepare("INSERT OR IGNORE INTO execution_sessions VALUES(?,?,?)")
      .run(session.id, work.id, JSON.stringify(session));
    if (recordSubmission)
      this.message(work, "submission", work.text, work.createdAt);
  }
  update(work: Work) {
    const session = this.session(work.id);
    session.status = work.status;
    this.store.db
      .prepare("UPDATE execution_sessions SET data=? WHERE id=?")
      .run(JSON.stringify(executionSessionSchema.parse(session)), session.id);
    if (session.kind !== "main") return;
    const conversation = this.main();
    const active = ["running", "waiting_approval"].includes(work.status);
    if (active && conversation.activeExecutionSessionId === null)
      conversation.activeExecutionSessionId = session.id;
    else if (!active && conversation.activeExecutionSessionId === session.id)
      conversation.activeExecutionSessionId = null;
    else return;
    const expected = conversation.revision++;
    if (
      this.store.db
        .prepare(
          "UPDATE conversations SET data=? WHERE id=? AND json_extract(data,'$.revision')=?",
        )
        .run(JSON.stringify(conversation), conversation.id, expected)
        .changes !== 1
    )
      throw new RockyError(
        "revision_conflict",
        "Conversation revision changed",
        409,
      );
  }
  message(
    work: Work,
    source: "submission" | "work_result",
    text: string,
    createdAt: string,
  ) {
    if (work.runMode !== "normal") return;
    const base = conversationMessageSchema.omit({ sequence: true }).parse({
      id:
        source === "submission"
          ? "user-request:" + work.requestId
          : "work-result:" + work.id,
      conversationId: this.main().id,
      workId: work.id,
      runId: work.runId,
      executionSessionId: work.executionSessionId,
      role: source === "submission" ? "user" : "assistant",
      source,
      text: this.store.publicEvidence(text),
      status: work.status,
      ...(work.error ? { error: this.store.publicEvidence(work.error) } : {}),
      createdAt,
    });
    this.store.db
      .prepare(
        "INSERT OR IGNORE INTO conversation_history(id,conversation_id,work_id,data) VALUES(?,?,?,?)",
      )
      .run(base.id, base.conversationId, work.id, JSON.stringify(base));
  }
  page(before?: string, limit = 50) {
    if (before !== undefined && !sequenceSchema.safeParse(before).success)
      throw new RockyError("invalid_cursor", "Invalid history cursor");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new RockyError("invalid_limit", "History limit must be 1–100");
    const conversation = this.main();
    const rows = this.store.db
      .prepare(
        "SELECT CAST(sequence AS TEXT) AS sequence,data FROM conversation_history WHERE conversation_id=? AND (? IS NULL OR sequence < ?) ORDER BY conversation_history.sequence DESC LIMIT ?",
      )
      .all(conversation.id, before ?? null, before ?? null, limit + 1) as {
      sequence: string;
      data: string;
    }[];
    const messages = rows
      .slice(0, limit)
      .map((row) =>
        conversationMessageSchema.parse(
          this.store.publicEvidence({
            ...JSON.parse(row.data),
            sequence: row.sequence,
          }),
        ),
      )
      .reverse();
    return conversationPageSchema.parse({
      conversation,
      messages,
      nextCursor: rows.length > limit ? messages[0]!.sequence : null,
    });
  }
}
