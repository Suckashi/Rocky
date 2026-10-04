# Known limitations and next gates

- Ubuntu: not run. No WSL/container engine is available on this host; remote creation/push is not authorized. CI YAML exists but has not executed remotely. T-002 and P0 cannot be marked complete.
- Strict browser egress test fails on this Windows host: AdGuard injects local.adguard.org requests. Functional browser test passes independently. No exception was added to the egress assertion, and no OS security setting was changed.
- Pinned Playwright Chromium 1243 download timed out. Browser checks used the existing Chromium 1223 executable via ROCKY_TEST_BROWSER; this does not validate the pinned download/install.
- Promptfoo 0.120.0 attempts an external telemetry-disabled event despite its disable flag. The evaluation command now blocks that request before Fetch dispatch and records it. HTTP/Undici diagnostics observe only configured loopback requests after the guard. This is not OS-level egress enforcement.
- Node built-in SQLite reports its experimental warning in this Node version.
- CopilotKit's initial UI bundle remains large; final bundle budgets/optimization are not claimed. T-037 original vector baseline is implemented; brand distribution rights review and T-038 presence remain pending.
- Work/UI can select an explicitly configured model, with ordinary reported usage and a shared call budget. MCP tools still operate only on synthetic samples; native run-private scratch is real graph state, and strict Rocky MCP configuration registry/settings are now implemented; official SDK lifecycle and bounded discovery now have local evidence; original schema/Work routing, advanced network/credential behavior and host workspace functionality remain unfinished. Configured evaluation selection, editable token/cost budgets and trusted token profiles remain pending. No production credentials, external business service, browser automation capability or paid model has been validated yet. The user has authorized read-only access to Apsis model credentials for forthcoming live validation; no settings import or Apsis change is authorized.
- Four evaluation cases validate integration, not learned-skill quality. Learning is off; no proposals, published skills or claimed improvement exist.
- The executor has a child-process/IPC worker boundary (not an OS sandbox), bounded admission and resource reservation. Owned inbox/checkpoint delivery and native context compaction have local fixture evidence; root steering has local checkpoint evidence; explicit new-Work retry now has local evidence; pending-approval supersession, reset and full recovery acceptance remain pending. T-006 now has a domain outbox, deduplicated completion results and completion-result pagination. Do not expose it beyond loopback.
- No remote repository, visibility configuration, first push, protections, merge, tag or deployment has been performed.

Current runtime evidence: retry.md, steering.md, result-transport.md, native-compaction.md, context-inbox.md and their recorded commands. Long model requests and model/tool/final results now use bounded framing (2MiB per transfer); public snapshot/history payload/performance, oversized arguments, steering ACK/restart and retry ancestry/race fault matrices, reset, child compaction and full recovery remain pending.

Historical slice notes below describe their source commits; later updates supersede absent-context/inbox statements.

Next: continue the authorized OpenDots UI / T-011–013 conversation runtime slice. Ubuntu and clean-browser egress remain deferred until those environments are available. The user has explicitly authorized local feature development while these gates remain open. T-005, T-006 and T-037 have local completion evidence; T-007 configuration/probes are implemented with remaining routing, usage/budget and DNS/rebind work. WSL installation was deferred by the user. Do not mark P0 passed.

- 2026-10-03 OpenDots main-chat slice is implemented, with shell geometry and functional browser evidence. T-019 remains in_progress: full tool cards, right details pane, Computer/documents/Skills/Learning still incomplete. See uiux-opendots-alignment.md; visible gap entrances do not constitute feature completion.

2026-10-03 update: configured root provider SSE is now incremental, with explicit protocol termination, privacy-preserving fragment projection, canonical Work outcomes, numeric ordered cursor replay and an initial-snapshot reconnect action. Local fixture/browser verified; native guarded scratch and persistent conversation/session/history APIs are implemented; cross-turn context, exact steering and inbox/checkpoint coordination remain pending. See streaming/verification.json; no live or Ubuntu claim.

