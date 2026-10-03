# Rocky implementation progress

2026-10-04, Asia/Taipei. Current work: OpenDots-aligned main chat, configured native conversation/MCP tools and data, and registered workspaces with explicitly granted native root/child reads, exact-approved root writes and Git worktree creation, plus immutable artifacts, a responsive result pane and owner Markdown revision editing. Rocky V1 remains incomplete; see dated evidence below and known-limitations.md.

| Task                  | Status      | Actual result                                                                                                                                                                       |
| --------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-001                 | done        | Independent Git root and local commit, original engineering files, Apache-2.0, workspace, new CI and reference decisions. Remote uncreated.                                         |
| T-002                 | blocked     | Locked dependencies, installed license inventory and Windows clean-copy no-Python validation. Ubuntu evidence unavailable.                                                          |
| T-003                 | in_progress | Real CopilotKit gateway → Work → native Deep Agents task/todos/interrupt → stdio/HTTP MCP. Functional browser flow verified; upstream P0 gate open.                                 |
| T-004                 | blocked     | Four Promptfoo full-path cases and Node egress pass with blocked SDK telemetry recorded. Browser egress fails from host AdGuard injection.                                          |
| T-005                 | done        | Validated DTO/event/error/IPC wire contracts and cursor-based snapshot synchronization. Worker IPC execution remains T-009.                                                         |
| T-006                 | done        | Domain schema v2, identity-preserving CAS, atomic events/outbox, recoverable completion projection and OS-released single writer lock.                                              |
| T-007                 | in_progress | Model UI/API, shared Work/evaluation routing, budgets, live probe and proxy/CA tests; profiles/cache pricing/full DNS policy pending.                                               |
| T-008                 | in_progress | Canonical intent, grants, exact consent, target claims/recheck, redaction and synthetic MCP reconciliation API/UI; final scope audit pending.                                       |
| T-009                 | done        | Durable child IPC and configured/fixture native Deep Agents workers; daemon owns model/tool RPC, shutdown and descendant cleanup.                                                   |
| T-010                 | done        | Durable bounded admission, main/background/evaluation slots, workspace UUID reservations, model semaphore and pinned budget/configuration.                                          |
| T-019                 | in_progress | OpenDots compact shell/main chat slice, model popovers/dialog, original avatar, approvals/stop/reconcile; full tools/results/presence remain.                                       |
| T-037                 | done        | Original editable SVG identity, tokens, persistent assistant ID and versioned persona; rendered baseline, rights review pending.                                                    |
| T-011 / T-018         | in_progress | Configured provider incremental SSE, common UI adapter, snapshot reconnect and numeric cursor replay; other contracts pending.                                                      |
| Later tasks           | pending     | Product modules and confirmed-state presence remain pending.                                                                                                                        |
| T-014 / T-015 / T-021 | in_progress | Configured MCP registry, lifecycle/discovery and settings verified locally; full process/network/permission scope pending.                                                          |
| T-016                 | in_progress | Configured dispatch, typed media and original resource/prompt envelopes implemented; target mapping, advanced schemas, generic reconciliation remain.                               |
| T-017                 | in_progress | Registered roots, native reads/writes, bounded diff, overlapping-root admission and exact-approved Git worktrees; shell/default coding isolation/full leases/reconciliation remain. |

T-020 is in_progress: immutable snapshots, ID-only downloads, result pane, owner Markdown revision CAS/editor and restricted isolated HTML preview implemented; native same-Work artifact publication implemented; document tools, images and file-context references remain open.

Node 24.12.0 / npm 11.6.4 baseline. OpenDots MIT presentation CSS adapted with notices; no upstream history, backend, data, settings or brand assets imported. Test data is synthetic. No remote action; existing live probe evidence is separate from this fixture UI slice. See known-limitations.md for gates and follow-up.

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

## T-008 continuation: canonical file target resolver

Implementation `50b00b8f2d612c0b79afdd9d654b929d5635ac2e` adds a bounded regular-file/missing-leaf resolver for trusted owner-selected roots. Snapshots bind canonical path, root/parent/file identity, metadata and content digest. Open-file identity is checked before content reads and again afterward. Explicit recheck rejects changed contents or newly occupied paths. Traversal, alternate streams/device names and symlink/junction/hard-link targets are refused conservatively.

Three real filesystem fixture tests passed on Windows, including junction creation/replacement and hard links. Typecheck, server build, lint, formatting and source guards passed. See [file target evidence](evidence/2026-10-03/policy/file-target.json).

This core is not yet a workspace registration/write flow, and does not eliminate external OS races after checking. Target leases/adapter integration and concrete reconciliation remain pending. T-008 and Goal stay active; no foreign repository or private data touched.

## T-008 continuation: durable target execution claims

Implementation `3af73a864efeedca6009a590e3b239c40fd9a82e` adds domain v9 canonical target claims. Dispatch acquires a unique target claim in the same transaction as the operation CAS and evidence event. Another Work cannot dispatch to an already claimed identity. Successful settlement releases the claim; unknown results retain it through restart until a known reconciliation outcome commits. Prepared/authorized records hold no execution claim.

Full Windows regression passed: 84 tests across 24 files, including restart, cross-Work exclusion, unknown observation retention and known-result release. Typecheck, server build, lint, formatting and source guards passed. See [target claim evidence](evidence/2026-10-03/policy/target-claims.json).

These are daemon database claims, not OS locks. Synthetic broker identity is scoped per run; shared target exclusion uses an explicit synthetic identity in tests. Real workspace integration and concrete reconciliation API/UI remain pending. Historical records without target identity are not assigned inferred claims. T-008 and Goal remain active; no live/remote action or global acceptance promotion.

## T-008 continuation: MCP receipt reconciliation API

