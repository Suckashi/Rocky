import { randomUUID } from "node:crypto";
import {
  RockyError,
  type Work,
} from "../../../packages/contracts/src/index.js";
import { Store } from "./store.js";

export type WorkerJob = {
  id: string;
  work_id: string;
  run_id: string;
  execution_session_id: string;
  status: "starting" | "running" | "exited" | "interrupted" | "cancelled";
  pid: number | null;
  started_at: string;
  ended_at: string | null;
  exit_code: number | null;
  error: string | null;
};

/** Process state is domain evidence. An exited child never marks Work completed. */
export class WorkerJobs {
  constructor(private readonly store: Store) {}
  get(id: string): WorkerJob {
    const job = this.store.db
      .prepare("SELECT * FROM worker_jobs WHERE id=?")
      .get(id) as WorkerJob | undefined;
    if (!job)
      throw new RockyError("worker_job_missing", "Worker job not found", 404);
    return job;
  }
  begin(work: Work): WorkerJob {
    const owned = this.store.get(work.id);
    if (
      owned.status !== "running" ||
      owned.runId !== work.runId ||
      owned.executionSessionId !== work.executionSessionId
    )
      throw new RockyError(
        "worker_owner",
        "Worker needs a current running Work",
        409,
      );
    const job: WorkerJob = {
      id: randomUUID(),
      work_id: work.id,
      run_id: work.runId,
      execution_session_id: work.executionSessionId,
      status: "starting",
      pid: null,
      started_at: new Date().toISOString(),
      ended_at: null,
      exit_code: null,
      error: null,
    };
    return this.store.transaction(() => {
      if (
        this.store.db
          .prepare(
            "SELECT 1 FROM worker_jobs WHERE run_id=? AND status IN ('starting','running')",
          )
          .get(job.run_id)
      )
        throw new RockyError(
          "worker_run_busy",
          "Run already has an active worker",
          409,
        );
      this.store.db
        .prepare("INSERT INTO worker_jobs VALUES(?,?,?,?,?,?,?,?,?,?)")
        .run(
          job.id,
          job.work_id,
          job.run_id,
          job.execution_session_id,
          job.status,
          job.pid,
          job.started_at,
          job.ended_at,
          job.exit_code,
          job.error,
        );
      this.store.event(owned, "rocky.worker.starting", {
        jobId: job.id,
        runId: job.run_id,
      });
      return job;
    });
  }
  attach(jobId: string, pid: number): WorkerJob {
    if (!Number.isSafeInteger(pid) || pid < 1)
      throw new RockyError("worker_pid", "Valid child PID required", 409);
    return this.store.transaction(() => {
      const job = this.get(jobId);
      const work = this.store.get(job.work_id);
      if (
        work.runId !== job.run_id ||
        work.executionSessionId !== job.execution_session_id ||
        work.status !== "running"
      )
        throw new RockyError("worker_owner", "Worker owner changed", 409);
      const change = this.store.db
        .prepare(
          "UPDATE worker_jobs SET status='running',pid=? WHERE id=? AND status='starting'",
        )
        .run(pid, job.id);
      if (change.changes !== 1)
        throw new RockyError(
          "worker_state",
          "Worker is no longer starting",
          409,
        );
      this.store.event(work, "rocky.worker.running", {
        jobId: job.id,
        runId: job.run_id,
      });
      return this.get(job.id);
    });
  }
  finish(
    jobId: string,
    status: "exited" | "interrupted" | "cancelled",
    exitCode: number | null,
    error: string | null,
  ): WorkerJob {
    return this.store.transaction(() => {
      const job = this.get(jobId);
      if (!["starting", "running"].includes(job.status)) return job;
      const work = this.store.get(job.work_id);
      const changed = this.store.db
        .prepare(
          "UPDATE worker_jobs SET status=?,ended_at=?,exit_code=?,error=? WHERE id=? AND status IN ('starting','running')",
        )
        .run(status, new Date().toISOString(), exitCode, error, job.id);
      if (changed.changes !== 1)
        throw new RockyError("worker_state", "Worker status changed", 409);
      this.store.event(work, "rocky.worker." + status, {
        jobId: job.id,
        runId: job.run_id,
        exitCode,
        error,
      });
      return this.get(job.id);
    });
  }
  recover(): number {
    return this.store.transaction(() => {
      const pending = this.store.db
        .prepare(
          "SELECT * FROM worker_jobs WHERE status IN ('starting','running')",
        )
        .all() as WorkerJob[];
      for (const job of pending) {
        this.store.db
          .prepare(
            "UPDATE worker_jobs SET status='interrupted',ended_at=?,error='Daemon restarted before worker outcome was recorded' WHERE id=?",
          )
          .run(new Date().toISOString(), job.id);
        this.store.event(
          this.store.get(job.work_id),
          "rocky.worker.interrupted",
          { jobId: job.id, runId: job.run_id, reason: "daemon_restarted" },
        );
      }
      return pending.length;
    });
  }
}
