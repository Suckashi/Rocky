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
| T-007       | in_progress | Model UI/API, shared Work/evaluation routing, budgets, live probe and proxy/CA tests; profiles/cache pricing/full DNS policy pending.               |
| T-008       | in_progress | Canonical exact operation/approval intent and session binding; full policy/ledger/reconciliation pending.                                           |
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

## Goal continuation: durable root model budgets

Implementation `49cbd5812196df3b8f1e10987f4aa3f44f8b6509` adds domain schema v4 and a shared root model budget enforced before actual Work/evaluation model dispatch. Native child calls share the default 48-call cap. Reservations survive restart, reject duplicate dispatch IDs and do not refund unknown requests. The trusted ledger supports explicit token bounds and configured-price micro-USD limits, idempotent reported-usage settlement and overrun accounting. HTTP usage snapshots are schema-validated; synthetic token usage remains unknown.

46 core tests in 13 files and four full Agent evaluation cases passed, including real Work pre-dispatch budget exhaustion and root/child accounting. Typecheck, build, lint, formatting and source guards passed. See [budget evidence](evidence/2026-10-03/models/budget.json) and [ADR-008](../adr/008-root-model-budget.md). Backend-only changes did not trigger a browser or dependency-install rerun. No external model or remote action was used.

T-007 remains in_progress: configured-provider adapters and shared routing, provider usage/token profiles, editable budgets and expanded DNS policy evidence are next. Role/time sub-limits remain later integration work. Goal remains active; full product and global acceptance are not complete.

## Goal continuation: configured models in the native factory

Implementation `1060dd99538d13ef8249db1950e9cdf8d7a22ed5` adds the configured BaseChatModel adapter, ordinary provider usage parsing and daemon-owned model leases. OpenAI-compatible and Anthropic HTTP fixtures run through the same native Deep Agents factory with child task, approval interrupt and resume; reported usage settles the shared root ledger. No second agent loop or tool executor was added. Leases require explicit context, pin connection revision, abort on edits, and wait for in-flight cleanup on close. Unsupported content and unusable responses fail safely.

51 core tests in 14 files and four full Agent fixture evaluation cases passed. Typecheck, server build, lint, format and source guards passed. See [configured adapter evidence](evidence/2026-10-03/models/configured-adapter.json) and [ADR-009](../adr/009-configured-model-adapter.md). No browser/dependency rerun was needed for this backend-only change.

Next wire configured model selection into Work submission and the UI, then evaluation routing and trusted token profiles. The configured native-factory test is not evidence that the daemon/UI already supports live chat. Incremental runtime streaming, cache-priced usage and broader network validation remain pending. T-007 and the Goal remain active; existing external gates are unchanged.

## Goal continuation: configured Work and UI selection

Implementation `89643713a878e4550694fb960bb71f2cfcda31cd` adds explicit model selection through the UI, CopilotKit facade and daemon Work submission. Work records pin connection ID/revision; CAS prevents changing them. Root/child configured models share the existing factory, daemon approvals and budget ledger. Configuration changes reject stale approvals before synthetic tool dispatch. Partial startup and shutdown clean up configured leases; cancellation retains unknown usage rather than replaying requests.

55 core tests in 15 files, five functional browser tests and four full Agent fixture evaluation cases passed. Build/typecheck/lint/format/source checks passed. See [configured Work evidence](evidence/2026-10-03/models/configured-work.json) and [rendered result](evidence/2026-10-03/models/configured-work-result.png). The browser checked explicit selection/send, approval, completion, usage and reload. Strict egress was excluded and remains an open failure.

The UI can now send Work to a selected configured model, but tools remain synthetic samples; no production endpoint was exercised in this slice. T-007 remains in_progress for configured evaluation selection, trusted token profiles, cache pricing, editable budgets and DNS policy evidence. The user explicitly authorized reading and using the needed Apsis model endpoint/credential for subsequent live validation, with Apsis kept read-only and no full settings import. Next perform that narrowly scoped validation and finish the remaining T-007 contracts. Goal remains active.

## Goal continuation: authorized live model probe

Implementation `d75904027005d764bc373cab0e2cb31406aac86e` fixes capability probing to use automatic tool selection, matching the configured runtime. The authorized live endpoint accepted text but rejected forced tool choice in thinking mode. The revised probe still requires an actual tool call, exact synthetic nonce arguments and matching tool-result roundtrip; a text-only response fails the new regression test.