Implementation `25d006ae666c6ec44eb54ad079a6b12c91b59951` connects WorkService to a concrete synthetic MCP status adapter. Fixture writes create exclusive durable receipts bound to daemon operation identity/intent; receipt creation is the synthetic effect itself. MCP resource reads recover those receipts across stdio/HTTP process restart. Missing receipts remain unknown. The daemon-only observer validates binding; callers cannot supply outcomes. Work operation listing and session-protected reconciliation endpoints now have schema-validated summaries/receipts. Reconciliation never resumes a blocked Work automatically. Shutdown aborts and drains pending reconciliation queries.

87 tests across 24 files passed before the API addition; 15 focused tests passed afterward, followed by a final six-test reconciliation run exercising session denial, client-outcome rejection and real HTTP routes. Both MCP transports recovered deliberately discarded replies after restart without rewriting receipts. Three network tests and four full-Agent fixture evaluations passed. Typecheck, server build, lint, formatting and source guards passed. See [MCP reconciliation evidence](evidence/2026-10-03/policy/mcp-reconciliation.json).

This proves the synthetic adapter, not arbitrary external MCP status semantics. Owner reconciliation UI and real workspace adapters remain pending. T-008 and Goal remain active; Ubuntu/strict browser egress remain unverified and no global AT status changed. No live model or remote repository action.

## T-008 continuation: owner reconciliation UI

Implementation `1a3c131891e4896eb049d9b94d1465e90f838797` adds collapsed Operations and reconciliation to Work details. It loads schema-validated operation summaries, refreshes on confirmed operation events, queries existing receipts and distinguishes known success from still-unknown outcomes. Query errors retain the same request ID for retry. The copy states that querying does not resend the tool or automatically restart Work.

Eight functional browser tests passed, including real UI to daemon to MCP receipt queries for recorded and absent receipts, reload persistence and 320px screenshots. The test harness seeds a simulated crash boundary before starting the isolated daemon; no production fault endpoint exists. Receipt files remain unchanged across queries. Typecheck, production build, lint, formatting and source guards passed. See [reconciliation UI evidence](evidence/2026-10-03/policy/reconciliation-ui.json).

Only the synthetic write adapter is supported. Real workspace integration and external adapter semantics remain pending; T-008 and Goal stay active. Strict browser egress was excluded, Ubuntu remains unverified, and global AT statuses are unchanged. No live/remote action.

## T-009 start: bounded run-scoped worker channel

Implementation `48a6efda0f2c0b5c9ff1c675c50715cb6d09cfe0` adds a daemon-owned channel to a trusted Node entry. Each channel binds a stored running Work/run/session to a random capability, verifies strict wire schema and monotonic sequence, correlates request IDs, limits eight in-flight requests and closes on protocol/backpressure violations. Credentials and domain path are not provisioned in the child environment. Local cancellation bounds waiting even if a handler ignores its signal; uncooperative children are terminated after a grace period.

Five real child lifecycle tests plus two contract tests passed on Windows. Capability forgery never reaches the handler; roundtrip returns the correlated result; flood and stubborn-child cases clean up. Typecheck, server build, lint, formatting and source guards passed. See [channel evidence](evidence/2026-10-03/worker/channel.json).

T-009 is in_progress for this independent channel layer only: upstream T-007/T-008 remain open, and Deep Agents still runs in the daemon. Agent IPC integration, durable daemon-owned jobs and descendant process-tree tests remain required. This is not an OS sandbox or evidence that cancelled external effects stopped. No global acceptance promotion, live or remote action.

## T-009 continuation: durable worker process state

Implementation `7f973e4422d91ac355a2bdd011f42f977bc681cf` adds Rocky domain v10 worker jobs. The daemon atomically records starting, running and terminal child states, with one active worker per run and public events. The real child channel records process exit, protocol failure and explicit cancellation separately. On daemon restart, stale starting/running rows become interrupted exactly once; Work restart recovery still blocks the prior active Work. A clean process exit is not treated as Work completion.

All 93 tests in 25 files passed on Windows. The dedicated real-child tests cover normal exit, capability violations, queue overflow, shutdown and restart recovery. Typecheck, server build, lint, formatting and source guards passed. See [worker job evidence](evidence/2026-10-03/worker/job-lifecycle.json).

T-009 remains in_progress: the Deep Agents runtime still runs in the daemon, and process-tree cleanup and durable job admission are not complete. Recovery cannot prove an orphaned detached process stopped. Ubuntu and strict browser egress gates remain open; no live model, remote action or global AT promotion.

## T-009 continuation: actual descendant cleanup

Implementation `bfbfbe111fd07ed5f5858d6bfdd3d7c75fd355bb` extends the synthetic worker to spawn a persistent Node descendant and tests shutdown of the worker process tree. The test confirms the descendant PID is alive before cancellation and absent afterward; it also has its own leak cleanup for failures. Seven worker tests passed, plus typecheck, server build, lint, formatting and source guards. See [process tree evidence](evidence/2026-10-03/worker/process-tree.json).

This Windows test covers one real descendant, not every process-tree shape or Ubuntu. It does not prove an already dispatched external effect stopped. T-009 remains in_progress until native Agent execution and daemon IPC integration are complete; no global AT promotion, live model or remote action.

## T-009 continuation: native fixture Agent in child process

Implementation `f752774e4950d4664cae93e0b84b63be09e48647` moves the synthetic Work's Deep Agents root and native child into an agent-worker process using its own graph saver connection. The daemon retains model budget reservations, MCP calls, policy, approvals, operation ledger and Work state. Versioned bounded IPC carries model/tool requests, runtime events, invocation results and exact approve/reject resume. The child serializes public message fields explicitly; normal terminal results close the child, while approval interrupts keep it available for resume. No second planner or model loop was introduced.

