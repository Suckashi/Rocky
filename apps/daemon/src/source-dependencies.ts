import {
  RockyError,
  type Work,
} from "../../../packages/contracts/src/index.js";
import type { Store } from "./store.js";
/** Invalidation fences derived execution state; immutable checkpoints/effect evidence remain retained. */
export class SourceDependencies {
  constructor(private readonly store: Store) {}
  record(work: Work, kind: "memory" | "skill", id: string, revision: number) {
    this.store.db
      .prepare(
        "INSERT OR IGNORE INTO source_dependencies(work_id,run_id,kind,source_id,revision,invalidated) VALUES(?,?,?,?,?,0)",
      )
      .run(work.id, work.runId, kind, id, revision);
  }
  invalid(workId: string) {
    return !!this.store.db
      .prepare(
        "WITH RECURSIVE ancestry(work_id,thread_id,source_thread) AS (SELECT work_id,json_extract(data,'$.graphThreadId'),json_extract(data,'$.sourceGraphThreadId') FROM execution_sessions WHERE work_id=? UNION SELECT s.work_id,json_extract(s.data,'$.graphThreadId'),json_extract(s.data,'$.sourceGraphThreadId') FROM execution_sessions s JOIN ancestry a ON json_extract(s.data,'$.graphThreadId')=a.source_thread) SELECT 1 FROM source_dependencies d WHERE d.invalidated=1 AND (d.work_id=? OR d.work_id IN (SELECT work_id FROM ancestry)) LIMIT 1",
      )
      .get(workId, workId);
  }
  assert(work: Work) {
    if (this.invalid(work.id))
      throw new RockyError(
        "source_invalidated",
        "A source used by this execution was changed or removed. Start a new Work with fresh source context; retained checkpoints cannot be reused as live context.",
        409,
      );
  }
  invalidate(
    kind: "memory" | "skill",
    id: string,
    reason: string,
    revision?: number,
  ) {
    this.store.db
      .prepare(
        "UPDATE source_dependencies SET invalidated=1 WHERE kind=? AND source_id=? AND (? IS NULL OR revision=?)",
      )
      .run(kind, id, revision ?? null, revision ?? null);
    for (const work of this.store.list())
      if (this.invalid(work.id))
        this.store.event(work, "rocky.context.invalidated", {
          sourceKind: kind,
          sourceId: id,
          sourceRevision: revision ?? null,
          reason,
          checkpointsRetained: true,
        });
  }
}