The live five-request probe passed text, tools, streaming and client cancellation. Ten live requests total include the original two-request failed probe and three bounded diagnostics. Every request specified at most 128 output tokens. The source Apsis settings were read only and confirmed unchanged; credentials stayed in process memory. No full configuration, credential or private response was added to Rocky. Context remains explicitly unknown, so no live Work was executed. See [live probe evidence](evidence/2026-10-03/models/live-probe.json).

All 10 focused model tests, typecheck, lint and source guards passed. No dependencies or UI changed. T-007 remains in_progress for its documented integration gaps; Ubuntu/browser egress and global acceptance status are unchanged. Goal remains active.

## Goal continuation: configured evaluation routing

Implementation `af4c3030a5845e76f098be8e76ecba9eb029634d` connects trusted configured-model selection to the same evaluation Work, native Agent, approval and budget paths. Case text cannot override selection. Undici model requests now check the installed evaluation egress guard; reference-counted endpoint leases revoke at completion and do not grant sibling routes. Returned metadata includes pinned selection and actual Work usage.

The full suite passed 58 tests before the added lease regression; focused final evaluation/network tests passed 5 tests. Four full Agent Promptfoo fixture cases passed. Typecheck (after correcting test optional-field narrowing), server build, lint, formatting and source guards passed. See [configured evaluation evidence](evidence/2026-10-03/models/configured-evaluation.json). No live calls, dependency changes or UI changes this turn.

T-007 remains in_progress for trusted token profiles, cache pricing, editable budgets and DNS policy evidence. Evaluation still operates synthetic tools; live protocol evidence from the previous turn is not full live Agent evidence. Ubuntu, browser egress and global acceptance are unchanged. Goal stays active.

## Goal continuation: explicit Work budgets

Implementation `27f28439f8c819da509da73fb465eb484f725af9` exposes optional per-Work model budgets through submission, CopilotKit forwarding and trusted evaluation configuration. Budget creation is atomic with Work creation; request receipts and CAS prevent changing a pinned budget. Root and children use the same persisted limits, including after reopening the store.

All 61 core tests passed, along with typecheck, lint, server build and source guards. A real Promptfoo negative run with maxCalls=1 stopped all four cases before their second model call; read-only database inspection confirmed four immutable budgets of 1 and one recorded call per Work. The expected command exit was 1, not a passing evaluation claim. See [Work budget evidence](evidence/2026-10-03/models/work-budgets.json).

T-007 stays in_progress: budget UI, token profiles, cache pricing and DNS policy evidence remain. Missing trusted bounds safely prevent token/cost-capped dispatch. No live or remote action this turn; Goal active and external gates unchanged.

## Goal continuation: composer call budget

Implementation `692d7c57f71a7ecf16c33e71f8ae3164fcb65447` adds collapsed per-Work model-call controls with 1–10000 validation and explicit shared-child semantics. Both configured and fixture CopilotKit submissions forward the budget. Work details retain the pinned original cap. UI copy distinguishes call counts from money/token caps.

Six functional browser tests passed, including new cap exhaustion, persisted daemon budget, reload and 320px checks. Traditional Chinese dark and English light screenshots were visually inspected. Typecheck, lint, build, final formatting and source guards passed. See [budget UI evidence](evidence/2026-10-03/models/budget-ui.json). A pre-existing test formatting issue was corrected; no runtime change resulted.

T-007 remains in_progress for token profiles, cache pricing and DNS policy evidence. Known strict browser egress failure was excluded and remains open; Ubuntu unverified. No live or remote actions. Goal active.

## Goal continuation: DNS lease revalidation

Implementation `c3e7d386c1fd3f6967d7735582d6145f802db306` validates exact model hostname and IPv4/IPv6 answers at socket lookup. Each network instance rejects a changed DNS answer set, while answer reordering remains valid. Actual HTTP testing confirms only the first request reaches the server after a simulated rebind. Four focused DNS/proxy/TLS tests passed, with typecheck, server build, lint, format and source guards. See [DNS evidence](evidence/2026-10-03/models/dns-lease.json).

