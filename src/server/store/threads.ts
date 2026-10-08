// Conversation storage: threads and the compacted AG-UI events of each run.
import type { BaseEvent, Message } from '@ag-ui/client';
import type { DatabaseSync } from 'node:sqlite';

export type RunOutcome = 'succeeded' | 'failed' | 'unknown';

export interface ThreadRecord {
  id: string;
  agentId: string;
  name: string | null;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface StoredRun {
  id: string;
  threadId: string;
  agentId: string;
  parentRunId: string | null;
  events: BaseEvent[];
  outcome: RunOutcome;
  error: string | null;
  createdAt: number;
}

interface ThreadRow {
  id: string;
  agent_id: string;
  name: string | null;
  archived: number;
  created_at: number;
  updated_at: number;
}

interface RunRow {
  id: string;
  thread_id: string;
  agent_id: string;
  parent_run_id: string | null;
  events: string;
  outcome: RunOutcome;
  error: string | null;
  created_at: number;
}

const toThread = (row: ThreadRow): ThreadRecord => ({
  id: row.id,
  agentId: row.agent_id,
  name: row.name,
  archived: row.archived === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class ThreadStore {
  private readonly db: DatabaseSync;
  private readonly now: () => number;

  constructor(db: DatabaseSync, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
  }

  ensureThread(id: string, agentId: string): ThreadRecord {
    const at = this.now();
    this.db
      .prepare(
        'insert into threads (id, agent_id, created_at, updated_at) values (?, ?, ?, ?) on conflict(id) do nothing',
      )
      .run(id, agentId, at, at);
    return this.thread(id)!;
  }

  thread(id: string): ThreadRecord | undefined {
    const row = this.db
      .prepare('select * from threads where id = ?')
      .get(id) as ThreadRow | undefined;
    return row ? toThread(row) : undefined;
  }

  threads(): ThreadRecord[] {
    const rows = this.db
      .prepare(
        'select * from threads where archived = 0 order by updated_at desc',
      )
      .all() as unknown as ThreadRow[];
    return rows.map(toThread);
  }

  rename(id: string, name: string): boolean {
    return (
      this.db
        .prepare('update threads set name = ?, updated_at = ? where id = ?')
        .run(name, this.now(), id).changes > 0
    );
  }

  /** Names a thread from its first user message, once. */
  nameIfUnnamed(id: string, text: string): void {
    const name = text.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!name) return;
    this.db
      .prepare('update threads set name = ? where id = ? and name is null')
      .run(name, id);
  }

  remove(id: string): boolean {
    return (
      this.db.prepare('delete from threads where id = ?').run(id).changes > 0
    );
  }

  /** Recorded before the run starts; a crash leaves it `unknown`, never `succeeded`. */
  startRun(run: {
    id: string;
    threadId: string;
    agentId: string;
    parentRunId: string | null;
  }): void {
    const at = this.now();
    this.db
      .prepare(
        "insert into runs (id, thread_id, agent_id, parent_run_id, outcome, created_at) values (?, ?, ?, ?, 'unknown', ?)",
      )
      .run(run.id, run.threadId, run.agentId, run.parentRunId, at);
    this.db
      .prepare('update threads set updated_at = ? where id = ?')
      .run(at, run.threadId);
  }

  finishRun(
    id: string,
    result: {
      events: BaseEvent[];
      outcome: RunOutcome;
      error?: string;
      messages?: Message[];
    },
  ): void {
    const at = this.now();
    this.db
      .prepare(
        'update runs set events = ?, outcome = ?, error = ?, finished_at = ? where id = ?',
      )
      .run(
        JSON.stringify(result.events),
        result.outcome,
        result.error ?? null,
        at,
        id,
      );
    if (result.messages && result.messages.length > 0) {
      this.db
        .prepare(
          'update threads set messages = ?, updated_at = ? where id = (select thread_id from runs where id = ?)',
        )
        .run(JSON.stringify(result.messages), at, id);
    }
  }

  runs(threadId: string): StoredRun[] {
    const rows = this.db
      .prepare(
        'select * from runs where thread_id = ? order by created_at, rowid',
      )
      .all(threadId) as unknown as RunRow[];
    return rows.map((row) => ({
      id: row.id,
      threadId: row.thread_id,
      agentId: row.agent_id,
      parentRunId: row.parent_run_id,
      events: JSON.parse(row.events) as BaseEvent[],
      outcome: row.outcome,
      error: row.error,
      createdAt: row.created_at,
    }));
  }

  messages(threadId: string): Message[] {
    const row = this.db
      .prepare('select messages from threads where id = ?')
      .get(threadId) as { messages: string } | undefined;
    return row ? (JSON.parse(row.messages) as Message[]) : [];
  }

  /** At startup: runs a crash or kill left open stay `unknown` and are closed, never retried. */
  markInterrupted(): number {
    return Number(
      this.db
        .prepare(
          "update runs set finished_at = ?, error = 'interrupted' where outcome = 'unknown' and finished_at is null",
        )
        .run(this.now()).changes,
    );
  }

  /** Runs left `unknown` by a crash or kill; shown to the user, never retried. */
  interruptedRuns(): { id: string; threadId: string }[] {
    return (
      this.db
        .prepare(
          "select id, thread_id from runs where outcome = 'unknown' and finished_at is null",
        )
        .all() as unknown as { id: string; thread_id: string }[]
    ).map((row) => ({ id: row.id, threadId: row.thread_id }));
  }
}