The full Windows suite passed: 95 tests in 25 files. Eleven focused runtime/worker tests exercised native child evidence, approval, resume, stop and process exit; eight functional browser tests passed. Three network tests and four full-Agent fixture evaluation cases passed, as did typecheck, production build, lint, formatting and source guards. See [fixture Agent worker evidence](evidence/2026-10-03/worker/fixture-agent.json).

T-009 remains in_progress because configured Work still creates its Agent in the daemon. The current Node network audit instruments the parent process only; direct worker egress is not proven absent. Native worker code is trusted but not OS-sandboxed. Strict browser egress and Ubuntu remain open; no global AT promotion, live model or remote action.

## T-009 complete locally: configured Agent worker and Node network guard

Implementation `5cb4dbb306156a77ff3f002c8902460eebedb0d3` moves configured OpenAI-compatible and Anthropic Agent execution into the same worker used by fixture Work. The daemon retains provider I/O and credentials, model budgets, MCP dispatch, policy, ledger and approval authority. Bounded model IPC now carries text/tool messages and tool definitions; the daemon no longer has a fallback Agent or graph saver connection. The production build copies the worker network preload. The preload denies direct fetch, TCP, TLS, HTTP and UDP through common Node APIs before the Agent modules load.

The final Windows suite passed: 96 tests in 26 files, including configured approval/resume, native child, persisted worker exit, lifecycle/capability tests and a separate network-denial subprocess. Eight functional browser tests passed, including configured Work, reload while approval waits and explicit stop. Three network tests and four fixture Agent evaluation cases passed. A clean-copy Node-only run passed `npm ci`, check, build, all 96 tests and fixture learning with zero Python/compiler calls after aligning local npm to 11.6.4. Typecheck, production build, lint, format, docs and source guards passed. See [configured Agent worker evidence](evidence/2026-10-03/worker/configured-agent.json).

T-009's local lifecycle and IPC doneWhen are met, so its plan status is `done`. T-007/T-008 remain open for their broader deliverables, and no global AT was promoted. The Node guard is not an OS packet or filesystem sandbox; Ubuntu and the strict browser egress case remain unverified. No live paid model or remote repository, push, merge, tag or deployment action was performed.

## T-010 start: durable main/background admission

Implementation `deeae5c2c04501d902560d5a2a8b54f0c967e6ab` records main/background kind per Work and pins it through Store CAS. Admission now reserves one main invocation, allows two background sessions, and gives evaluation a separate class. A bounded durable queue accepts excess work without starting a worker or model request. Releasing a slot admits the next queued Work. On restart only queued commands are re-admitted; previously running or approval-waiting executions remain blocked instead of replayed.

The full Windows suite passed: 98 tests in 27 files. New integration tests cover four distinct sessions, main availability alongside two backgrounds, queued zero-call/zero-worker state, slot release, immutable kind and queued restart. Typecheck, build, lint, formatting, docs and source guards passed. Eight browser flows passed before the final backend-only queued-recovery change. See [admission evidence](evidence/2026-10-03/work/admission.json).

T-010 remains `in_progress`: workspace reservation, a global model-call semaphore, configurable capacity bounds, Learning priority and complete setting/workspace snapshots are still required. The restart test uses an isolated seeded crash boundary rather than a power-loss test. Ubuntu and strict browser egress are still open; no global AT or remote action was claimed.

## T-010 continuation: global model dispatch slots

Implementation `55529d702acc3f09d5036a650cdc6b814fb59c54` adds one daemon-wide bounded model semaphore for configured and fixture Work. Waiting requests hold no model slot; cancellation removes their waiter. At a free dispatch boundary, main requests take priority over background, which takes priority over evaluation. An already-sent provider call is not forcibly preempted. The worker-to-daemon model RPC combines Work and request cancellation before acquiring a slot, and configured requests carry that signal into the provider adapter.

The full Windows suite passed: 101 tests in 28 files, plus typecheck, production build, lint and formatting. Unit tests verify ordering and waiter cancellation. An integrated held-provider test confirms that two background calls occupy the slots, a main call remains unsent, and stopping a background Work lets the main request dispatch. See [model slot evidence](evidence/2026-10-03/work/model-slots.json).

T-010 remains `in_progress` for workspace reservation, configurable slot bounds, wall time and complete setting/workspace snapshots. These slots are per-daemon, not provider-enforced or an OS resource limit. Ubuntu and strict browser egress are unverified; global acceptance remains unchanged.

## T-010 complete locally: bounded Work admission and request snapshots

Implementation `ead307c7733284ca4642daa5164669774e152e31` completes bounded admission settings for main, background, evaluation, model calls and the durable queue. A submitted Work pins its model selection, resource key and active wall time budget; Store CAS rejects later changes to these and the other command fields. Works sharing a resource key wait before worker or model dispatch, while unrelated Work can run. A blocked interrupted owner keeps its resource reserved after restart. Approval wait does not consume active execution time; exceeding that time fails the Work without asserting an unknown effect succeeded.

On Windows x64 with Node v24.12.0, npm 11.6.4 and lockfile SHA-256 `d90798fe96f8deb8d5fdd8e1393ac8173113afffa571cf643102dc967b90cdea`, `npm test` passed 108 tests in 28 files. The 10 focused admission tests cover independent sessions, repeat/restart background receipts, changed-payload rejection, resource waits, immutable snapshots and wall budget. Eight local Chromium flows, three network tests and four fixture Agent evaluation cases passed. Typecheck, production build, lint, format, docs, source guards and the clean-copy Node-only install/test/learning check passed. Commands, exit codes and limits are recorded in [T-010 completion evidence](evidence/2026-10-03/work/complete.json).

T-010's local doneWhen is met and its plan status is `done`. Resource identity is still an opaque UUID, not a canonical workspace or OS lock; T-017 owns that boundary. The restart case is an isolated seeded crash boundary, not a power-loss test. Ubuntu, strict browser egress and live paid-model behavior remain unverified; all global AT statuses stay `not_run`. No remote repository, push, merge, tag or deployment action occurred. Work on the broader Rocky goal stops here at the user's request.

