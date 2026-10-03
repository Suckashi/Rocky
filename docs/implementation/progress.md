# Rocky implementation progress

2026-10-03, Asia/Taipei. Working local P0 fixture plus P1 contracts and original identity; not the complete Rocky product.

| Task        | Status      | Actual result                                                                                                                                       |
| ----------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-001       | done        | Independent Git root and local commit, original engineering files, Apache-2.0, workspace, new CI and reference decisions. Remote uncreated.         |
| T-002       | blocked     | Locked dependencies, installed license inventory and Windows clean-copy no-Python validation. Ubuntu evidence unavailable.                          |
| T-003       | in_progress | Real CopilotKit gateway → Work → native Deep Agents task/todos/interrupt → stdio/HTTP MCP. Functional browser flow verified; upstream P0 gate open. |
| T-004       | blocked     | Four Promptfoo full-path cases and Node egress pass with blocked SDK telemetry recorded. Browser egress fails from host AdGuard injection.          |
| T-005       | done        | Validated DTO/event/error/IPC wire contracts and cursor-based snapshot synchronization. Worker IPC execution remains T-009.                         |
| T-037       | done        | Original editable SVG identity, tokens, persistent assistant ID and versioned persona; rendered baseline, rights review pending.                    |
| Later tasks | pending     | Product modules and confirmed-state presence remain pending.                                                                                        |

Node 24.12.0 / npm 11.6.4 baseline. No upstream code, history, data, settings or assets imported. All test data synthetic. No remote action or live paid endpoint used. See known-limitations.md for gates and follow-up.

Evidence: [verification](evidence/2026-10-03/verification.json), [dependency baseline](dependency-baseline.json), [acceptance matrix](acceptance-report.md). All 70 global acceptance entries remain not_run; phase checks do not imply full acceptance.

## Follow-up: exact stop and bounded API

Local implementation `bd76a3da3fef0830a2acfc6499fc3f9d5d42d2df`: stop requires requestId, runId, executionSessionId and expectedRevision. Its receipt, resulting state and event commit atomically. Repeated requests survive restart without a second cancellation; stale targets return 409. Unknown dispatched effects remain blocked for reconciliation. Resource cleanup is shared between stop and shutdown. API bodies are limited by actual streamed bytes, malformed JSON returns a safe 400, and session responses disable caching.

Validation: 14 core tests, typecheck, lint, build, 4 full-path evaluation cases and both functional browser tests passed. Strict browser egress still fails from AdGuard injection. See [follow-up evidence](evidence/2026-10-03/stop-and-http.json). This contributes to T-003 and future T-012; the latter remains pending because worker/steering dependencies are incomplete. No new global acceptance pass or remote action.

## Authorized P1 development with open P0 gates

The user explicitly requested continuing feature work if environment blockers cannot be resolved. Ubuntu remains unavailable; strict browser egress still fails. T-005 and T-037 have completed their local doneWhen criteria under that direction, without closing P0 or any global AT.

Changes: strict public schemas, bounded IPC wire parsing (no worker yet), safe own-store event upgrade, atomic snapshot and resume cursor, stale-event protection, original five-limb avatar/mark/favicon, shared light/dark tokens, durable assistant identity and persona 1.0.0.

Validation: 23 core tests, 9 contract tests, build/typecheck/lint, 4 evaluation cases; 3 browser tests pass and the AdGuard egress test fails. Visual review covers 24/32/48/96px, both themes, 320px, 200% zoom, reduced motion and keyboard theme control. See [P1 evidence](evidence/2026-10-03/p1/verification.json) and [identity matrix](evidence/2026-10-03/p1/rocky-identity-matrix.png).

Next local tasks: T-006 store/CAS/outbox foundations and T-007 real model/network configuration. T-038 animation/presence and all live/release gates remain unfinished.
