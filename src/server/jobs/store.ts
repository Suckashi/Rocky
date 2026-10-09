// Jobs: work handed to an external agent. A job keeps its worktree, the agent's timeline
// and Rocky's own verification, so the user can review, apply or discard it later.
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type JobStatus =
  /** Waiting for its turn: one external agent job runs at a time. */
  | 'queued'
  | 'running'
  /** Rocky checked the worktree against its approvals and the checks passed. */
  | 'verified'
  /** Finished, but verification found unapproved changes or failing checks. */
  | 'problems'
  | 'failed'
  | 'stopped'
  /** Rocky ended while the job ran; its outcome is unknown and it is never restarted. */
  | 'interrupted'
  | 'applied'
  | 'discarded';

export interface JobCheck {
  argv: string[];
  exitCode: number | null;
  output: string;
}

export interface JobResult {
  stopReason: string | null;
  summary: string;
  changed: string[];
  unapproved: string[];
  mismatched: string[];
  diff: string;
  checks: JobCheck[];
  warnings: string[];
  error?: string;
}

export interface Job {
  id: string;
  threadId: string;
  runId: string | null;
  toolCallId: string | null;
  agent: string;
  title: string;
  task: string;
  status: JobStatus;
  worktree: string | null;
  branch: string | null;
  baseCommit: string | null;
  sessionId: string | null;
  result: JobResult | null;
  createdAt: number;
  finishedAt: number | null;
}

export type JobEvent =
  | { type: 'message'; text: string }
  | { type: 'tool'; id: string; title: string; kind: string; status: string }
  | {
      type: 'permission';
      id: string;
      title: string;
      decision: 'allow' | 'reject';
      receiptId: string | null;
    }
  | { type: 'prompt'; text: string }
  | { type: 'status'; text: string };

interface JobRow {
  id: string;
  thread_id: string;
  run_id: string | null;
  tool_call_id: string | null;
  agent: string;
  title: string;
  task: string;
  status: JobStatus;
  worktree: string | null;
  branch: string | null;
  base_commit: string | null;
  session_id: string | null;
  result: string | null;
  created_at: number;
  finished_at: number | null;
}

const toJob = (r: JobRow): Job => ({
  id: r.id,
  threadId: r.thread_id,
  runId: r.run_id,
  toolCallId: r.tool_call_id,
  agent: r.agent,
  title: r.title,
  task: r.task,
  status: r.status,
  worktree: r.worktree,
  branch: r.branch,
  baseCommit: r.base_commit,
  sessionId: r.session_id,
  result: r.result ? (JSON.parse(r.result) as JobResult) : null,
  createdAt: r.created_at,
  finishedAt: r.finished_at,
});

export class JobStore {
  private readonly db: DatabaseSync;
  private readonly now: () => number;

  constructor(db: DatabaseSync, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
  }

  create(input: {
    threadId: string;
    runId?: string;
    toolCallId?: string;
    agent: string;
    title: string;
    task: string;
  }): Job {
    const id = randomUUID();
    this.db
      .prepare(
        `insert into jobs (id, thread_id, run_id, tool_call_id, agent, title, task, status, created_at)
         values (?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
      )
      .run(
        id,
        input.threadId,
        input.runId ?? null,
        input.toolCallId ?? null,
        input.agent,
        input.title,
        input.task,
        this.now(),
      );
    return this.get(id)!;
  }

  get(id: string): Job | undefined {
    const row = this.db.prepare('select * from jobs where id = ?').get(id) as
      JobRow | undefined;
    return row ? toJob(row) : undefined;
  }

  list(): Job[] {
    return (
      this.db
        .prepare('select * from jobs order by created_at desc limit 200')
        .all() as unknown as JobRow[]
    ).map(toJob);
  }

  forThread(threadId: string): Job[] {
    return (
      this.db
        .prepare('select * from jobs where thread_id = ? order by created_at')
        .all(threadId) as unknown as JobRow[]
    ).map(toJob);
  }

  setWorkspace(
    id: string,
    w: { worktree: string; branch: string; baseCommit: string },
  ): void {
    this.db
      .prepare(
        'update jobs set worktree = ?, branch = ?, base_commit = ? where id = ?',
      )
      .run(w.worktree, w.branch, w.baseCommit, id);
  }

  setSession(id: string, sessionId: string): void {
    this.db
      .prepare('update jobs set session_id = ? where id = ?')
      .run(sessionId, id);
  }

  finish(id: string, status: JobStatus, result: JobResult | null): void {
    this.db
      .prepare(
        'update jobs set status = ?, result = ?, finished_at = ? where id = ?',
      )
      .run(status, result ? JSON.stringify(result) : null, this.now(), id);
  }

  setStatus(id: string, status: JobStatus): void {
    this.db.prepare('update jobs set status = ? where id = ?').run(status, id);
  }

  addEvent(id: string, event: JobEvent): void {
    const { n } = this.db
      .prepare('select count(*) as n from job_events where job_id = ?')
      .get(id) as { n: number };
    this.db
      .prepare(
        'insert into job_events (job_id, seq, at, event) values (?, ?, ?, ?)',
      )
      .run(id, n, this.now(), JSON.stringify(event));
  }

  events(id: string): (JobEvent & { at: number })[] {
    return (
      this.db
        .prepare(
          'select at, event from job_events where job_id = ? order by seq',
        )
        .all(id) as { at: number; event: string }[]
    ).map((r) => ({ ...(JSON.parse(r.event) as JobEvent), at: r.at }));
  }

  /** At startup: jobs that were queued or running when Rocky stopped. Never started again automatically. */
  markInterrupted(): number {
    return Number(
      this.db
        .prepare(
          "update jobs set status = 'interrupted', finished_at = ? where status in ('queued', 'running')",
        )
        .run(this.now()).changes,
    );
  }
}
