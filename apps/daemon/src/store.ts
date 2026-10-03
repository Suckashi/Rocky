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
  RockyError,
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
    this.db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS works(id TEXT PRIMARY KEY, request_id TEXT UNIQUE, intent TEXT NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, args_hash TEXT NOT NULL, outcome TEXT NOT NULL, result TEXT); CREATE TABLE IF NOT EXISTS decisions(request_id TEXT PRIMARY KEY, intent TEXT NOT NULL, work_id TEXT NOT NULL);",
    );
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
    ).map((r) => JSON.parse(r.data));
  }
  get(id: string): Work {
    const row = this.db.prepare("SELECT data FROM works WHERE id=?").get(id) as
      { data: string } | undefined;
    if (!row) throw new RockyError("not_found", "Work not found", 404);
    return JSON.parse(row.data);
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
      .run(work.id, work.requestId, intent, JSON.stringify(work));
  }
  save(work: Work) {
    this.db
      .prepare("UPDATE works SET data=? WHERE id=?")
      .run(JSON.stringify(work), work.id);
  }
  event(work: Work, name: string, data: Record<string, unknown>) {
    const base = {
      schemaVersion: 1 as const,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      workId: work.id,
      runId: work.runId,
      name,
      data,
    };
    const r = this.db
      .prepare("INSERT INTO events(data) VALUES(?)")
      .run(JSON.stringify(base));
    return { ...base, sequence: String(r.lastInsertRowid) };
  }
  events(after = "0"): PublicEvent[] {
    if (!/^\d+$/.test(after))
      throw new RockyError("invalid_cursor", "Invalid cursor");
    return (
      this.db
        .prepare(
          "SELECT CAST(sequence AS TEXT) AS sequence,data FROM events WHERE sequence>? ORDER BY sequence LIMIT 1000",
        )
        .all(after) as { sequence: string; data: string }[]
    ).map((r) => ({ ...JSON.parse(r.data), sequence: r.sequence }));
  }
  eventsForWork(workId: string): PublicEvent[] {
    return (
      this.db
        .prepare(
          "SELECT CAST(sequence AS TEXT) AS sequence, data FROM events WHERE json_extract(data, '$.workId')=? ORDER BY sequence",
        )
        .all(workId) as { sequence: string; data: string }[]
    ).map((row) => ({ ...JSON.parse(row.data), sequence: row.sequence }));
  }
  close() {
    this.db.close();
    closeSync(this.lock);
    unlinkSync(join(this.root, "daemon.lock"));
  }
}