Conversation/history APIs now separate visible user/result records from graph state and per-Work execution sessions. History is immutable, bounded-paginated and excludes evaluation; UI history paging is connected; agent cross-turn context/inbox-checkpoint consumption remains pending. See conversation-history.json.

History UI now uses persistent bounded pages and shared Work-event references; full Work snapshot pagination/performance remains pending. Stream/history scroll verified by local provider fixture. See history-ui/verification.json.

Current status (370e855): safe native main context now survives cancellation/model changes within mode/workspace scope; an owned inbox batch is acknowledged against the actual native checkpoint with branch-aware membership. Earlier absent-context/inbox statements above are historical. Long-history compaction, large-model transport, exact steering/reset/retry and full crash recovery acceptance remain pending. See context-inbox.md and evidence/2026-10-03/inbox-checkpoint.json.

2026-10-03 MCP update: lifecycle/discovery and original schema preparation exist; formal configured tool dispatch remains pending. Nonrecursive local schema refs work, but regex/recursive/external refs and unknown drafts/formats fail closed. No hard schema CPU deadline proven. See mcp-schema.md; these are implementation gaps, not external-service blockers.

2026-10-03 MCP runtime update (2d8cdf3/ce42900): configured normal-mode discovery/call is now connected to exact native approval and daemon ledger. Earlier absent-routing notes are historical. Generic reconciliation/typed results/remote-job semantics/schema supersession remain missing, as does removal of inherited synthetic tools from configured production. Error after dispatch remains unknown; no auto retry. See mcp-runtime.md.

2026-10-03 isolation correction (7d42223): inherited sample exposure in configured production is resolved. Built-in sample bindings, automatic fixture connections and sample grants now require explicit fixture mode/test harness. Earlier missing-isolation statements above are historical. Typed MCP results/reconciliation and remaining V1 modules are still gaps.

2026-10-03 typed MCP update (0cf5d5f): typed structured/image delivery and native large-result media preservation are now implemented. Previous missing-typed-result notes are historical. Image support is explicit and unverified; header checks are not a full decoder. Long-history media compaction, resources/prompts, remote-job tracking, generic reconciliation and target mapping remain open. See mcp-typed-results.md.

2026-10-03 MCP data discovery (f9e9a22): resource/template/prompt metadata can now be explored through the existing adapter; older absence-of-all-data-discovery notes are historical. Actual content retrieval, prompt task-data insertion, template target checks and metadata UI remain missing. See mcp-data-discovery.md for real commands and unrun gates.

2026-10-03 MCP data retrieval (567344c): resource/template/prompt retrieval is now connected through native exact approval and daemon effects. Older absence-of-all-retrieval notes are historical. Owner selection UI, raw SDK extension envelope preservation, optional template parameters/advanced schemas and general reconciliation remain incomplete. See mcp-data-retrieval.md.

2026-10-03 original MCP data envelope update (5505c4a): the raw SDK extension-envelope gap from mcp-data-retrieval.md is now implemented/tested. Previously omitted metadata cannot be recovered; prior-development crash/replay upgrade remains unverified. Owner selection UI, optional template/advanced schemas and general reconciliation remain gaps; see mcp-data-envelopes.md.

2026-10-04 workspace update (67013c5): registered canonical roots and actual owner UTF-8 browsing/preview now exist. Assistant access is not granted by registration; host tools, Work revision binding, writes/diff/shell/worktree/target locks remain missing. Snapshot/recheck is not an OS sandbox or proven race-free filesystem access. Source preview is not an immutable artifact/Document. See workspaces.md and dated evidence; T-017 remains in_progress.

2026-10-04 native read update (fcca9ad): registered revision binding, per-Work grant, native root/child read tools, bounded/hash-checked pagination and scope-isolated model context are implemented. Older absent-read/binding notes above are historical. Writes/diff/shell/worktree/full locks and remaining modules are still gaps. A concurrent browser Failed-to-fetch observation was not reproduced in isolated/final batches; its cause remains unproven. See workspace-native-reads.md. No OS sandbox or full OpenDots acceptance claim.