## 2026-10-03 — OpenDots 主對話切片／持續 Goal

在 codex/opendots-ui-alignment 實作，Goal 保持 active，T-019 in_progress。替換 shell／配色／sidebar／topbar／persona／composer，保留 daemon commands；四尺寸 reference/before/after 與核准／完成畫面見 uiux-opendots-alignment.md。全域 AT 不變。

本輪 Windows：typecheck、lint、docs DAG、build exit 0；28 files／108 tests passed；9 functional browser tests passed（排除既有 host AdGuard egress 阻塞）。實測四尺寸無全頁水平溢出，drawer Escape/focus、light/dark、模型設定、budget、核准、停止、revoke、reconcile 通過。不是 live／Ubuntu／全版 UI 驗收。

未完成：真正 incremental streaming／steering／history/inbox、真 MCP/workspace、成果文件／Computer、memory/skills/Learning、backup/package。下一項：完成共用 UI adapter 與主對話 reconnect／增量 runtime delivery，按 T-011～013 契約接續；環境驗證按兩次／15分鐘上限遞延，沒有遠端動作。

## 2026-10-03 — 增量串流／adapter／cursor 回歸

Source 04e1e94436e98b24cd6ac72b6c802fea008c2477。OpenAI-compatible／Anthropic root SSE 真正增量輸入、工具參數完整驗證、正式終止訊號、公開文字與 reasoning 分離；daemon 持久化 streams 並映射 AG-UI TEXT_MESSAGE_*。片段不改 Work 終態，停止仍是精確 server command。

新增共用 Rocky projection／commands、初始 snapshot 失敗重連、斷線 Enter 防送出、mobile dialog 焦點返回。修復 SQLite CAST sequence alias 的字典序，改按 integer column 排序；AG-UI 逐頁排完該 Work 事件才送 receipt。1,001 chunks replay、截斷兩種 provider、不調用工具、unknown usage、split credential 遮罩都有測試。

Windows：31 files／117 tests、11 browser tests、check／lint／build 通過；最後 focused streaming viewport 測試 1 passed。證據 evidence/2026-10-03/streaming/verification.json。T-011／018／019 均 in_progress，AT 不變。短尾遮罩與結構化內容可能延後顯示，recent-event projection 還不是完整 Message persistence。下一項為 guarded native scratch backend／持續對話與安全 inbox；未執行 live／Ubuntu 或遠端操作。

## T-011: guarded native scratch backend

Local commit dca0cd8 enables the public StateBackend and native file tools in run-private /scratch graph state. Context offload paths are read-only; host files and execute remain denied. Public traces omit scratch contents. Actual native write/edit/read, checkpoint state, separate-thread isolation and denial-before-dispatch tests pass.

Windows fixture: typecheck, lint, build and all 120 tests pass (32 files, 56.09s). See [evidence](evidence/2026-10-03/native-scratch.json). Context compaction, durable continuous conversation and inbox barrier remain pending; T-011 stays in_progress, global AT remain not_run. Next: conversation/history and execution-session persistence.

## Conversation and execution-session persistence

Local commit f911e75 adds one durable main Conversation, separate per-Work ExecutionSession records, and immutable user/result history. Main active session follows daemon Work state; background/evaluation sessions do not replace it. Submission/history writes share domain transactions; outbox result delivery is deduplicated. New history API uses bounded numeric pagination, current public redaction and excludes evaluation data. Own Rocky schema10 upgrades to11 with source chronology; no foreign-store importer.

Windows fixture: check/lint/build pass, all 124 tests pass (33 files, 57.81s); actual streaming/reconnect browser regression passes 2 tests (23.6s, existing Chromium148). Initial test cleanup/schema-version assertions were corrected; see [evidence](evidence/2026-10-03/conversation-history.json). T-011/T-013/T-018 remain in_progress: history UI paging, cross-turn model context, precise steering and checkpoint/inbox acknowledgement are unfinished. No global AT pass or remote action.

## T-018/T-019: persistent history paging and scroll behavior

Local commit 0ad6624 connects bounded persistent history to the shared snapshot/SSE adapter. Work events carry validated stored history references without adding event-source owners or changing outbox event counts. UI loads earlier records by stable cursor, retains already-loaded records on reconnect and keeps active Work controls visible. Reading above bottom survives actual provider fixture SSE; new-content action returns to bottom. Keyboard paging returns predictable focus.

Windows fixture: all 124 tests pass, 12 functional browser tests pass (49.8s), final stronger stream-scroll test passes (21.7s) and final history/reconnect tests pass (5.4s). Typecheck/lint/build pass. Long-history fixture checked at1440/390/320px; no page overflow, composer visible. See [evidence](evidence/2026-10-03/history-ui/verification.json). UI history pages, but full Work snapshot pagination, model cross-turn context, inbox barrier and remaining product modules are unfinished. Global AT remain not_run; no remote action.

## Canonical conversation view

Commit702ca02 completes the GET/conversation bounded visible-history/cursor and active-session DTO. Active session comes from daemon domain state and missing referenced data fails closed. Windows fixture: typecheck/lint and8 targeted conversation/HTTP tests pass; final4 active-session/cursor assertions pass. See [evidence](evidence/2026-10-03/conversation-view.json). No new browser/build/platform claim; cross-turn graph context and inbox consumption still need implementation. Goal remains active.

## T-011: confirmed native context across main turns

Commit7287653 selects the immediately prior completed main checkpoint only within the same model revision/mode/workspace. Official public updateState copies messages/files into a new owned thread, without copying pending tasks/interrupts/effects. Sync checkpoint durability is enabled; background/evaluation remain independent. Default chat stops inventing a workspace UUID.

