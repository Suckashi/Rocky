# Canonical overlapping workspace ownership

2026-10-04, Windows x64/Node24.12.0/npm11.6.4, source c63be5a72f91dc78f38c261b4b8b3b8cde4a9bf3. T-017/T-010/T-008 remain their prior states; no final acceptance claim.

Admission previously reserved only equal workspace UUIDs. A registered parent and separately registered descendant could therefore start concurrently despite sharing files. WorkService now compares pinned canonical registered roots in both directions using platform-aware path boundaries/case. Equal UUID/fixture reservations retain existing behavior. Prefix-neighbor folders and different drives do not overlap. Registered roots are validated by the existing registry; no client-provided lease owner is accepted.

The existing persisted Work/run ownership and startup reservation form the exclusive root lease. The single daemon reserves synchronously before asynchronous startup and worker/model-slot dispatch. Overlapping waiter stays durable queued with no worker/model request; independent root remains eligible. A terminal/cancelled waiter drops out of admission, and root completion admits the next eligible Work. Blocked owner retains overlapping scope across restart rather than replaying or admitting another mutation into uncertainty. Native children run under their root Work capability and do not acquire another exclusive root lease; existing canonical per-file target claims remain the dispatch guard. No second scheduler, polling source, table format or locking runtime is introduced.

This is conservative exclusive Work admission, not shared-read concurrency, an OS filesystem lock or an atomic external-process transaction. Target/root freshness still must be checked independently by tools. Only one registered root is currently allowed per Work, so multi-root lock ordering is not implemented here. Complete blocked-owner release/reconciliation, worktree and controlled shell remain open.

## Real verification

[Commands and limitations](evidence/2026-10-04/workspace-leases/verification.json). Final5 lease tests use real canonical disposable roots and configured native workers with a held scripted loopback provider. Forward and reverse overlap prevent worker creation/model calls; unrelated prefix-neighbor root completes; completion releases the waiter; cancellation never starts it; restart retains a blocked owner and durable queue. The restart fixture explicitly seeds an interrupted persisted status, not a power-loss test. Initial test failure was a double-close in fixture cleanup, corrected before final evidence.

Related31 admission/native read/write regressions passed before adding the reverse fixture; daemon source stayed the same. Includes native task child read, exact write approval and concurrency/admission budgets. Final typecheck/lint/build/format/diff checks pass. Final5 production-path browser cases pass on normal daemon with fixture providers: MCP tool/data approval, workspace owner browsing, explicit native read and actual new/overwrite diff approval. Existing Chromium148.0.7778.96/DPR1, four-width UI regression; no new frontend change, screenshot comparison or fresh fidelity claim. Full suite was not rerun this round. SQLite/Vite warnings remain.

## Unfinished

Multi-resource sorting/acquisition, explicit lease inspector/release governance, shared-read optimization, cross-process OS locks, complete unknown local-write reconciliation, worktree, controlled shell and AT31's full matrix are not complete. Ubuntu/live integrations/pinned browser install remain deferred. Registered-root replacement still relies on tool freshness rejection, not an OS prevention guarantee. All70 AT unchanged. No Apsis/remote actions; full V1 Goal remains active.