2026-10-04 native write update (7118f9dbe34576be787fbea92305b029ef5dbac2): root-only exact-approved single-file creation/replacement and truthful receipts are implemented. Prior absence-of-all-writes notes are historical. Diff/editor/shell/worktree/full leases, filesystem↔SQLite crash reconciliation, Windows ACL/power-loss/external-race proof and remaining V1 modules remain gaps. Snapshot/recheck is not an OS sandbox or atomic CAS. See workspace-native-writes.md; T-017 and Goal remain active.

2026-10-04 difference review (53e9e2cee58c8cd18cee1cc09e275c210e879c48): prior missing-all-diff notes are historical. Owner-readable replacement hunk is implemented; executable patch/editor, large/binary preview, full superseded/new-proposal flow and T-017 leases/shell/worktree/reconciliation remain incomplete. See workspace-diff.md.

2026-10-04 canonical root admission (c63be5a72f91dc78f38c261b4b8b3b8cde4a9bf3): exclusive overlapping Work ownership and cancellable durable waiters now implemented across nested registrations. Prior missing-all-root-lease notes are historical. This is not shared-read optimization, multi-resource ordering or OS filesystem locking; complete blocked release/local-write reconciliation/worktree/shell remain open. See workspace-leases.md.

2026-10-04 Git adapter (d1181200442a8e9fa4d3b2686dc8a8bfecaf5abf): basic real local creation now exists as an unexposed adapter. Product worktree feature remains missing until daemon approval/ledger, supervised cancellation, root registration, background defaults and UI are integrated. Linked-worktree roots/filters/non-Git fallback and complete cleanup/reconciliation remain gaps. See git-worktree-adapter.md; no worktree acceptance or UI claim.

2026-10-04 Git supervision (8b9093e672ff78be218d0d447e6ede0a3d2203fc): Windows owned descendant termination now has actual fixture evidence. Mid-checkout timeout/crash/reconciliation and POSIX execution remain unverified. Daemon approval/ledger/native-tool/registration/UI integration remains missing; this is still an unexposed adapter. See git-worktree-adapter.md.

2026-10-04 native worktree integration (682b5c3fd2c2d6fc3765c4efed4cefa6d19cf7e0): previous unexposed-adapter statements are historical. Explicit root-only tool, daemon exact approval/ledger, successful registration/receipt and UI now exist with Windows native6/browser6 evidence. Background coding auto-selection, linked-source/non-Git/filter support, full cleanup/reconciliation and managed metadata display remain pending. No Ubuntu/full visual alignment/live-service claim. See workspace-worktrees.md.

2026-10-04 artifacts (0a677c28fd8306b28c8ba9a1b1d58a425477d56b): immutable confirmed-write snapshots, ID-only verified downloads and source-text results pane now exist; earlier entirely-missing-artifact notes are historical. Only single UTF-8 confirmed workspace writes supported. Markdown Document revisions, PNG/JPEG, rendered isolated HTML, native publication, file-context refs, pagination, source navigation and full filesystem crash cleanup remain incomplete. See artifacts.md.

2026-10-04 documents (2a1d9208a08a6c6f1a9efc8af1ad7fac4efe7d03): previous missing-all-Markdown-CAS notes are historical. Owner source editing, revision CAS/history/download and browser-tab draft retention now implemented. No native agent document edits or full AT27 human/agent proof; draft crash persistence, rendered preview/images and fullUI comparison remain gaps. See documents.md.

2026-10-04 HTML preview (cf53d927ce311aba5c8c4f83dfff8d0468f3d768): previous absent-rendered-HTML notes are historical. Restricted static preview now exists; interactive scripts/navigation/resources deliberately unsupported. Local canary/capability probes are not full host egress proof. Native tools, PNG/JPEG artifacts, context refs and full visual comparison remain pending. See html-preview.md.

2026-10-04 native artifact delivery (0f31a2a4104566b42b9a56fd689d71c599caa59e): prior missing-all-native-publication statements are historical. Root normal Work can publish its own confirmed single-file write. Other-source/binary/bundle publication, document tools/context refs and remaining V1 scope are incomplete. See artifact-native.md.