Actual Windows fixture tests prove model recollection after next turn/restart, scope isolation, fresh approval and unchanged old operation rows. Typecheck/lint/build and126 tests pass; four browser functional checks pass, while the selected command also ran the known AdGuard egress case and exited1. Final stronger workspace assertions pass. See [evidence](evidence/2026-10-03/continuous-context.json) and [design](native-context-copy.md). Cancelled turns/model changes still reset model context, and safe rebuild, long-history compaction, steering and inbox acknowledgement remain pending. T-011/T-013 stay in_progress; no global AT pass or remote action.

## Owned context batch and inbox checkpoint barrier

Commit370e855 preserves safe completed main context across cancellation/model changes within mode/workspace scope. Missing visible main instructions/receipts are added without uncertain graph tasks. Background completion receipts are snapshotted at admission, chunked over bounded IPC, and acknowledged only after the daemon verifies their exact contents in the owned native checkpoint. Membership follows the selected completed graph ancestry; a failed branch does not permanently consume results.

Windows fixture: check/lint/build pass, 36 files/128 tests pass (82.82s), 15 focused tests pass and 4 functional browser tests pass (35.7s). Cross-owner/cursor/checkpoint denial, transactional fault rollback, idempotent acknowledgement, late completion and failed-branch redelivery have actual tests. See [evidence](evidence/2026-10-03/inbox-checkpoint.json). T-011/T-013 remain in_progress; long-history compaction, large-model transport, steering and full crash matrix remain pending. Goal active; no global AT pass or remote action.

## T-011: bounded large model request transport

Commita2d2ef1 removes the100-message small-request transport ceiling. Private model request frames remain below64KiB; a channel validates exact transfer identity/order/byte count/digest and complete schema before one daemon model dispatch. Limits remain explicit:2MiB/request,4096 messages,8 concurrent transfers and8MiB declared aggregate. Root/child interleaving is supported; shutdown clears buffers. Existing capabilities, sequences, cancellation, model slots and budget authority remain intact.

Windows fixture: check/lint/build pass,37 files/133 tests pass (85.62s);13 focused tests pass and actual browser stream/stop regression passes (23.0s). An actual native checkpoint with240 Unicode human messages crosses real child IPC intact and reaches one daemon handler. See [evidence](evidence/2026-10-03/model-transfer.json). Native compaction, large-response/tool-output transport and remaining T-011 acceptance are unfinished. Goal active, AT unchanged, no remote action. Next: model profile-driven native compaction and repeated compaction/failure scenarios.

## T-011: native compaction and model context profiles

Commit7a6a98e forwards the configured input profile to WorkerModel, replaces the same-name native summarization middleware using the public SDK and preserves native cutoff/session metadata and todos across new Work. Target bindTools calls carry trusted purpose; unbound native summaries use the same daemon model selection/slots/budget with no reply-stream projection. Invalid summaries fail closed. No SDK patch or second runtime.

Windows fixture: check/lint/build pass;38 files/138 tests pass (90.06s);5 focused native tests pass. Three compactions, smaller configured context, checkpoint goals/corrections/todos/raw evidence, summary failure, truthful long-file truncation/pagination and summary accounting/projection are verified. Browser initially failed because the synthetic model did not support summaries; that explicit fixture was fixed, then2 browser flows pass (26.7s). See [evidence](evidence/2026-10-03/native-compaction.json) and [design](native-compaction.md). Child compaction, full crash recovery and large response/tool-result transport remain pending. T-011 in_progress, global AT unchanged, Goal active, no remote action.

## Bounded large results in both IPC directions

Commitd3f595b adds validated result framing for daemon model/tool responses and worker final invocation results while preserving64KiB envelopes. Promise delivery requires exact current request, kind, sequential chunks, byte count and digest; incomplete transfers cannot be replaced by a direct result. Send callbacks bound queued frames; cancellation/ownership checks remain active. Agent exit0 without confirmed result now records an interrupted worker job. Daemon Work/operation state remains authoritative.

Windows fixture: check/lint/build pass;39 files/147 tests pass (94.15s);17 focused transfer/worker tests pass,3 continuous tests including large Work/history pass,2 configured/stream/stop browser flows pass (27.6s). Native approval tool receipt executes once and full raw offload survives checkpoint. See [evidence](evidence/2026-10-03/result-transfer.json) and [design](result-transport.md). Per-result2MiB limits reject excess; large public projections/arguments, steering/reset/retry and full recovery remain pending. Goal active; AT unchanged; no remote action.

## Owned native steering and truthful receipts

Commit1350956 adds exact run/session/revision steering commands with persistent idempotent receipts. Root native middleware stages Human corrections at the next model boundary; the daemon verifies exact contents in the owned checkpoint before atomically publishing applied/history/event. Terminal or stopped Work settles pending corrections as not_applied without ghost history. Native child and independent background execution do not consume the root correction. UI uses existing events and collapsed Work details, with accepted/applied/not_applied labels and honest delayed-application explanation.

Windows fixture: check/lint/build pass;40 files/150 tests pass before the extra child-boundary assertion; final6 focused tests pass (9.41s),2 browser flows pass (28.1s). Viewed Work element screenshots at1440/390; these are not full viewport alignment evidence. Initial nested lifecycle transaction failure was fixed. See [evidence](evidence/2026-10-03/steering/verification.json) and [design](steering.md). T-012/T-019 in_progress; pending-approval supersession, explicit ACK/restart faults, attachments and reset/retry remain pending. Goal active, global AT unchanged; next: terminal retry as a new Work and recovery boundaries, then real configured MCP/workspace capabilities. No remote actions.