This is intentionally recorded as partial DNS evidence: pins do not persist across network instances, and proxy-side target resolution is not enforced locally. T-007 remains in_progress for full policy integration, profiles and cache pricing. No global acceptance, OS isolation, Ubuntu or strict browser egress claim was changed. Goal active.

## T-008 started: canonical exact intent

Implementation `1b2f623c72d84ae89916124d935082b00b1cf778` establishes bounded canonical JSON intent and a versioned SHA-256 domain. Existing synthetic operation arguments and approval fingerprints use it; approvals also bind executionSessionId. Object insertion order cannot change meaning, while array order and typed values remain exact. Invalid/coercible inputs fail without executing getters or toJSON hooks. Serialized size, node count and nesting are bounded.

Nine focused intent/native/configured Work tests passed; after tightening incremental size accounting, five intent/native tests passed again. Typecheck, lint and server build passed. See [intent evidence](evidence/2026-10-03/policy/intent.json). T-008 is in_progress, not complete: server-owned target resolution, full phases/effect outcomes, grants, reconciliation and redaction remain. T-007 remains independently in_progress. Goal active; no global AT promotion or remote action.

## T-008 continuation: operation phases and effects

Implementation `ed6642bfcef19a2f2fa5259b872a5bdde65fd3cb` upgrades Rocky domain storage to v5 and adds a daemon-owned OperationLedger. Synthetic tools now persist prepared → authorized → dispatched → settled with separate effect outcome. Dispatch records unknown before I/O; errors settle unknown rather than infer no effect. Revision/phase/context CAS and atomic events guard transitions. Work/session and current running status are rechecked before dispatch. Successful cached results return without another call.

68 tests across 19 files and four full Agent evaluation cases passed. A final six-test ledger/native suite passed after preserving existing destination/result event evidence. Typecheck, server build, lint, format and source guards passed. Migration tests preserve v4 success/unknown with null historical context instead of invented ownership. See [ledger evidence](evidence/2026-10-03/policy/ledger.json).

T-008 remains in_progress: preparation before native approval, generic grants/target revisions, reconciliation and audit redaction are still pending. The ledger currently guards synthetic adapters. No new live/remote action or global acceptance claim; Goal active.

## T-008 continuation: prepared operation before approval

Implementation `65e58958f620db27208afd64cac1977f075341bb` resolves the native interrupted write call identity, persists its prepared/not_executed record and binds operationId into the approval. Resume must match that operation; no duplicate write record is created. Owner rejection atomically settles not_executed with the decision receipt and updated Work. Missing/ambiguous native identities fail closed.

Twelve focused native/configured/ledger/stop tests passed. Final six-test native/ledger verification includes rejection settlement and injected receipt failure rollback. Typecheck, lint and server build passed. See [prepared approval evidence](evidence/2026-10-03/policy/prepared-approval.json).

T-008 remains in_progress for generic grants, target recheck, unknown reconciliation and redaction. Stop/restart cleanup of unused prepared records remains pending; not_executed records do not authorize dispatch. Goal active; no global acceptance or remote action claim.

## T-008 continuation: stop/restart operation cleanup

Implementation `0fc06a483967c637b6f128b0d946dc61e47bc1d5` atomically settles only matching Work/run/session undispatched prepared/authorized records as not_executed during stop or restart recovery. Work projection, event and stop receipt remain in the same transaction. Dispatched unknown records are preserved, interrupted Work remains blocked, and no adapter is replayed.

Six final ledger/stop tests passed, including actual Store close → WorkService recovery and injected Work commit failure rollback. Eleven preceding ledger/stop/persistence regressions passed. Typecheck, lint and server build passed. See [undispatched recovery evidence](evidence/2026-10-03/policy/undispatched-recovery.json). T-008 continues with grants, target recheck, evidence-based unknown reconciliation and audit redaction. Goal active; external gates unchanged.

## T-008 continuation: daemon authorization policy

Implementation `c5f007fbab47ffd6d3d805bfd3f23bf4db7da5a9` introduces strict daemon Policy input and centralizes synthetic broker authorization. Deny-first checks bind owned Work/run/session, current scope and revocation. Target/policy changes require fresh preparation. Critical/unknown effects require exact operation/fingerprint consent. Local-new overwrite requires consent. Non-synthetic writes remain denied in evaluation/reflection regardless of approval. Model risk hints are rejected rather than trusted.