2026-10-04 artifact cards (e1e3b62f68e5af31340af3df860cb73645c091b4): results no longer require finding the sidebar library first. Shared collection restores latest200 artifacts and applies publication events. Full pagination, independent degraded library loading and matched visual/theme matrix remain gaps. See artifact-cards.md.

2026-10-04 artifact recovery (9feaf7920138db6a9729071765697a741daac678): previous library-bootstrap dependency is resolved. Fault/retry tested independently of main conversation connection. Latest200 initial list/pagination and broader remaining product/visual scope still open.

2026-10-04 presence (3d49ea33c52966c58b893e6bd128f49805c13ef7): previous fully-pending presence is now a partial confirmed-state implementation. Completion feedback/de-duplication, connection freshness timestamp, background navigation, resource waiting detail and performance/full browser matrix remain open. See presence.md.

2026-10-04 presence feedback (05f77122594122b0be2eb3c9fb2933b4dc00af68): one-time completion deduplication and sync timestamp now implemented with browser offline/online evidence. Earlier absent-feedback/freshness notes are historical. Background navigation, waiting-resource detail, hidden-tab real-browser and performance matrix remain missing.

2026-10-04 background navigation (1f1dac70310d3253147d79aa7bccf1aefee459d0): previous missing-attention-navigation statements are historical. Exact Work focus/reveal exists, tested across four widths. Full archive/search, resource-wait detail and performance/full platform matrix remain open.

2026-10-04 admission wait presentation (84a5b4c27e15ebb3a79e6ad1a959473cfca66fdf): workspace/capacity reasons are now persisted and shown. Earlier absent-resource-wait presentation is superseded for admission; already-running model-slot waits remain separate/unclassified. Performance/full browser matrix still open.

2026-10-04 document history (565e888edcb0fa2c0c71e34a15954bd44638fcad): previous absent-history-UI statements are superseded by revision-number browsing and explicit restore-as-new-version. Full timeline/search, blank creation and native agent/context tools remain missing.

2026-10-04 Memory foundation (e2656034210873026b265051839401ecd5fb2983): previous fully-pending registry is now partial owner-only backend. UI, Knowledge sources, model read/write permission/budgets, derived-skill cleanup and AT36/46 remain open. Logical deletion is not physical backup/WAL/remote erasure. See memory-registry.md.

2026-10-04 Memory UI (d666feff90f5c07f917c01c0773aa62466e99496): previous absent-owner-UI statements are historical. Owner CRUD now exists and has Chinese/light four-width browser evidence. Knowledge/native permissions, full scope/theme/keyboard UI matrix, durable drafts and derived-skill cleanup remain open. See memory-registry.md.

2026-10-04 Memory sources (6256a1653ab36448851b8c62c4eb8423549a10e0): local document revision provenance now implemented; earlier completely-absent-source notes are historical. Broader Knowledge ingestion, native consumption/permissions, budgets and derived-skill cleanup remain missing. Source picker currently offers latest heads within existing200-document list.

2026-10-04 Memory token budget (c2962d6ee69b0fa93142f24bbd4c8a70a79f4a98): former byte-only context limitation is partially superseded by explicit cl100k_base serialized-context budgeting. This does not match every configured model tokenizer/billing or account for runtime prompt wrappers; permission-bound native retrieval integration and fullAT remain open.

2026-10-04 Memory scope verification (5f192c636d6444f740bb8371c7715cca5707506f): prior completely-unverified English/dark and project-scope notes are partially superseded. User/project selector, English/dark long-content widths and basic Enter/Escape actions now tested. Task scope/full Tab order and full visual/reference matrix remain open.

2026-10-04 native Memory search (21aba71c424901edad1d920774bc58f93628e880): previous no-native-read statements are historical. Root grant-bound read now works with owner API; grant issuance UI and full scope/child/cross-Work matrix remain pending. Native writes and removal of already-delivered checkpoint/provider copies are not implemented.

2026-10-04 Memory grants UI (e56869c3a43e6d83512925041d75b70e69d2e402): previous API-only grant limitation is superseded for active Work; collapsed permissions now exposes scopes/private and revocation. Pre-submit grant selection or durable memory-consent wait remain missing, so a fast ungranted tool call may fail before owner opens permissions. Full isolation/withdrawal/native-write scope remains open.

