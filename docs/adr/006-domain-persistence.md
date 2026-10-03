# ADR-006: Domain CAS, durable outbox and single writer

Accepted 2026-10-03. The user asked to defer WSL installation and continue development. No system installation, remote or live endpoint action is part of this task.

Domain SQLite user_version advances to 2. Work updates compare the expected revision and preserve request/run/session identity, with exactly one revision increment. Work transitions, operation dispatch/results and their event/outbox records use domain transactions. A write failure rolls them back together. Graph checkpoints remain in their separate official-saver database; no cross-database atomicity is claimed.

The persisted events table remains the authoritative SSE replay log. A durable outbox references each event. Its dispatcher retries local notification and projects terminal results into completion_messages, with unique work-result:<workId> identities. Projection and delivery acknowledgement commit together. A callback can run more than once after interruption; it may notify observers but must never execute tools. delivered_at is not a per-browser acknowledgement. GET /api/v1/conversation/messages currently exposes the completion-result projection with bounded, stable sequence pagination, not a complete user/assistant transcript. The main UI continues reading Work projections; full conversation/inbox and checkpoint-consumption semantics remain T-013.

A dedicated SQLite writer-lock database holds an exclusive OS-released lock before PID-file recovery. It serializes competing daemons, including stale PID cleanup after a crash. Live or unverifiable PID records fail closed. Normal cleanup is idempotent; domain-open failures release the lock. The lock file/database are private runtime data, not source artifacts.

Verification includes stale CAS rejection, failed outbox insertion rolling back the operation ledger, repeated delivery without duplicate completions, real child process exit before/after commit, concurrent stale-lock contenders, and 105-result pagination. Child fixtures operate only in generated temporary directories. These are local Windows domain tests, not proof of every distributed/remote crash window or Ubuntu behavior.

The P0 executor still runs within the daemon and conservatively blocks interrupted work on restart. Queued-work re-admission, worker IPC/backpressure, full effect reconciliation, completion inbox/checkpoint coordination and live model connections remain later tasks. Dependencies and native installation paths are unchanged.
