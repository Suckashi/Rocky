# Rocky implementation progress

2026-10-03, Asia/Taipei. Working local P0 fixture plus P1 contracts and original identity; not the complete Rocky product.

| Task        | Status      | Actual result                                                                                                                                       |
| ----------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-001       | done        | Independent Git root and local commit, original engineering files, Apache-2.0, workspace, new CI and reference decisions. Remote uncreated.         |
| T-002       | blocked     | Locked dependencies, installed license inventory and Windows clean-copy no-Python validation. Ubuntu evidence unavailable.                          |
| T-003       | in_progress | Real CopilotKit gateway → Work → native Deep Agents task/todos/interrupt → stdio/HTTP MCP. Functional browser flow verified; upstream P0 gate open. |
| T-004       | blocked     | Four Promptfoo full-path cases and Node egress pass with blocked SDK telemetry recorded. Browser egress fails from host AdGuard injection.          |
| T-005       | done        | Validated DTO/event/error/IPC wire contracts and cursor-based snapshot synchronization. Worker IPC execution remains T-009.                         |
| T-006       | done        | Domain schema v2, identity-preserving CAS, atomic events/outbox, recoverable completion projection and OS-released single writer lock.              |
| T-007       | in_progress | Versioned model settings UI/API, server-only references, bounded protocol probes and tested per-connection proxy/CA; routing/usage budgets pending. |
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

## T-006: recoverable domain persistence

The user deferred WSL and asked to continue development. Completed domain schema v2, revision CAS, atomic Work/Operation + event/outbox transactions, durable completion results with stable pagination, and an OS-released writer lock that serializes stale PID recovery. Graph checkpoints remain separate.

Actual tests include child process exits before and after commit, two competing daemons, injected outbox write failure, replay deduplication and 105-result pagination. 29 core tests, typecheck/lint/build and 4 evaluation cases passed; all 3 selected functional browser tests passed. The strict browser egress test was excluded from this focused rerun and its earlier failure is not cleared. See [T-006 evidence](evidence/2026-10-03/persistence.json).

Next: T-007 Model Registry / explicit network / configured connection probing. Full worker IPC, effect reconciliation and inbox-checkpoint coordination remain pending; the application still runs synthetic model workflows. No system installation or remote action this round.

## T-007: model settings and connection probe slice

Implemented in `dd8f2c08d197c34cecdb449c9ef62eab7d0e3376`: domain schema v3 stores connection revisions, idempotent save receipts and durable probe results. A collapsed bilingual settings panel saves explicit provider/endpoint/model/context/output configuration, credential environment references and proxy/CA policy. Saving never calls the endpoint. Editing invalidates prior results and aborts older probes; restart interrupts unfinished probes without retrying them.

OpenAI-compatible, OpenAI, Anthropic and Ollama-compatible local protocol fixtures pass nonce text, a single fixed echo-tool roundtrip, SSE and client transport cancellation. Five requests maximum, 128 requested output tokens maximum each, 15-second deadline and bounded responses. No real application tool is dispatched by this diagnostic. Actual CONNECT proxy and TLS tests verify proxy routing, NO_PROXY bypass and per-connection trust isolation. The native Deep Agents chat/evaluation runtime still uses synthetic fixtures.

Evidence: [T-007 verification](evidence/2026-10-03/models/verification.json), [probe result](evidence/2026-10-03/models/probe-result.png), [setup guide](model-connections.md). 41 core tests in 12 files, 4 functional browser tests, 4 full Agent evaluation cases, typecheck/lint/build and license/secret checks passed. A fresh Windows clean-copy install/build/test/evaluation passed using the actual npm 11.6.4 executable with no forbidden Python/compiler calls. The script now records the executable version separately from inherited npm user-agent metadata. Initial migration-fixture, test-selector and npm-version failures were corrected and rerun; they are recorded in the report.

T-007 stays **in_progress**: actual usage/cost budgets, shared model-purpose routing and expanded DNS/rebind validation remain. Vision/structured output and live provider endpoints are unverified. Existing Ubuntu and strict browser egress gates remain open; no global AT was promoted. Next continue these T-007 gaps, then T-008 policy/ledger and T-009 worker IPC. No remote action was performed.