Ten focused policy/native/configured tests passed; six policy/native tests passed after pinning the prepared synthetic target to its original Work snapshot. Typecheck, lint and server build passed. See [policy evidence](evidence/2026-10-03/policy/authorization.json). Persistent grants, production target resolvers, unknown reconciliation and audit redaction remain unfinished; T-008 and Goal remain active. No global acceptance or remote action claim.

## T-008 continuation: observation-based reconciliation core

Implementation `8d3bfea22a1fab258d53b5ee3abb84bb50db3878` adds a trusted adapter observation seam and durable reconciliation receipts (domain v6). Observations must bind exact operation/intent, carry an evidence reference and observation time, and settle only a matching unknown revision. Results/receipts/events commit atomically. Successful request replay returns the persisted receipt without another query. Unknown observations remain unknown; Work never auto-restarts.

Seven reconciliation/ledger tests passed. A synthetic receipt file demonstrates result-loss recovery without tool replay; cancellation, evidence mismatch, concurrent CAS and restart idempotency are covered. Typecheck, server build, lint, format and source guards passed. See [reconciliation evidence](evidence/2026-10-03/policy/reconciliation.json).

This is a core seam, not a completed user-facing reconciliation flow: real status adapters and owner API/UI are pending, alongside grants, target resolvers and redaction. No client may submit an outcome through HTTP. T-008 and Goal remain active; no live or remote action.

## T-008 continuation: public evidence redaction

Implementation `9f91549695deb8131a5fbfa056b4e5fde68b0fec` masks recognized credential fields/patterns and current configured model secret values before new domain event persistence, and at HTTP/SSE/AG-UI output. Nested JSON tool text is handled without changing ordinary text formatting; public numeric usage is retained. The dedicated local session bootstrap remains functional.

All 77 tests across 22 files passed, plus typecheck, server build, lint and formatting. Tests inject synthetic credentials into tool evidence and Work text, verify persisted events and public projections, and explicitly show that private Work storage is not a scrubbed export. See [redaction evidence](evidence/2026-10-03/policy/redaction.json).

This is not universal DLP or complete private-data retention handling. Old unavailable secret values, private checkpoints/results and diagnostics require later lifecycle/export work. T-008 remains in_progress for grants, actual target resolvers and concrete reconciliation integration. Goal active; no live/remote actions.

## T-008 continuation: durable scoped grants

Implementation `62605214b2eec7a86147be7bebc494aa5d2a6695` adds domain v7 capability grants. Daemon-issued known_read/local_new scopes bind Work/run/session, canonical target, policy revision and optional expiry. Critical/unknown cannot be granted. Revocation is CAS-protected and persistent; issuance replay never revives a revoked scope. New explicitly submitted synthetic Work receives one read scope, checked at actual broker dispatch.

Six grant/ledger tests, seven native/configured regressions and a final two-test grant run passed. The latter proves revocation prevents every MCP operation dispatch, not merely successful results. Typecheck, lint and server build passed. Initial update-path issuance was caught by regression and moved to submit-only. See [grant evidence](evidence/2026-10-03/policy/grants.json).

Owner management API/UI and real workspace scopes are not implemented. Target resolvers and concrete reconciliation remain pending; T-008 and Goal stay active. No live/remote actions or global acceptance promotion.

## T-008 continuation: permission revocation API/UI

Implementation `eb88dcbd5bd47449a5b9936b3cd2e01863d141db` exposes schema-validated Work grant listing and session-protected revocation. Domain v8 adds request receipts so retries/restarts cannot duplicate revocation. Work details lazily display the existing synthetic scope and a revoke control; no UI/API creates broader grants. Copy states revocation affects future use, not already dispatched effects.

Seven functional browser tests and three focused grant tests passed. The browser exercised revoke, reload, remaining write rejection and mobile rendering; API tests verify session protection, unsupported-field rejection and persisted idempotency. Typecheck, server build, lint, formatting and source guards passed. See [grant UI evidence](evidence/2026-10-03/policy/grant-ui.json).

T-008 remains in_progress for real target resolvers and concrete reconciliation integration. Strict browser egress was excluded and remains an open failure; Ubuntu unverified. Goal active; no live/remote action.
