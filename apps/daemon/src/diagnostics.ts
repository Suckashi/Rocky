import { randomUUID } from "node:crypto";
import type { Store } from "./store.js";
import { STORE_SCHEMA_VERSION } from "./storage-metadata.js";

/** Owner preview only. Never include messages, arguments, outputs, paths or credentials. */
export function diagnosticPreview(store: Store) {
  const counts = Object.fromEntries(
    ["works", "operations", "events", "outbox", "learning_evaluations"].map(
      (table) => [
        table,
        (
          store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {
            n: number;
          }
        ).n,
      ],
    ),
  );
  const statuses = store.db
    .prepare(
      "SELECT json_extract(data,'$.status') AS status,count(*) AS count FROM works GROUP BY status",
    )
    .all();
  const effects = store.db
    .prepare(
      "SELECT outcome,count(*) AS count FROM operations GROUP BY outcome",
    )
    .all();
  const pendingDelivery = (
    store.db
      .prepare("SELECT count(*) AS n FROM outbox WHERE delivered_at IS NULL")
      .get() as { n: number }
  ).n;
  const events = store.db
    .prepare(
      "SELECT CAST(sequence AS TEXT) AS sequence,json_extract(data,'$.workId') AS workId,json_extract(data,'$.runId') AS runId,json_extract(data,'$.payload.kind') AS kind,json_extract(data,'$.payload.name') AS name FROM events ORDER BY sequence DESC LIMIT 100",
    )
    .all();
  return {
    format: "rocky.diagnostics.v1",
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    schemaVersion: STORE_SCHEMA_VERSION,
    counts,
    statuses,
    effects,
    pendingDelivery,
    recentEventIdentities: store.publicEvidence(events),
    excluded: [
      "messages",
      "tool arguments and results",
      "model payloads",
      "workspace paths",
      "credentials",
      "browser storage",
      "checkpoint contents",
    ],
    networkChecks: "not_run",
    uploaded: false,
  };
}