2026-10-04 composer memory consent (95c144678f0c591e6b990ae7b4d5b9c8b122523a): previous lack of pre-submit selection is superseded for user/selected-project memory. Atomic admission grants remove the UI race when explicitly preselected. Ungranted calls still fail rather than enter a durable consent wait; full native write/isolation/deletion requirements remain incomplete.

2026-10-04 Memory isolation (a0b070cdac06fc788a046364aad81438e1346ff8): native project/task/child/cross-Work grant isolation, revoked submission replay and evaluation rollback now have actual integration evidence. Broader expiry/retry/restart matrix, native writes and derived/checkpoint cleanup remain unimplemented or unverified. No fullAT pass.

2026-10-04 native memory envelope (8cc548c9cbb0409945540581ad33299ed231824c): array-only/no per-call truncation limitation is resolved. Native full JSON response fits cl100k_base budget(min128), with explicit truncated flag. Provider-specific whole-prompt accounting, pagination, native writes and cleanup remain open.

2026-10-04 native Memory write (0aa4073ac3960576cbb592be22a2043b8398be59): previous absent-model-write statements are historical. Exact-approved create/update now exists; manual entries protected and owner edits relock model entries. Update diff/source preview, write-specific cancel/restart/isolation coverage and deletion of derived/copied data remain pending.

2026-10-04 Memory diff (0386c45882cfc2a762d5158c4d79bf07b2421724): earlier absent-before/after preview limitation is superseded by guarded content/privacy/source diff. Dedicated update/source browser matrix and historical source titles remain missing; final CAS still guards changes after preview.

2026-10-04 Memory stop/reopen (7542ad1e26976d8f68793da8c3ec0f4f31faa28d): pending-approval explicit stop, graceful close/reopen and completed receipt replay now have dedicated native integration evidence. This supersedes only that portion of the earlier cancellation/restart gap. Abrupt process death/power-loss windows, source and child/evaluation write matrix, and derivative/checkpoint cleanup remain open. No new browser or fullAT evidence.

2026-10-04 Memory proposal preflight (ab6b57fd9b6763d68ab85e829fd8542e74fb54f0): source validation is no longer deferred solely until persistence. Model proposal and preview now check it too, and final persistence rechecks it. Dedicated valid-source model/browser cases and broader permission matrix remain incomplete; this change does not establish independent verification of model claims.

2026-10-04 Skills package foundation: validateSkillPackage is currently an internal data-only validator, not an exposed import product feature. Registry/trust UI/persistence/runtime integration and all T-026 acceptance remain incomplete. ASCII name subset and explicit file/YAML limits are documented in skill-package evidence; untrusted script bytes are preserved but never executed by validation.

2026-10-04 Skills untrusted registry: earlier no-persistence/API limitation is superseded by transactional SQLite snapshots and owner-session import/list/revision endpoints. No filesystem discovery, import UI, trust/publish decision, published directory materialization or native runtime catalog exists yet. Current imports remain untrusted; source metadata is declared, not license verification.

2026-10-04 Skills selection: earlier no-selection limitation is superseded for manual imported package owner API. Published/inactive/quarantined are registry states only until runtime integration; no skill execution is enabled yet. Per-run frozen catalogs, published directory materialization, runtime revoke, Learning publish/evaluation gates and browser review remain incomplete. Quarantine currently applies to skill ID plus content hash.

2026-10-04 frozen Skill catalog: earlier lack of per-Work catalog is superseded at admission/registry level. Native loader and all-tool revocation remain unwired; direct reader tests do not prove an Agent actually loaded a skill. No retrospective catalogs for existing Works. Same-name scope/ID entries still need safe native path mapping and published filesystem view.

2026-10-04 Skill backend adapter: native V2 read-only adapter exists and accepts native Skills middleware construction, but production factory/worker RPC still use existing scratch backend. No actual Agent skills load claim. Search/glob return explicit unavailable; future wire must distinguish metadata discovery from actual body load events and enforce daemon quarantine on each access.