Followup: multiple steering corrections exposed Work history-reference growth beyond the existing2-reference schema. Event query now returns at most the latest2 references; full immutable history remains paginated. Actual root/child tests apply2 corrections and4 steering tests pass; store/projection6 tests and explicit conversation-store regression pass, typecheck exit0. This is a bounded projection fix, not a change to stored history or authority.

## Explicit retry without prior-effect replay

Commitc533a58 adds terminal/inactive retry as a new Work/run/session/budget with durable retryOf and immutable original source. Exact target/idempotency survives restart; unknown effects block retry; confirmed known outcomes require current operation/reconciliation refs. New checkpoint carries prior receipt evidence, including isolated background retry context. Preparing a repeated succeeded tool/argument is denied; known-no-effect requires fresh approval. UI reviews effects in collapsed Work details and labels new retry cards, using shared events and stable submission IDs.

Windows fixture: check/lint/build pass;41 files/154 tests pass (105.09s);14 focused tests pass;2 browser flows pass (14.1s), final stronger mobile control/focus assertion passes (8.6s). Viewed1440/320 screenshots. Initial background context gap and test-only null/Stop/lint mistakes were fixed before final checks. See [evidence](evidence/2026-10-03/retry/verification.json) and [design](retry.md). T-013/T-019 remain in_progress; full crash/retry ancestry/race matrix, reset, model override UI, actual MCP/workspace target bindings and later modules remain pending. Goal active; global AT unchanged; no remote actions. Next: configured MCP registry, process lifecycle/discovery/schema and real tool routing.

## Rocky MCP configuration registry and settings

Commitc9d8d4e (extra assertions01788a6) adds strict mcpServers/x-rocky version1 stdio/HTTP configuration, empty/disabled defaults, environment/header references, canonical config hash, revision/CAS and atomic configuration/receipt replacement. Failed validation or injected receipt-write failure preserves settings. New daemon launchSpec constructs controlled reference/env/cwd values without spawning; ordinary public evidence combines model/MCP redaction. MCP API preserves validated reference mappings and never returns resolved launch secrets. Advanced JSON editor is inside the existing settings dialog and honestly reports disabled/configured, never connected/verified. Composer textarea layout is scoped to avoid breaking other editors.

Windows fixture: check/lint/final build pass (13.96s);42 files/157 tests pass (106.43s);8 focused tests pass, final3 registry tests pass with unavailable/stale assertions. Final2 browser flows pass (10.1s), including four settings widths and steering regression. Viewed1440/320 screenshots; no page horizontal overflow, Save focus/reload/foreign-input rejection pass. Initial broad browser alert selector and visually found textarea layout were fixed. See [evidence](evidence/2026-10-03/mcp-registry/verification.json) and [design](mcp-registry.md). T-014/T-021 in_progress; transport/process lifecycle, complete discovery/schema validation, network/OAuth/proxy/CA, credential versions/revocation, runtime routing and structured forms pending. Goal active; global AT unchanged; no remote actions. Next: T-015 official SDK transports, bounded discovery and process ownership.

## Configured MCP lifecycle and complete paged discovery

Commit5488911/followup4b2384c adds daemon-owned official stdio/HTTP SDK connections, persisted lifecycle command IDs/states/catalog revisions, bounded full discovery, explicit Stop/reconnect and config revocation. No tool calls are replayed or exposed outside Broker. SDK inherited env defaults are emptied unless allowed; Windows names resolve case-insensitively. Diagnostics are bounded, UTF-8 decoded, credential redacted through shutdown and incomplete EOF prefixes masked. HTTP exact endpoint/instance checks, redirect denial and response limits remain active. UI uses actual state/count/last-confirmed timestamp with Connect/Stop/Refresh and collapsed diagnostics.

Windows fixture: check/lint/final build pass (14.08s);43 files/164 tests passed before two added boundary cases/final shutdown correction; latest12 focused tests plus3 EOF assertions pass.2 browser flows pass (7.3s), including actual HTTP fixture ready/reload/stop and four-width settings. Initial fixture405, Windows env case, JSX compile error, stale saved hint and shutdown stderr race were fixed; see [evidence](evidence/2026-10-03/mcp-lifecycle/verification.json) and [design](mcp-lifecycle.md). T-015/T-021 in_progress; real Broker tool routing/full schema/result validation, descendant cleanup, DNS/proxy/CA/OAuth/credential rotation and full fault matrix remain pending. Goal active, global AT unchanged; no remote action. Next: T-016 guarded original MCP schemas and Work tool execution.

## Configured MCP schema boundary — 2026-10-03

Source 4112fb7: original JSON schemas now gate ready discovery and daemon tool preparation; same-name tools have server-specific identities, and annotations remain unknown effects. Windows check/lint/build and 25 focused tests passed. Formal configured dispatch, exact approvals, typed results and resources/prompts remain pending; T-016 is in_progress. See [MCP schema](mcp-schema.md) and [evidence](evidence/2026-10-03/mcp-schema/verification.json). Goal stays active; no remote action.

## Configured MCP native runtime — 2026-10-03

Source 2d8cdf3 / ce42900: one native mcp_discover/mcp_call strategy now routes exact approved calls through the daemon operation ledger. Four-width browser verifies one actual fixture receipt and no reload replay; error after effect stays unknown and blocks retry. Full183 tests preceded final boundaries/text; latest36 focused tests and final browser passed. T-016 remains in_progress. Next remove inherited sample tools from configured production, then typed results and generic reconciliation. See [MCP runtime](mcp-runtime.md) and [verification](evidence/2026-10-03/mcp-runtime/verification.json). Goal active; no remote actions.

## Configured production synthetic isolation — 2026-10-03

Source7d42223 removes built-in sample tools, fixture MCP startup and sample grants from normal configured Work. Explicit test harness preserves synthetic regression. Full186 tests passed before final grant removal; latest23 focused tests passed after it. Fixture-browser2 and normal-daemon browser1 passed; normal four-width screenshot/binding/receipt evidence is separate from live integrations. See [isolation](synthetic-isolation.md) and [evidence](evidence/2026-10-03/synthetic-isolation/verification.json). Next typed results/offloads and generic reconciliation; Goal active, no remote actions.

