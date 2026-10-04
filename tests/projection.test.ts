import { removePostV19Tables } from "./historical-schema.js";
import { expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../apps/daemon/src/store.js";
import { projectWork, projectEvidence } from "../apps/web/src/projection.js";
import {
  publicEventSchema,
  sequenceSchema,
  workSchema,
  type Work,
} from "../packages/contracts/src/index.js";

function fixture(): Work {
  return {
    id: randomUUID(),
    runId: randomUUID(),
    executionSessionId: randomUUID(),
    requestId: randomUUID(),
    text: "Public synthetic fixture",
    transport: "http",
    mode: "fixture",
    runMode: "normal",
    status: "queued",
    revision: 1,
    answer: "",
    createdAt: new Date().toISOString(),
  };
}

test("snapshot pages preserve the event boundary and include older active Works on the first page", () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-snapshot-pages-"));
  const store = new Store(root);
  try {
    const oldest = fixture();
    store.add(oldest, "oldest-active");
    for (let index = 0; index < 205; index++)
      store.add({ ...fixture(), status: "completed" }, String(index));
    const first = store.snapshot();
    expect(first.works).toHaveLength(101);
    expect(first.works.some((work) => work.id === oldest.id)).toBe(true);
    expect(first.nextCursor).not.toBeNull();
    const later = fixture();
    store.add(later, "added-between-pages");
    store.event(later, "rocky.work.updated", { work: later });
    const seen = new Set(first.works.map((work) => work.id));
    let cursor = first.nextCursor;
    while (cursor) {
      const page = store.snapshot(cursor);
      expect(page.cursor).toBe(first.cursor);
      expect(page.events).toEqual([]);
      expect(page.works).toHaveLength(cursor === first.nextCursor ? 100 : 6);
      for (const work of page.works) seen.add(work.id);
      cursor = page.nextCursor;
    }
    expect(seen.size).toBe(206);
    expect(seen.has(later.id)).toBe(false);
    expect(() => store.snapshot("99999999999999999999:0")).toThrow("cursor");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T-005 strict DTO and official AG-UI contracts reject invalid identities, private fields and cursors", () => {
  const work = fixture();
  expect(
    workSchema.safeParse({ ...work, credentials: "private" }).success,
  ).toBe(false);
  expect(workSchema.safeParse({ ...work, runId: "invalid" }).success).toBe(
    false,
  );
  for (const cursor of [
    "bad",
    "-1",
    "01",
    "1.0",
    "9223372036854775808",
    "9".repeat(1000),
  ])
    expect(sequenceSchema.safeParse(cursor).success).toBe(false);
  expect(sequenceSchema.parse("9007199254740993")).toBe("9007199254740993");
  const envelope = {
    schemaVersion: 1,
    id: randomUUID(),
    sequence: "1",
    timestamp: work.createdAt,
  };
  expect(
    publicEventSchema.safeParse({
      ...envelope,
      payload: {
        kind: "agui",
        event: {
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "fixture",
          delta: "hello",
        },
      },
    }).success,
  ).toBe(true);
  expect(
    publicEventSchema.safeParse({
      ...envelope,
      payload: { kind: "agui", event: { type: "invented" } },
    }).success,
  ).toBe(false);
  expect(
    publicEventSchema.safeParse({
      ...envelope,
      payload: { kind: "domain", name: "apsis.work.updated", data: { work } },
    }).success,
  ).toBe(false);
  expect(
    publicEventSchema.safeParse({
      ...envelope,
      payload: {
        kind: "domain",
        name: "rocky.work.updated",
        data: { work: { ...work, credentials: "private" } },
      },
    }).success,
  ).toBe(false);
});

test("snapshot high water and replay preserve newer revisions and deduplicate evidence beyond safe-number precision", () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-projection-")),
    store = new Store(root);
  try {
    const work = fixture();
    store.add(work, "fixture");
    const old = store.event(work, "rocky.work.updated", { work });
    const snapshot = store.snapshot();
    expect(snapshot.cursor).toBe(old.sequence);
    const newer = { ...work, status: "running" as const, revision: 2 };
    store.save(newer, work.revision);
    const event = store.event(newer, "rocky.work.updated", { work: newer });
    expect(store.events(snapshot.cursor)).toEqual([event]);
    const projected = projectWork(snapshot.works, event);
    expect(projectWork(projected, old)).toEqual([newer]);
    expect(
      projectEvidence(projectEvidence(snapshot.events, event), event),
    ).toHaveLength(2);
    store.db
      .prepare("UPDATE sqlite_sequence SET seq=? WHERE name='events'")
      .run("9007199254740992");
    const large = store.event(newer, "rocky.tool.completed", {
      name: "synthetic",
    });
    expect(large.sequence).toBe("9007199254740993");
    expect(store.events("9007199254740992")).toEqual([large]);
    expect(store.snapshot().cursor).toBe(large.sequence);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Rocky P0 event upgrade is transactional and retained across reopen", () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-upgrade-"));
  let store = new Store(root);
  try {
    const work = fixture();
    store.add(work, "fixture");
    const oldWork: Record<string, unknown> = { ...work };
    delete oldWork.runMode;
    delete oldWork.executionSessionId;
    store.db
      .prepare("UPDATE works SET data=? WHERE id=?")
      .run(JSON.stringify(oldWork), work.id);
    const old = {
      schemaVersion: 1,
      id: randomUUID(),
      timestamp: work.createdAt,
      workId: work.id,
      runId: work.runId,
      name: "rocky.work.updated",
      data: { work: oldWork },
    };
    store.db
      .prepare("INSERT INTO events(data) VALUES(?)")
      .run(JSON.stringify(old));
    removePostV19Tables(store.db);
    store.db.exec("PRAGMA user_version=0");
    store.close();
    store = new Store(root);
    expect(store.events()[0]?.payload).toEqual({
      kind: "domain",
      name: old.name,
      data: {
        work: {
          ...oldWork,
          runMode: "unknown",
          executionSessionId: work.runId,
        },
      },
    });
    expect(store.events()[0]?.id).toBe(old.id);
    expect(store.get(work.id).runMode).toBe("unknown");
    store.close();
    store = new Store(root);
    expect(store.events()).toHaveLength(1);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("unsupported store version releases lock and preserves stored bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-future-"));
  const store = new Store(root);
  store.db.exec("PRAGMA user_version=99");
  store.close();
  try {
    expect(() => new Store(root)).toThrow("newer than this application");
    expect(() => new Store(root)).toThrow("newer than this application");
    const db = new DatabaseSync(join(root, "domain.sqlite"));
    expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(99);
    db.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
