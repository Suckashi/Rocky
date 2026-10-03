import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  openSync,
  closeSync,
  unlinkSync,
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
  type Work,
  type PublicEvent,
} from "../../../packages/contracts/src/index.js";
export class Store {
  readonly db: DatabaseSync;
  readonly root: string;
  private lock: number;
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
    const lockPath = join(this.root, "daemon.lock");
    try {
      this.lock = openSync(lockPath, "wx");
      writeFileSync(this.lock, String(process.pid));
    } catch {
      let alive = true;
      try {
        const pid = Number(readFileSync(lockPath, "utf8"));
        if (!Number.isSafeInteger(pid) || pid < 1) throw Error("Invalid lock");
        process.kill(pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false;
      }
      if (alive)
        throw new RockyError(
          "store_locked",
          "Another daemon owns this data directory",
          409,
        );
      unlinkSync(lockPath);
      this.lock = openSync(lockPath, "wx");
      writeFileSync(this.lock, String(process.pid));
    }
    this.db = new DatabaseSync(join(this.root, "domain.sqlite"));
    try {
      const version = (
        this.db.prepare("PRAGMA user_version").get() as { user_version: number }
      ).user_version;
      if (version > 1)
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
            this.save(workSchema.parse(work));
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
    } catch (error) {
      this.db.close();
      closeSync(this.lock);
      unlinkSync(lockPath);
      throw error;
    }
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
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
  add(work: Work, intent: string) {
    this.db
      .prepare("INSERT INTO works VALUES(?,?,?,?)")
      .run(
        work.id,
        work.requestId,
        intent,
        JSON.stringify(workSchema.parse(work)),
      );
  }
  save(work: Work) {
    this.db
      .prepare("UPDATE works SET data=? WHERE id=?")
      .run(JSON.stringify(workSchema.parse(work)), work.id);
  }
  event(work: Work, name: string, data: Record<string, unknown>) {
    const base = publicEventSchema.omit({ sequence: true }).parse({
      schemaVersion: 1 as const,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      workId: work.id,
      runId: work.runId,
      executionSessionId: work.executionSessionId,
      payload: { kind: "domain", name, data },
    });
    this.db
      .prepare("INSERT INTO events(data) VALUES(?)")
      .run(JSON.stringify(base));
    const { sequence } = this.db
      .prepare("SELECT CAST(last_insert_rowid() AS TEXT) AS sequence")
      .get() as { sequence: string };
    return publicEventSchema.parse({
      ...base,
      sequence,
    });
  }
  events(after = "0"): PublicEvent[] {
    if (!sequenceSchema.safeParse(after).success)
      throw new RockyError("invalid_cursor", "Invalid cursor");
    return (
      this.db
        .prepare(
          "SELECT CAST(sequence AS TEXT) AS sequence,data FROM events WHERE sequence>? ORDER BY sequence LIMIT 1000",
        )
        .all(after) as { sequence: string; data: string }[]
    ).map((r) =>
      publicEventSchema.parse({ ...JSON.parse(r.data), sequence: r.sequence }),
    );
  }
  eventsForWork(workId: string): PublicEvent[] {
    return (
      this.db
        .prepare(
          "SELECT CAST(sequence AS TEXT) AS sequence, data FROM events WHERE json_extract(data, '$.workId')=? ORDER BY sequence",
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
          "SELECT CAST(sequence AS TEXT) AS sequence,data FROM (SELECT sequence,data FROM events ORDER BY sequence DESC LIMIT 500) ORDER BY sequence",
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
  close() {
    this.db.close();
    closeSync(this.lock);
    unlinkSync(join(this.root, "daemon.lock"));
  }
}