2026-10-04 native Skills wiring: previous unwired-factory/RPC statements are superseded. Configured root now uses native middleware plus daemon-backed virtual published view, with actual fixture body-load evidence. Same-name skills still collide in native name deduplication; child policy does not expose skill paths. Quarantine denies reads but does not yet notify or stop all subsequent tools after prior skill load. Physical published materialization, UI and full revoke remain open.

2026-10-04 native name isolation: same-name metadata overwrite limitation is resolved by ID-qualified native metadata/source paths while preserving original package content. Two same-name user skills have actual native discovery evidence; mixed-scope test coverage remains pending. UUID-qualified names are runtime identities, not proposed product UI labels.

2026-10-04 loaded Skill revoke: earlier read-only revoke limitation is superseded by shared native tool guard and daemon RPC checks. Actual post-load write_todos denial and durable revoke event are verified. Broader child/pending-approval/in-flight coverage and user-facing revoke UI remain incomplete. Prior side effects and delivered model/history/checkpoint copies are not withdrawn; cross-ID quarantine remains open.

2026-10-04 revoked pending approval: new approve decisions now fail before acceptance when a loaded skill is quarantined. Native memory_write case has actual approval/rejection evidence. This does not cover every external effect/in-flight race or add a browser revoke banner; those gaps remain.

2026-10-04 Skills review UI: previous absence of all Skills UI is superseded by sidebar review/lifecycle interface. Import remains API-only; full revision navigation, file previews and broader browser matrix remain incomplete. Existing original-name cards intentionally avoid runtime UUID aliases except actual imported fixture names. No full OpenDots alignment claim.

2026-10-04 Skill folder import: API-only import limitation is superseded for new packages via browser directory picker. Existing-skill update UI, automatic global/project discovery, filesystem symlink inspection and full file/history review remain incomplete. Browser imports retain selected bytes without asserting original filesystem topology.

2026-10-04 Skill package/history review: earlier SKILL.md-only preview and no historical navigation limitations are superseded by text-file selection, binary metadata and previous/next immutable revision controls. Chronological audit/diff UI, binary download and existing-skill folder updates remain incomplete; browser tests do not establish external script safety.

2026-10-04 existing Skill update UI: earlier new-packages-only limitation is superseded. Existing ID/scope updates use revision CAS and leave selected publication unchanged. Stale-update UI retry, project update and complete theme/accessibility matrix still need dedicated evidence.

2026-10-04 Skill diff: adjacent immutable versions are now comparable, including removed files. Text uses bounded replacement hunks, not a minimal edit algorithm. Binary hashes currently require separate revision evidence; arbitrary-base comparison, audit history, full theme/language/focus matrix and matched reference comparison remain pending. See [evidence](evidence/2026-10-04/skill-diff.json).

2026-10-04 update: binary Skill comparison now displays both version hashes/sizes in one collapsed section, resolving the previous separate-evidence navigation gap. Adjacent-version-only UI, audit/discovery/Learning pipeline and broader browser/reference matrix remain unfinished. [Evidence](evidence/2026-10-04/skill-binary-diff.json).

2026-10-04 Skills revoke UI now shows authoritative work/run-scoped notices and collapsed evidence. Browser verifies catalog revocation before body load and reload persistence; native loaded-skill/pending-approval tests remain separate evidence. Full loaded-approval browser flow, older history event availability and theme/language matrix remain pending. [Report](evidence/2026-10-04/skill-revoke-ui.json).

2026-10-04 Skill source discovery/snapshot backend is implemented with bounded scans and hash revalidation. UI remains pending; only isolated project/temp roots tested, no actual user global source scanned. Fifty-item truncation is explicit without pagination. Path/identity checks reject tested junction/hard-link cases but do not claim complete external-process TOCTOU isolation. [Evidence](evidence/2026-10-04/skill-sources.json).

