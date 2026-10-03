import { z } from "zod";
import {
  memorySchema,
  memorySaveSchema,
  memoryDeleteSchema,
  memorySearchSchema,
  memoryScopeSchema,
} from "../../../packages/contracts/src/memory.js";
import { RockyError } from "../../../packages/contracts/src/index.js";
import { Store } from "./store.js";
import { WorkspaceRegistry } from "./workspaces.js";
import { intentHash } from "./intent.js";
export class MemoryRegistry {
  constructor(
    private store: Store,
    private workspaces: WorkspaceRegistry,
  ) {}
  private scope(value: unknown) {
    const scope = memoryScopeSchema.parse(value);
    if (scope.kind === "project") this.workspaces.get(scope.id);
    if (scope.kind === "task") this.store.get(scope.id);
    return JSON.stringify(scope);
  }
  get(id: string) {
    z.uuid().parse(id);
    const row = this.store.db
      .prepare("SELECT data FROM memories WHERE id=?")
      .get(id) as { data: string } | undefined;
    if (!row) throw new RockyError("memory_missing", "Memory not found", 404);
    return memorySchema.parse(JSON.parse(row.data));
  }
  private receipt(requestId: string, intent: string) {
    const row = this.store.db
      .prepare("SELECT intent,result FROM memory_receipts WHERE request_id=?")
      .get(requestId) as { intent: string; result: string } | undefined;
    if (!row) return;
    if (row.intent !== intent)
      throw new RockyError(
        "idempotency_conflict",
        "Memory command changed",
        409,
      );
    return JSON.parse(row.result) as {
      id: string;
      revision: number;
      deleted: boolean;
    };
  }
  private record(
    requestId: string,
    intent: string,
    result: { id: string; revision: number; deleted: boolean },
  ) {
    this.store.db
      .prepare("INSERT INTO memory_receipts VALUES(?,?,?)")
      .run(requestId, intent, JSON.stringify(result));
    return result;
  }
  save(input: unknown) {
    const command = memorySaveSchema.parse(input),
      intent = intentHash({ kind: "save", ...command });
    return this.store.transaction(() => {
      const replay = this.receipt(command.requestId, intent);
      if (replay) return replay;
      const scope = this.scope(command.scope);
      if (
        Buffer.byteLength(command.content) > 16384 ||
        command.content.includes("\0") ||
        Buffer.from(command.content).toString("utf8") !== command.content ||
        this.store.publicEvidence(command.content) !== command.content
      )
        throw new RockyError(
          "memory_content",
          "Protected or oversized content cannot be saved",
          422,
        );
      const row = this.store.db
        .prepare("SELECT data FROM memories WHERE id=?")
        .get(command.id) as { data: string } | undefined;
      const previous = row
        ? memorySchema.parse(JSON.parse(row.data))
        : undefined;
      if (
        !previous &&
        this.store.db
          .prepare(
            "SELECT 1 FROM memory_receipts WHERE json_extract(result,'$.id')=? LIMIT 1",
          )
          .get(command.id)
      )
        throw new RockyError(
          "memory_retired",
          "Deleted memory identity cannot be reused",
          409,
        );
      if ((previous?.revision ?? 0) !== command.expectedRevision)
        throw new RockyError("stale_memory", "Memory revision changed", 409);
      if (previous && JSON.stringify(previous.scope) !== scope)
        throw new RockyError(
          "memory_scope",
          "Scope cannot be changed; create a separate entry",
          409,
        );
      const now = new Date().toISOString(),
        memory = memorySchema.parse({
          id: command.id,
          scope: command.scope,
          content: command.content,
          status: command.status,
          private: command.private,
          revision: command.expectedRevision + 1,
          locked: true,
          userEdited: true,
          source: "owner",
          createdAt: previous?.createdAt ?? now,
          updatedAt: now,
        });
      this.store.db
        .prepare(
          "INSERT INTO memories VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        )
        .run(memory.id, scope, JSON.stringify(memory));
      this.store.db.prepare("DELETE FROM memory_fts WHERE id=?").run(memory.id);
      this.store.db
        .prepare("INSERT INTO memory_fts(id,content) VALUES(?,?)")
        .run(memory.id, memory.content);
      return this.record(command.requestId, intent, {
        id: memory.id,
        revision: memory.revision,
        deleted: false,
      });
    });
  }
  delete(id: string, input: unknown) {
    z.uuid().parse(id);
    const command = memoryDeleteSchema.parse(input),
      intent = intentHash({ kind: "delete", id, ...command });
    return this.store.transaction(() => {
      const replay = this.receipt(command.requestId, intent);
      if (replay) return replay;
      const memory = this.get(id);
      if (memory.revision !== command.expectedRevision)
        throw new RockyError("stale_memory", "Memory revision changed", 409);
      this.store.db.prepare("DELETE FROM memory_fts WHERE id=?").run(id);
      this.store.db.prepare("DELETE FROM memories WHERE id=?").run(id);
      return this.record(command.requestId, intent, {
        id,
        revision: memory.revision + 1,
        deleted: true,
      });
    });
  }
  search(input: unknown) {
    const command = memorySearchSchema.parse(input),
      scope = this.scope(command.scope),
      query = command.query;
    const rows = (
      query
        ? this.store.db
            .prepare(
              "SELECT data FROM memories WHERE scope=? AND (instr(lower(json_extract(data,'$.content')),lower(?))>0 OR id IN (SELECT id FROM memory_fts WHERE memory_fts MATCH ?)) ORDER BY rowid DESC LIMIT 21",
            )
            .all(scope, query, '"' + query.replaceAll('"', '""') + '"')
        : this.store.db
            .prepare(
              "SELECT data FROM memories WHERE scope=? ORDER BY rowid DESC LIMIT 21",
            )
            .all(scope)
    ) as { data: string }[];
    const items = [];
    let bytes = 0,
      truncated = false;
    for (const row of rows) {
      const item = memorySchema.parse(JSON.parse(row.data)),
        size = Buffer.byteLength(item.content);
      if (items.length >= 20 || bytes + size > command.byteBudget) {
        truncated = true;
        continue;
      }
      items.push(item);
      bytes += size;
    }
    return {
      items,
      contentBytes: bytes,
      byteBudget: command.byteBudget,
      truncated,
    };
  }
}