## Typed MCP evidence (0cf5d5f)

Typed daemon delivery, sanitized native artifacts, explicit default-off image input, Anthropic/OpenAI-compatible media adapters and native large-result offload preservation are implemented. See mcp-typed-results.md and its dated evidence. T-007/T-011/T-016/T-019 remain in_progress; full MCP scope and V1 are incomplete. Next: generic reconciliation/resources and real workspace tooling; live vision/Ubuntu and long-history media remain unverified.

## Resource/prompt metadata (f9e9a22)

Bounded on-demand resources/templates/prompts discovery now shares mcp_discover and daemon connection revisions. Pure data servers connect, list changes revoke old catalogs, and actual native tests prove no data execution/policy promotion. Check/lint/build and 32 focused tests passed. See mcp-data-discovery.md. T-015/T-016 remain in_progress; exact retrieval/task-data insertion/UI and generic reconciliation are still open.

## Approved MCP data retrieval (567344c)

Root native mcp_data now reads discovered resources/templates/prompts after exact owner approval. Prompt roles remain tool evidence; disabled images are uninspected; unknown after dispatch blocks Work. Existing approval card shows daemon-resolved target preview. Full215 before final changes, final24+11 focused tests, build and two four-width browser flows passed; see mcp-data-retrieval.md. T-015/T-016/T-019 remain in_progress; owner selection UI/reconciliation and later V1 modules remain open.

## Original MCP data envelopes (5505c4a)

Daemon ledger and sanitized checkpoint retain original SDK resources/prompts, including extensions/metadata, without binary duplication in worker delivery. Mapper alone creates model task data; native offload retains dataKind. Full220, focused27, build and two four-width normal-daemon browser checks passed. See mcp-data-envelopes.md. T-016 stays in_progress. Next: T-017 real workspace registration and guarded file operations.

## Native workspace read continuation (2026-10-04)

Source fcca9ad adds immutable registered revision/read intent, atomic per-Work grant, daemon-owned root/child file tools, Unicode/hash-checked pages and scoped checkpoint/history/inbox. Sending resets the next read grant. Read interruption is no-effect, while MCP remains unknown. Native graph-step headroom now derives from the unchanged daemon model-call budget.

Final51 files/236 tests and four normal-daemon browser flows pass; typecheck/lint/build/docs/source/format checks pass. One concurrent Failed-to-fetch browser observation remains unexplained despite isolated/final passes. Full acceptance, native-read theme/focus matrix, Ubuntu/live services and writes/diff/shell/worktree/full locks remain unfinished. See [workspace-native-reads.md](workspace-native-reads.md) and its dated evidence. No remote action; Goal remains active.

## Exact native workspace writes (2026-10-04)

Source 7118f9dbe34576be787fbea92305b029ef5dbac2 adds root-only workspace_write with fresh exact consent, original SHA/absent-target checks, bounded replacement preview, canonical target claim, atomic publication and confirmed receipt. Stale proposals expire; rejected/cancelled operations do not write. Unknown confirmation remains unknown. Native8 and final browser5 pass; full regression/commands are recorded in workspace-native-writes.md and its evidence. T-017 remains in_progress: diff/shell/worktree/full leases/reconciliation and later modules are unfinished. Goal active; no remote actions.

## Workspace difference review (53e9e2cee58c8cd18cee1cc09e275c210e879c48)

Owner-session/exact-approval preview now revalidates original target, shows bounded replacement hunk with encoding notices and retains full new content. Review grants no model access or consent. Final23 focused tests, type/lint/build and four-width overwrite browser flow pass; see [workspace-diff.md](workspace-diff.md). Full diff/editor/leases/worktree/shell/reconciliation and later V1 scope still open; Goal active.

## Canonical root ownership (c63be5a72f91dc78f38c261b4b8b3b8cde4a9bf3)

Admission now serializes parent/child registered roots across different UUIDs before worker/model slots. Native children share root ownership; existing per-target claims remain. Related31 regressions, final5 lease cases, type/lint/build and normal-daemon browser5 pass. See [workspace-leases.md](workspace-leases.md). T-017 worktree/shell/multi-resource locks/reconciliation remain open; Goal active.

## Git worktree adapter foundation (d1181200442a8e9fa4d3b2686dc8a8bfecaf5abf)

Real local Git adapter and6 fixture cases pass: new branch/worktree, source dirty/untracked preservation, stale/replaced metadata, destination/filter/cancel protection and hook positive control. Type/lint/build pass. This is deliberately not exposed yet: daemon consent/ledger, process supervision, registration, native tool, background coding default and UI remain necessary. See [git-worktree-adapter.md](git-worktree-adapter.md). T-017 in_progress; full Goal active.

## Git subprocess supervision (8b9093e672ff78be218d0d447e6ede0a3d2203fc)

Git cancellation now terminates its owned process tree, propagates abort through preparation/verification, and bounds failure reporting when termination cannot be confirmed. Windows parent/descendant fixture verifies an unrelated process survives; six actual Git regressions also pass (7 total). Typecheck/lint/build/format/diff pass. See [evidence](evidence/2026-10-04/git-process-supervision/verification.json). Actual interrupted checkout, Ubuntu and product approval/registration/native-tool/UI integration remain unverified or unfinished. T-017 in_progress; Goal active; no remote actions.

## Exact-approved native worktrees (682b5c3fd2c2d6fc3765c4efed4cefa6d19cf7e0)