2026-10-04 discovery UI now connects real project/global source APIs to explicit untrusted imports. Browser covers temp project and changed-source rejection; global user directory was not scanned. Rediscovery may produce duplicate registry IDs if reimported; mapping to existing source revisions, pagination and full theme/language/accessibility matrix remain pending. [Evidence](evidence/2026-10-04/skill-discovery-ui.json).

2026-10-04 Learning policy API is persistent and defaults off, but propose currently records scoped consent only. No automatic work scan, episode admission, reflection, budgeted queue or UI is implemented by this slice. Privacy/learning/eval exclusions must be enforced before episode creation; current API does not claim these pipelines are ready. [Evidence](evidence/2026-10-04/learning-policy.json).

2026-10-04 Learning work consent and source preflight are implemented but await episode pipeline/UI integration. Defaults deny; historical private-memory grants conservatively exclude even when revoked/unused. Completed-only sources temporarily exclude failed/cancelled runs with verified conclusions until that evidence path exists. Work-private flag here applies to Learning source eligibility, not a completed product incognito feature. [Evidence](evidence/2026-10-04/learning-source.json).

2026-10-04 manual Learning episode creation now enforces source preflight and durable source provenance/dedupe. Owner summaries remain explicitly unverified; event presence is not a success verdict. Current redaction is the existing secret/pattern scrubber, not comprehensive PII detection. Withdrawal blocks future reads but stored summaries/derivative deletion remains incomplete. API-only pending_review episodes do not dispatch reflection; UI, automatic triggers and queue remain absent. [Evidence](evidence/2026-10-04/learning-episode.json).

2026-10-04 episode withdrawal now removes current-row summary/evidence transactionally and prevents resurrection. This supersedes the earlier read-block-only limitation for new exclusion commands. WAL/free-page/backup secure erasure, historical exclusion backfill and future candidate/checkpoint derivative cleanup remain outstanding. [Evidence](evidence/2026-10-04/learning-withdrawal.json).

2026-10-04 Learning policy UI now reads/writes real scoped consent. Reflection/evaluation remain disconnected and visibly labeled; work consent and episode UI still missing. Browser verifies user scope in Chinese/light, stale revisions and off; project/theme/language/accessibility matrix remains pending. [Evidence](evidence/2026-10-04/learning-policy-ui.json).

2026-10-04 Work Learning consent UI is connected and browser-verified for default exclusion, source review allowance, privacy exclusion and reload. Actual episode content removal remains backend-test evidence rather than this browser scenario. Episode creation/review UI, reflection, queue and comprehensive browser matrix remain pending. [Evidence](evidence/2026-10-04/work-learning-ui.json).

2026-10-04 manual episode form connects current shared projection events and daemon create/withdraw boundary. Saved response shown only in current form; persistent episode list and review after reload remain missing. Older history evidence may not be loaded. Reflection/queue not connected; full form browser matrix and dedicated stale-policy reload remain pending. [Evidence](evidence/2026-10-04/learning-episode-ui.json).

2026-10-04 persistent Learning summary list/view is now implemented; review decisions and reflection queue are not. Explicit refresh returns only currently authorized episode rows, but does not invalidate already-rendered data in another client. Pagination may return empty filtered pages with next cursor. [Evidence](evidence/2026-10-04/learning-library.json).

2026-10-04 exact episode review decisions/UI are implemented. Approved summaries are not dispatched yet; review does not publish skills. Rejected summaries remain stored until source withdrawal; edit/resubmit pending. Historical receipt replay is metadata-only and does not restore withdrawn content. [Evidence](evidence/2026-10-04/learning-review.json).

2026-10-04 reflection factory capability profile exists and actual native graph tests pass, but no production worker/daemon reflection port is wired. Candidate schemas are typed drafts/partial changes, not persisted/evaluated/published skills. Optional restricted delegation/scratch absent; denied by default. No reflection execution UI claim. [Evidence](evidence/2026-10-04/reflection-profile.json).

2026-10-04 reflection authority and draft persistence are implemented independently of production worker routing. Source catalog bounds skills; no additional allowed-skill picker. Candidate materialization/evaluation, budgeted queue and worker/run binding remain absent. Expanded episode hash now covers scope/trigger/summary-authority; old approved hashes fail closed until explicit fresh review support, never auto-migrated approval. [Evidence](evidence/2026-10-04/reflection-authority.json).

