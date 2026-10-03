import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  assistantSchema,
  ROCKY_IDENTITY,
} from "../../../packages/contracts/src/assistant.js";
import {
  RockyError,
  workSchema,
  publicEventSchema,
  sequenceSchema,
  snapshotSchema,
  completionSchema,
  type Work,
  type PublicEvent,
} from "../../../packages/contracts/src/index.js";
import { acquireWriterLock } from "./writer-lock.js";
import { redactEvidence } from "./redaction.js";
import { ConversationStore } from "./conversation-store.js";
import { ContextLedger } from "./context-ledger.js";
import { SteeringStore } from "./steering.js";
export class Store {
  publicEvidence: (value: unknown) => unknown = redactEvidence;
  readonly db: DatabaseSync;
  readonly root: string;
  private releaseLock: () => void;
  private inTransaction = false;
  private closed = false;
  constructor(root: string) {
    this.root = resolve(root);
    mkdirSync(this.root, { recursive: true });
    const manifest = join(this.root, "manifest.json");
    if (existsSync(manifest)) {
      const m = JSON.parse(readFileSync(manifest, "utf8"));
      if (m.productId !== "rocky" || m.schemaVersion !== 1)
        throw new RockyError(
          "foreign_store",
          "Not a supported Rocky store",
          409,
        );
    } else {
      if (readdirSync(this.root).length)
        throw new RockyError(
          "foreign_store",
          "Refusing unknown nonempty data directory",
          409,
        );
      writeFileSync(
        manifest,
        JSON.stringify({
          productId: "rocky",
          schemaVersion: 1,
          createdAt: new Date().toISOString(),
        }),
      );
    }
    this.releaseLock = acquireWriterLock(this.root);
    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(join(this.root, "domain.sqlite"));
      this.db = database;
      const version = (
        this.db.prepare("PRAGMA user_version").get() as { user_version: number }
      ).user_version;
      if (version > 24)
        throw new RockyError(
          "unsupported_store",
          "Rocky store version is newer than this application",
          409,
        );
      this.db.exec(
        "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS works(id TEXT PRIMARY KEY, request_id TEXT UNIQUE, intent TEXT NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, args_hash TEXT NOT NULL, outcome TEXT NOT NULL, result TEXT); CREATE TABLE IF NOT EXISTS decisions(request_id TEXT PRIMARY KEY, intent TEXT NOT NULL, work_id TEXT NOT NULL);",
      );
      this.db.exec(
        "CREATE TABLE IF NOT EXISTS stop_receipts(request_id TEXT PRIMARY KEY, intent TEXT NOT NULL, result TEXT NOT NULL)",
      );
      this.db.exec(
        "CREATE TABLE IF NOT EXISTS product_identity(key TEXT PRIMARY KEY, id TEXT NOT NULL)",
      );
      this.db
        .prepare("INSERT OR IGNORE INTO product_identity VALUES('assistant',?)")
        .run(randomUUID());
      if (version === 0)
        this.transaction(() => {
          // Upgrade only this product's P0 projection format, never a foreign store.
          for (const row of this.db
            .prepare("SELECT id,data FROM works")
            .all() as { id: string; data: string }[]) {
            const work = JSON.parse(row.data);
            work.executionSessionId ??= work.runId;
            work.runMode ??= "unknown";
            this.db
              .prepare("UPDATE works SET data=? WHERE id=?")
              .run(JSON.stringify(workSchema.parse(work)), work.id);
          }
          for (const row of this.db
            .prepare(
              "SELECT CAST(sequence AS TEXT) AS sequence,data FROM events",
            )
            .all() as { sequence: string; data: string }[]) {
            const old = JSON.parse(row.data);
            if (!old.payload) {
              const { name, data, ...envelope } = old;
              if (name === "rocky.work.updated") {
                data.work.executionSessionId ??= data.work.runId;
                data.work.runMode ??= "unknown";
              }
              const event = publicEventSchema.parse({
                ...envelope,
                sequence: row.sequence,
                payload: { kind: "domain", name, data },
              });
              this.db
                .prepare("UPDATE events SET data=? WHERE sequence=?")
                .run(JSON.stringify(event), row.sequence);
            }
          }
          this.db.exec("PRAGMA user_version=1");
        });
      if (version < 2)
        this.transaction(() => {
          this.db.exec(
            "CREATE TABLE IF NOT EXISTS outbox(event_id TEXT PRIMARY KEY, sequence INTEGER UNIQUE NOT NULL REFERENCES events(sequence), delivered_at TEXT); CREATE TABLE IF NOT EXISTS completion_messages(id TEXT PRIMARY KEY, work_id TEXT UNIQUE NOT NULL, sequence INTEGER UNIQUE NOT NULL, data TEXT NOT NULL)",
          );
          this.db.exec(
            "INSERT OR IGNORE INTO outbox(event_id,sequence) SELECT json_extract(data,'$.id'),sequence FROM events; PRAGMA user_version=2",
          );
        });
      if (version < 3)
        this.transaction(() => {
          this.db.exec(
            "CREATE TABLE IF NOT EXISTS model_connections(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS model_receipts(request_id TEXT PRIMARY KEY, intent TEXT NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS model_probes(id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, data TEXT NOT NULL); PRAGMA user_version=3",
          );
        });
      if (version < 4)
        this.transaction(() => {
          this.db.exec(
            "CREATE TABLE IF NOT EXISTS model_budgets(run_id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS model_usage(run_id TEXT NOT NULL,request_id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(run_id,request_id)); PRAGMA user_version=4",
          );
        });
      if (version < 5)
        this.transaction(() => {
          const columns = this.db
            .prepare("PRAGMA table_info(operations)")
            .all() as { name: string }[];
          if (!columns.some((c) => c.name === "phase")) {
            this.db.exec(
              "ALTER TABLE operations ADD COLUMN phase TEXT NOT NULL DEFAULT 'dispatched'; ALTER TABLE operations ADD COLUMN context TEXT; ALTER TABLE operations ADD COLUMN revision INTEGER NOT NULL DEFAULT 1; UPDATE operations SET phase='settled' WHERE outcome='succeeded'",
            );
          }
          this.db.exec("PRAGMA user_version=5");
        });
      if (version < 6)
        this.transaction(() => {
          this.db.exec(
            "CREATE TABLE IF NOT EXISTS operation_reconciliations(request_id TEXT PRIMARY KEY,intent TEXT NOT NULL,data TEXT NOT NULL); PRAGMA user_version=6",
          );
        });
      if (version < 7)
        this.transaction(() => {
          this.db.exec(
            "CREATE TABLE IF NOT EXISTS capability_grants(id TEXT PRIMARY KEY,request_id TEXT UNIQUE NOT NULL,intent TEXT NOT NULL,data TEXT NOT NULL); PRAGMA user_version=7",
          );
        });
      if (version < 8)
        this.transaction(() => {
          this.db.exec(
            "CREATE TABLE IF NOT EXISTS grant_receipts(request_id TEXT PRIMARY KEY,intent TEXT NOT NULL,data TEXT NOT NULL); PRAGMA user_version=8",
          );
        });
      if (version < 9)
        this.transaction(() => {
          this.db.exec(
            "CREATE TABLE IF NOT EXISTS target_claims(target_identity TEXT PRIMARY KEY,operation_id TEXT UNIQUE NOT NULL); PRAGMA user_version=9",
          );
        });
      if (version < 10)
        this.transaction(() => {
          this.db.exec(
            "CREATE TABLE IF NOT EXISTS worker_jobs(id TEXT PRIMARY KEY,work_id TEXT NOT NULL,run_id TEXT NOT NULL,execution_session_id TEXT NOT NULL,status TEXT NOT NULL,pid INTEGER,started_at TEXT NOT NULL,ended_at TEXT,exit_code INTEGER,error TEXT); CREATE UNIQUE INDEX IF NOT EXISTS worker_jobs_one_active_run ON worker_jobs(run_id) WHERE status IN ('starting','running'); PRAGMA user_version=10",
          );
        });
      if (version < 11)
        this.transaction(() => {
          const conversations = new ConversationStore(this);
          conversations.initialize();
          const history: {
            work: Work;
            source: "submission" | "work_result";
            text: string;
            createdAt: string;
          }[] = [];
          for (const work of this.list()) {
            conversations.register(work, false);
            conversations.update(work);
            history.push({
              work,
              source: "submission",
              text: work.text,
              createdAt: work.createdAt,
            });
          }
          for (const row of this.db
            .prepare("SELECT data FROM completion_messages ORDER BY sequence")
            .all() as { data: string }[]) {
            const completion = completionSchema.parse(JSON.parse(row.data));
            history.push({
              work: this.get(completion.workId),
              source: "work_result",
              text: completion.text,
              createdAt: completion.createdAt,
            });
          }
          history.sort(
            (a, b) =>
              a.createdAt.localeCompare(b.createdAt) ||
              (a.source === b.source
                ? a.work.id.localeCompare(b.work.id)
                : a.source === "submission"
                  ? -1
                  : 1),
          );
          for (const entry of history)
            conversations.message(
              entry.work,
              entry.source,
              entry.text,
              entry.createdAt,
            );
          this.db.exec("PRAGMA user_version=11");
        });
      if (version < 12)
        this.transaction(() => {
          new ContextLedger(this).initialize();
          this.db.exec("PRAGMA user_version=12");
        });
      if (version < 13)
        this.transaction(() => {
          new SteeringStore(this).initialize();
          this.db.exec("PRAGMA user_version=13");
        });
      if (version < 14)
        this.transaction(() => {
          this.db.exec(
            "CREATE TABLE IF NOT EXISTS mcp_config(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,hash TEXT NOT NULL,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS mcp_config_receipts(request_id TEXT PRIMARY KEY,intent TEXT NOT NULL,data TEXT NOT NULL); PRAGMA user_version=14",
          );
        });
      if (version < 15)
        this.transaction(() =>
          this.db.exec(
            "CREATE TABLE IF NOT EXISTS mcp_states(server_id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS mcp_lifecycle_receipts(request_id TEXT PRIMARY KEY,intent TEXT NOT NULL,status TEXT NOT NULL); CREATE TABLE IF NOT EXISTS mcp_catalog(server_id TEXT PRIMARY KEY,config_revision INTEGER NOT NULL,registry_revision INTEGER NOT NULL,data TEXT NOT NULL); PRAGMA user_version=15",
          ),
        );
      if (version < 16)
        this.transaction(() =>
          this.db.exec(
            "CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,root_key TEXT UNIQUE NOT NULL,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS workspace_receipts(request_id TEXT PRIMARY KEY,intent TEXT NOT NULL,data TEXT NOT NULL); PRAGMA user_version=16",
          ),
        );
      if (version < 17)
        this.transaction(() => {
          this.db.exec(
            "CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY,intent TEXT NOT NULL,data TEXT NOT NULL); PRAGMA user_version=17",
          );
        });
      if (version < 18)
        this.transaction(() =>
          this.db.exec(
            "CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS document_versions(document_id TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(document_id,revision)); CREATE TABLE IF NOT EXISTS document_blobs(hash TEXT PRIMARY KEY,content TEXT NOT NULL); CREATE TABLE IF NOT EXISTS document_receipts(request_id TEXT PRIMARY KEY,intent TEXT NOT NULL,document_id TEXT NOT NULL,revision INTEGER NOT NULL); PRAGMA user_version=18",
          ),
        );
      if (version < 19)
        this.transaction(() =>
          this.db.exec(
            "CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY,scope TEXT NOT NULL,data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS memories_scope ON memories(scope); CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(id UNINDEXED,content); CREATE TABLE IF NOT EXISTS memory_receipts(request_id TEXT PRIMARY KEY,intent TEXT NOT NULL,result TEXT NOT NULL); PRAGMA user_version=19",
          ),
        );
      if (version < 20)
        this.transaction(() => {
          this.db.exec(
            "CREATE TABLE skill_heads(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE skill_revisions(id TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(id,revision)); CREATE TABLE skill_packages(hash TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE skill_import_receipts(request_id TEXT PRIMARY KEY,intent TEXT NOT NULL,result TEXT NOT NULL); PRAGMA user_version=20;",
          );
        });
      if (version < 21)
        this.transaction(() => {
          this.db.exec(
            "CREATE TABLE skill_selections(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE skill_selection_receipts(request_id TEXT PRIMARY KEY,intent TEXT NOT NULL,result TEXT NOT NULL); CREATE TABLE skill_quarantine(id TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(id,hash)); PRAGMA user_version=21;",
          );
        });
      if (version < 22)
        this.transaction(() =>
          this.db.exec(
            "CREATE TABLE skill_catalogs(work_id TEXT PRIMARY KEY,data TEXT NOT NULL); PRAGMA user_version=22;",
          ),
        );
      if (version < 23)
        this.transaction(() =>
          this.db.exec(
            "CREATE TABLE IF NOT EXISTS learning_policy(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS learning_policy_receipts(request_id TEXT PRIMARY KEY,intent TEXT NOT NULL,result TEXT NOT NULL); PRAGMA user_version=23;",
          ),
        );
      if (version < 24)
        this.transaction(() =>
          this.db.exec(
            "CREATE TABLE IF NOT EXISTS learning_work_consent(work_id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS learning_work_receipts(request_id TEXT PRIMARY KEY,intent TEXT NOT NULL,result TEXT NOT NULL); PRAGMA user_version=24;",
          ),
        );
    } catch (error) {
      database?.close();
      this.releaseLock();
      throw error;
    }
  }
  transaction<T>(fn: () => T): T {
    if (this.inTransaction)
      throw new RockyError(
        "nested_transaction",
        "Nested domain transaction is not allowed",
        500,
      );
    this.db.exec("BEGIN IMMEDIATE");
    this.inTransaction = true;
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }
  list(): Work[] {
    return (
      this.db.prepare("SELECT data FROM works ORDER BY rowid").all() as {
        data: string;
      }[]
    ).map((r) => workSchema.parse(JSON.parse(r.data)));
  }
  get(id: string): Work {
    const row = this.db.prepare("SELECT data FROM works WHERE id=?").get(id) as
      { data: string } | undefined;
    if (!row) throw new RockyError("not_found", "Work not found", 404);
    return workSchema.parse(JSON.parse(row.data));
  }
  receipt(requestId: string) {
    return this.db
      .prepare("SELECT id,intent,data FROM works WHERE request_id=?")
      .get(requestId) as
      { id: string; intent: string; data: string } | undefined;
  }
  add(work: Work, intent: string): void {
    if (!this.inTransaction)
      return this.transaction(() => this.add(work, intent));
    this.db
      .prepare("INSERT INTO works VALUES(?,?,?,?)")
      .run(
        work.id,
        work.requestId,
        intent,
        JSON.stringify(workSchema.parse(work)),
      );
    new ConversationStore(this).register(work);
  }
  save(work: Work, expectedRevision: number): void {
    if (!this.inTransaction)
      return this.transaction(() => this.save(work, expectedRevision));
    if (
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 1 ||
      work.revision !== expectedRevision + 1
    )
      throw new RockyError(
        "revision_conflict",
        "Work revision must advance exactly once",
        409,
      );
    const result = this.db
      .prepare(
        "UPDATE works SET data=? WHERE id=? AND json_extract(data,'$.revision')=? AND request_id=? AND json_extract(data,'$.runId')=? AND json_extract(data,'$.executionSessionId')=? AND json_extract(data,'$.text')=? AND json_extract(data,'$.transport')=? AND json_extract(data,'$.mode')=? AND json_extract(data,'$.kind') IS ? AND json_extract(data,'$.workspaceId') IS ? AND json_extract(data,'$.workspaceRevision') IS ? AND json_extract(data,'$.workspaceRead') IS ? AND json_extract(data,'$.wallBudgetMs') IS ? AND json_extract(data,'$.runMode')=? AND json_extract(data,'$.modelSelection.connectionId') IS ? AND json_extract(data,'$.modelSelection.revision') IS ? AND json_extract(data,'$.modelBudget') IS ? AND json_extract(data,'$.retryOf') IS ? AND json_extract(data,'$.retryEffectRefs') IS ?",
      )
      .run(
        JSON.stringify(workSchema.parse(work)),
        work.id,
        expectedRevision,
        work.requestId,
        work.runId,
        work.executionSessionId,
        work.text,
        work.transport,
        work.mode,
        work.kind ?? null,
        work.workspaceId ?? null,
        work.workspaceRevision ?? null,
        work.workspaceRead === undefined ? null : Number(work.workspaceRead),
        work.wallBudgetMs ?? null,
        work.runMode,
        work.modelSelection?.connectionId ?? null,
        work.modelSelection?.revision ?? null,
        work.modelBudget ? JSON.stringify(work.modelBudget) : null,
        work.retryOf ?? null,
        work.retryEffectRefs ? JSON.stringify(work.retryEffectRefs) : null,
      );
    if (result.changes !== 1)
      throw new RockyError("revision_conflict", "Work revision changed", 409);
    new ConversationStore(this).update(work);
  }
  event(work: Work, name: string, data: Record<string, unknown>): PublicEvent {
    if (!this.inTransaction)
      return this.transaction(() => this.event(work, name, data));
    const historyRefs =
      name === "rocky.work.updated"
        ? this.db
            .prepare(
              "SELECT id,CAST(sequence AS TEXT) AS sequence,work_id AS workId FROM conversation_history WHERE work_id=? ORDER BY conversation_history.sequence DESC LIMIT 2",
            )
            .all(work.id)
        : undefined;
    const base = publicEventSchema.omit({ sequence: true }).parse({
      schemaVersion: 1 as const,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      workId: work.id,
      runId: work.runId,
      executionSessionId: work.executionSessionId,
      payload: {
        kind: "domain",
        name,
        data: this.publicEvidence({
          ...data,
          ...(historyRefs ? { historyRefs } : {}),
        }),
      },
    });
    this.db
      .prepare("INSERT INTO events(data) VALUES(?)")
      .run(JSON.stringify(base));
    const { sequence } = this.db
      .prepare("SELECT CAST(last_insert_rowid() AS TEXT) AS sequence")
      .get() as { sequence: string };
    this.db
      .prepare("INSERT INTO outbox(event_id,sequence) VALUES(?,?)")
      .run(base.id, sequence);
    return publicEventSchema.parse({
      ...base,
      sequence,
    });
  }
  events(after = "0", workId?: string): PublicEvent[] {
    if (!sequenceSchema.safeParse(after).success)
      throw new RockyError("invalid_cursor", "Invalid cursor");
    return (
      this.db
        .prepare(
          workId === undefined
            ? "SELECT CAST(sequence AS TEXT) AS sequence,data FROM events WHERE sequence>? ORDER BY events.sequence LIMIT 1000"
            : "SELECT CAST(sequence AS TEXT) AS sequence,data FROM events WHERE sequence>? AND json_extract(data,'$.workId')=? ORDER BY events.sequence LIMIT 1000",
        )
        .all(...(workId === undefined ? [after] : [after, workId])) as {
        sequence: string;
        data: string;
      }[]
    ).map((r) =>
      publicEventSchema.parse({ ...JSON.parse(r.data), sequence: r.sequence }),
    );
  }
  eventsForWork(workId: string): PublicEvent[] {
    return (
      this.db
        .prepare(
          "SELECT CAST(sequence AS TEXT) AS sequence, data FROM events WHERE json_extract(data, '$.workId')=? ORDER BY events.sequence",
        )
        .all(workId) as { sequence: string; data: string }[]
    ).map((row) =>
      publicEventSchema.parse({
        ...JSON.parse(row.data),
        sequence: row.sequence,
      }),
    );
  }
  snapshot() {
    return this.transaction(() => {
      const { cursor } = this.db
        .prepare(
          "SELECT CAST(COALESCE(MAX(sequence),0) AS TEXT) AS cursor FROM events",
        )
        .get() as { cursor: string };
      const rows = this.db
        .prepare(
          "SELECT CAST(sequence AS TEXT) AS sequence,data FROM (SELECT sequence,data FROM events ORDER BY sequence DESC LIMIT 500) AS recent ORDER BY recent.sequence",
        )
        .all() as { sequence: string; data: string }[];
      return snapshotSchema.parse({
        schemaVersion: 1,
        cursor,
        works: this.list(),
        events: rows.map((row) => ({
          ...JSON.parse(row.data),
          sequence: row.sequence,
        })),
      });
    });
  }
  assistant() {
    const row = this.db
      .prepare("SELECT id FROM product_identity WHERE key='assistant'")
      .get() as { id: string };
    return assistantSchema.parse({ id: row.id, ...ROCKY_IDENTITY });
  }
  dispatchOutbox(deliver: (event: PublicEvent) => void, limit = 100) {
    if (this.inTransaction)
      throw new RockyError(
        "uncommitted_delivery",
        "Cannot deliver before commit",
        500,
      );
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw new RockyError(
        "invalid_limit",
        "Outbox batch limit must be 1–1000",
      );
    const rows = this.db
      .prepare(
        "SELECT CAST(e.sequence AS TEXT) AS sequence,e.data FROM outbox o JOIN events e ON e.sequence=o.sequence WHERE o.delivered_at IS NULL ORDER BY o.sequence LIMIT ?",
      )
      .all(limit) as { sequence: string; data: string }[];
    for (const row of rows) {
      const event = publicEventSchema.parse({
        ...JSON.parse(row.data),
        sequence: row.sequence,
      });
      // Delivery can be repeated after a crash; the callback must never execute tools.
      deliver(event);
      this.transaction(() => {
        if (
          event.payload.kind === "domain" &&
          event.payload.name === "rocky.work.updated"
        ) {
          const work = workSchema.parse(event.payload.data.work);
          if (
            [
              "completed",
              "failed",
              "cancelled",
              "blocked",
              "interrupted",
            ].includes(work.status)
          ) {
            const message = completionSchema.parse({
              id: "work-result:" + work.id,
              workId: work.id,
              runId: work.runId,
              sequence: row.sequence,
              status: work.status,
              text: work.answer,
              error: work.error,
              createdAt: event.timestamp,
            });
            this.db
              .prepare(
                "INSERT OR IGNORE INTO completion_messages VALUES(?,?,?,?)",
              )
              .run(message.id, work.id, row.sequence, JSON.stringify(message));
            new ConversationStore(this).message(
              work,
              "work_result",
              message.text,
              message.createdAt,
            );
          }
        }
        this.db
          .prepare("UPDATE outbox SET delivered_at=? WHERE event_id=?")
          .run(new Date().toISOString(), event.id);
      });
    }
    return rows.length;
  }
  completions(before?: string, limit = 50) {
    if (before !== undefined && !sequenceSchema.safeParse(before).success)
      throw new RockyError("invalid_cursor", "Invalid cursor");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new RockyError("invalid_limit", "Message limit must be 1–100");
    const rows = this.db
      .prepare(
        "SELECT data FROM completion_messages WHERE (? IS NULL OR sequence < ?) ORDER BY sequence DESC LIMIT ?",
      )
      .all(before ?? null, before ?? null, limit + 1) as { data: string }[];
    const messages = rows
      .slice(0, limit)
      .map((row) => completionSchema.parse(JSON.parse(row.data)));
    return {
      messages: messages.reverse(),
      nextCursor: rows.length > limit ? messages[0]!.sequence : null,
    };
  }
  pendingDeliveries() {
    return (
      this.db
        .prepare(
          "SELECT count(*) AS count FROM outbox WHERE delivered_at IS NULL",
        )
        .get() as { count: number }
    ).count;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.db.close();
    } finally {
      this.releaseLock();
    }
  }
}