Root-only native tool now reaches exact daemon consent/ledger, actual committed Git checkout, verified root registration and immutable receipt. No dirty-source copying, inherited read grant or current Work redirection. Registration failure after Git becomes unknown/blocked with effects retained. Related26 tests, finalnative6, normal-daemon browser6 and type/lint/build pass. See [worktree implementation/evidence](workspace-worktrees.md). Background coding defaults, non-Git isolation, linked-root support, cleanup/reconciliation and later V1 scope remain unfinished. T-017 in_progress; Goal active.

## Immutable artifacts and OpenDots result pane (0a677c28fd8306b28c8ba9a1b1d58a425477d56b)

Confirmed workspace writes can now be saved as immutable hash-verified snapshots, previewed and downloaded from a real right-side results pane. SQL registry/events publish atomically after verified blob storage. Related22 pass; full264pass/1old-schema-assertion failure, corrected by focused4pass (no full rerun); browser6 plus final enriched artifact flow1 pass. Four-width measurements and light/dark-English screenshots in [artifacts.md](artifacts.md). T-020 now in_progress; Markdown CAS/editor, images, rendered isolated HTML, native publication/context references and full comparison remain gaps. Goal active; no remote actions.

## Markdown document revisions (2a1d9208a08a6c6f1a9efc8af1ad7fac4efe7d03)

Owner artifact copies, immutable document versions, exactrevision CAS, persisted receipts and revision downloads now exist. Source editor retains draft on409 and panelclose; owner explicitly compares/rebases before saving. Related17 plus finalUTF8 test pass; browser6 and finalsource-style flow1 pass. See [documents.md](documents.md). Native agent document tools, durable draft recovery, full history UI, images/HTML preview and full reference comparison remain unfinished; T-020/Goal active.

## Restricted HTML previews (cf53d927ce311aba5c8c4f83dfff8d0468f3d768)

Static HTML now renders in an opaque sandbox with daemon-side allowlisting and deny-by-default CSP; source and original download retained. Related8 tests, browser7 flows, four widths and local canary/probe evidence pass. See [html-preview.md](html-preview.md). Global acceptance and remaining V1 gaps unchanged.

## Native artifact publication (0f31a2a4104566b42b9a56fd689d71c599caa59e)

Agent now delivers confirmed same-Work file snapshots through artifact_publish; active ownership/cancellation and immutable receipt checks remain daemon-controlled.11 related tests and actual browser native delivery pass. See [artifact-native.md](artifact-native.md). T-020 remains in_progress.

## Conversation result delivery (e1e3b62f68e5af31340af3df860cb73645c091b4)

Native and owner-published artifacts now appear in the originating Work with direct open/download controls and shared event projection. Four-width browser/reload/focus checks and all7 production-path flows pass. See [artifact-cards.md](artifact-cards.md); fullV1 and visual comparison remain incomplete.

## Independent artifact load recovery (9feaf7920138db6a9729071765697a741daac678)

Shared adapter loads artifact metadata independently of conversation bootstrap; late responses merge immutable records with streamed publications. Failure retains last known cards and shows a retry state in chat/library. Retry affects only metadata loading, not the event stream. Browser injects503, confirms conversation connected/Work visible, removes fault and retries to recover the delivered card. Focused browser1 passed8.9s; type/lint/build/format/diff pass. [Evidence](evidence/2026-10-04/artifact-load-recovery.json). Prior bootstrap dependency limitation is resolved. No new full-suite/theme/reference comparison claim.

## Confirmed presence (3d49ea33c52966c58b893e6bd128f49805c13ef7)

T-038 now in_progress: pure foreground/background/connection projection and bounded motion with persistent preference/reduced motion implemented.6 unit/projection tests and focused normal-daemon browser flow pass. [Presence report](presence.md) lists remaining completion/freshness/navigation/performance scope.

## Completion feedback and sync freshness (05f77122594122b0be2eb3c9fb2933b4dc00af68)

Snapshot cursor seeds the event watermark; completed Run identities seed suppression. Fresh matching main normal completed Work events can trigger one600ms2% scale response. Replayed/older events, repeated completed-run updates, background/evaluation work and unsuccessful states do not. Suppressed motion is consumed, not queued for later. Last-confirmed sync records receipt of validated snapshot/event independently from progress evidence. Browser offline closes the stream and preserves last state/time; online resnapshots.

7 pure/projection tests and focused browser1 pass. Browser observed new completion animation count1, history reload0, offline timestamp with unchanged Work status and online reconnect0. Initial offline test exposed delayed SSE error; browser network events now handle it. Type/lint/build/format/diff pass. [Evidence](evidence/2026-10-04/presence-feedback.json). Completion/freshness gaps in the earlier section are superseded; remaining background/resource/performance/full-platform scope stays open.

## Background navigation (1f1dac70310d3253147d79aa7bccf1aefee459d0)

Background counts now expand a bounded list of actual running/queued/approval/attention records. Keyboard/pointer selection reveals the exact normal Work from existing projection, focuses its article and scrolls the transcript to it. Selection closes the summary; foreground presence is unchanged. Historical background records excluded from initial visible history can be revealed without creating another conversation or mutating domain state. No polling/event source added.

Focused browser1 and full production-path8 pass (44.2s). A real daemon background Work fails against an explicit failing fixture provider; reload, four widths, keyboard navigation, correct failure label and unchanged foreground are verified. Type/lint/build/format/diff pass. [Verification](evidence/2026-10-04/background-presence/verification.json).

Screenshots: [1440](evidence/2026-10-04/background-presence/background-presence-1440.png), [1280](evidence/2026-10-04/background-presence/background-presence-1280.png), [390](evidence/2026-10-04/background-presence/background-presence-390.png), [320](evidence/2026-10-04/background-presence/background-presence-320.png).320 inspected. These are functional after captures, not full upstream comparison.

T-038 remains in_progress for resource waiting, performance and remaining browser matrix. All70 global AT unchanged.