2026-10-04 stale-hash episode renewal gap is resolved: current approved view projects needs_review and requires explicit fresh decision. This supersedes the older no-renewal limitation. Backend tests cover actual redaction change/reapproval; browser renewed-review state is an explicit response fixture. Cross-client immediate invalidation and full UI matrix remain pending. [Evidence](evidence/2026-10-04/learning-rereview.json).

- Reflection worker IPC is verified with a deterministic daemon-port fixture. Production WorkService does not yet admit or dispatch reflection Work; no live reflection, budget or queue completion claim. See evidence/2026-10-04/reflection-worker.json.

- Reflection Work identity now persists and is immutable through Work CAS. This supersedes the earlier fixture normal-runMode limitation, but production admission and authority routing are still unconnected; see evidence/2026-10-04/reflection-work-identity.json.

- Reflection authority routing is now wired in WorkService and registry identity checks are fixture-tested. No production admission command sets that path yet; integrated lifecycle verification remains pending. See evidence/2026-10-04/reflection-dispatch.json.

- Manual reflection WorkService admission now runs end-to-end with deterministic local provider, using existing evaluation-class low-priority slots and wall budget. Dedicated Learning budget UI, mixed-queue fairness, HTTP/browser launch and stop/restart/withdrawal matrix remain unverified; automatic triggering and candidate pipeline are unfinished. See evidence/2026-10-04/reflection-admission.json.

- Reflection HTTP owner admission, active stop and source withdrawal before/after output now have local integration coverage. Restart/crash, queued withdrawal, UI lifecycle, mixed-priority fairness and checkpoint cleanup remain open. See evidence/2026-10-04/reflection-lifecycle.json.

- Reflection results now have an authorized paginated HTTP read endpoint. Result UI and browser evidence remain pending; returned proposals are unevaluated drafts and do not authorize publication. See evidence/2026-10-04/reflection-results.json.

- Learning manual reflection UI is connected and no_learning browser flow verified. Candidate structured presentation, repeat reflection/history selection, stop/reopen browser matrix and matched reference comparison remain pending. See evidence/2026-10-04/reflection-ui.json.

- Candidate create/patch presentation now has readable fields and collapsed source/raw data, verified with explicit UI fixtures. This is not materialized/evaluated/published skill proof or completed OpenDots comparison. See evidence/2026-10-04/learning-draft-ui.json.

- Inline tool cards now match measured OpenDots card geometry and show truthful returned/failed/unconfirmed states. This closes hidden-only summary presentation, not full Computer/tool results or global UI fidelity. Reference comparisons are explicitly local card-region CSS reconstruction. See evidence/2026-10-04/tool-alignment/verification.json.

- Tool-card reference now mounts actual unmodified OpenDots ComputerToolCard in isolated fixture; collapsed density corrected70px. Full shell comparison remains incomplete, and fixture uses local Rocky dependency versions. See evidence/2026-10-04/tool-component/verification.json.

- New native child evidence includes parent task call identity and prevents repeated child call IDs merging in inline cards. Existing events lacking ancestry cannot reconstruct it; daemon restart/resume propagation still needs coverage. See evidence/2026-10-04/native-task-identity.json.

- Computer pane now exposes real registered local file reads and shared activity; Browser/Terminal and isolated environments/profile takeover remain unavailable. T-022/023 are not completed by this UI slice. See evidence/2026-10-04/computer-panel/verification.json.

### Native environment adapter (2026-10-04)

Internal bounded Node child-process adapter exists and local Windows process-tree cancellation is tested. It is deliberately not exposed as a Work tool or Terminal action: exact intent approval, ledger/context/revision revalidation, workspace locks, public output redaction and durable reconciliation must be connected first. Native OS authority is not sandboxed; processes may read owner files or access the network. Root-first exit, detached descendant and daemon crash containment are not verified. No isolated engine/browser ownership support is claimed. See [evidence](evidence/2026-10-04/native-environment.json).
