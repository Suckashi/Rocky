# Owner-managed memory registry foundation

Source e2656034210873026b265051839401ecd5fb2983. T-025 in_progress. Node24 SQLite schema19 adds memories, FTS5 and metadata command receipts. No external service, vector DB, Python or dependency added.

Memory scope is user/project/task; project and task IDs must exist. Scope cannot be changed in place. Owner commands validate exact expectedRevision and stable request intent; save updates row/index/receipt atomically. Manual source is owner, locked/userEdited true, private true and unverified by default. Owner may edit its own manual record; no agent tool is exposed. Protected/oversized/invalid Unicode/NUL content is rejected.

Owner-session POST /api/v1/memories saves, /memories/search searches, /memories/:id/delete deletes. Scope filter precedes matching; quoted FTS plus substring handles English and Chinese. Response bounds20 entries and a caller-limited UTF8 content-byte budget, with explicit truncation. Entries retain IDs/revisions/provenance.

Delete removes row and FTS index in one transaction; command receipt retains only metadata and intent hash. Deleted identity cannot be reused; repeat delete returns historical receipt. No payload copies in command receipts, new event logs or caches. No claim of forensic physical erasure or remote-provider recall.

[Evidence](evidence/2026-10-04/memory-registry.json):16 tests pass, covering scope/CAS/search/update/delete/rollback/restart and owner HTTP session. Type/lint/build/format/diff pass. Initial migration fixture failure was fixed with idempotent table creation; final run passed. Existing Vite chunk warning remains.

## Remaining

- T-025 partial backend only: owner management UI and browser acceptance not_run
- Knowledge/document provenance references and model permission/approval/read budgets are not integrated; no native memory tool exposed
- Manual source is owner, locked/userEdited always true; unverified default is not a factual truth claim
- Search uses FTS5 plus substring with exact scope, up to20 results and bounded UTF8 bytes; this is not tokenizer-aware model context budgeting or full pagination
- Deletion removes live row and searchable FTS row; receipt contains only hashed intent and id/revision/deleted flag. No claim of physical WAL/backup erasure or remote-provider withdrawal
- Downstream Learning/Skill derivation references are not implemented; affected-skill cleanup and full AT46 remain open
- Windows Node24 bundled SQLite only; Ubuntu/live/full AT36/46 not_run

Goal active; all70 global AT unchanged. No remote actions or Apsis changes.

## Owner Memory interface (d666feff90f5c07f917c01c0773aa62466e99496)

Collapsed Memory settings now provide user/project/task scope selectors, bounded search, explicit create/edit with status/private controls and exact-revision delete confirmation. One owner request path; no card polling. Save/delete retry reuse request identity for unchanged intent. Daemon conflicts preserve the editor draft. Manual entries remain owner-locked. Existing neutral cards/forms and semantic tokens are reused; no new upstream code copied.

[Evidence](evidence/2026-10-04/memory-ui.json): type/lint/build/format pass, one backend integration test and one actual browser CRUD/CAS/reload/delete test pass. Four widths1440×900,1280×800,390×844,320×844 have no document overflow.320 screenshot visually inspected. Vite existing large-chunk warning remains.

[Screenshot 1440](evidence/2026-10-04/memory-ui/after-1440.png) · [Screenshot 1280](evidence/2026-10-04/memory-ui/after-1280.png) · [Screenshot 390](evidence/2026-10-04/memory-ui/after-390.png) · [Screenshot 320](evidence/2026-10-04/memory-ui/after-320.png)

- T-025 in_progress; Knowledge provenance and native model retrieval/permissions remain missing
- Browser checks Chinese/light owner CRUD, stale CAS draft preservation, reload and four-width overflow only; project/task UI scope switching, English/dark and full keyboard matrix not_run
- Screenshots are Rocky after only; no new matched OpenDots reference comparison
- Drafts survive command failures but are not persisted across closing settings or reload
- Search is capped at20 entries/16384 UTF8 bytes with truncation; no pagination or token-aware context budget
- Learning/derived-skill cleanup and physical backup/WAL erasure are not implemented; all70 global AT unchanged

## Pinned document provenance (6256a1653ab36448851b8c62c4eb8423549a10e0)

Owner memories may now reference up to16 exact local document ID/revision pairs. The daemon verifies actual immutable document content through DocumentStore, rejects duplicate/missing revisions and cross-project/task-workspace references. User scope allows explicit owner selection across registered documents. References never change automatically when a document head advances. No auto-confirmation, network request or model authority is introduced. Empty provenance retains existing command intent hashes.

The editor selects a current document head, displays pinned revision and allows removal; editing retains references. Cards collapse source links and download exact revisions through the existing safe document route. Existing Memory settings forms/tokens are reused; no new upstream code.

[Evidence](evidence/2026-10-04/memory-sources.json):2 backend integration tests/2 browser tests, check/lint/build pass. Build ran before final empty-source hash normalization; final type/integration/lint checks cover normalization. Existing Vite chunk warning remains. Screenshots: [1440](evidence/2026-10-04/memory-sources/after-1440.png), [1280](evidence/2026-10-04/memory-sources/after-1280.png), [390](evidence/2026-10-04/memory-sources/after-390.png), [320](evidence/2026-10-04/memory-sources/after-320.png).

- T-025 remains in_progress; native model retrieval/write permission, token-aware budgets and broader Knowledge source ingestion are not implemented
- Only local Rocky document revisions are supported; no remote fetching or arbitrary source URL input
- Owner source picker lists up to200 current document heads; older revisions remain pinned but direct older-revision selection and source document preview integration are pending
- Four-width Chinese/light browser after screenshots only; no new matched OpenDots reference, English/dark or full keyboard matrix
- Document references are evidence links, not factual verification; unverified status remains default
- Memory deletion removes its embedded references, not source documents; derived-skill invalidation and physical backup/WAL erasure remain open; all70 global AT unchanged

## Explicit context token budget (c2962d6ee69b0fa93142f24bbd4c8a70a79f4a98)

Search now accepts tokenBudget2..16384 (default8192) alongside existing byteBudget. It returns context (serialized full selected entries), contextTokens, tokenBudget and encoding=cl100k_base. IDs, revisions, locks, privacy, timestamps and document sources count toward this context. Whole entries are omitted with truncated=true when they do not fit; content is not silently cut. Empty context remains valid.

Pure JS js-tiktoken1.0.21 is now a direct pinned dependency, with bundled cl100k_base ranks loaded locally and no CDN/Python/native compiler fallback. User special-token spellings are treated as ordinary text. This is an explicit deterministic retrieval encoding, not a claim to match every configured model or provider billing. Future native runtime integration must reserve its surrounding prompt/tool framing separately. License source: https://raw.githubusercontent.com/dqbd/tiktoken/main/LICENSE.

[Evidence](evidence/2026-10-04/memory-token-budget.json): related2 tests pass, final expandedMemory1 pass, browser1 pass; check/lint/build/licenses/format pass. Exact threshold, metadata overhead, multilingual/emoji/special strings and HTTP output counts checked. No layout changes or fresh visual alignment claim.

- cl100k_base local context measurement is not arbitrary provider/model billing usage or full prompt accounting
- Native model memory permission and consumption integration remain unimplemented; T-025 in_progress
- Search still caps20 entries/21 candidates and UTF8 content bytes; no pagination
- No UI layout changed; browser regression only, no new reference comparison or complete language/theme matrix
- Ubuntu and fullAT36/46 remain not_run; all70 global AT unchanged

## Scope and dark settings browser coverage (5f192c636d6444f740bb8371c7715cca5707506f)

[Evidence](evidence/2026-10-04/memory-scope.json):2 production-path browser tests passed6.5s; type/lint/diff pass. Registered actual temporary workspace and owner entries through API, then verified user/project switching removes stale rows and isolates matching content. Editing prevents scope change; status/private changes persist. Explicit503 interception preserves prior result with error and keyboard retry recovers. Enter toggles details, Escape closes settings. No product code changes were necessary for these assertions.

English/dark long-content screenshots: [1440](evidence/2026-10-04/memory-scope/dark-en-1440.png), [1280](evidence/2026-10-04/memory-scope/dark-en-1280.png), [390](evidence/2026-10-04/memory-scope/dark-en-390.png), [320](evidence/2026-10-04/memory-scope/dark-en-320.png).320 visually inspected; no page overflow in all four. Dialog owns vertical scroll; screenshot is scrolled to the card.

- Task-scope browser selector, complete Tab order/focus and full language/theme cross-product not_run
- Four-width English/dark screenshots are Rocky after only, not new matched OpenDots comparison
- Memory native model retrieval/writes/permissions and broader Knowledge ingestion remain missing; T-025 in_progress
- Search503 is an explicit browser interception fixture, not evidence of external-service outage recovery
- All70 globalAT remain unchanged

## Grant-bound native search (21aba71c424901edad1d920774bc58f93628e880)

Configured normal root agent now exposes memory_search. Daemon derives user/project/task IDs from active Work, checks exact run/session grant and model revision, applies current protected-data redaction before encoding, and returns only the bounded serialized array. No caller-supplied arbitrary scope ID. Child tool whitelist does not expose memory_search. No native writes or automatic memory injection.

Owner-session POST /api/v1/works/:id/memory-read-grants accepts requestId, scope(user/project/task), includePrivate(defaultfalse), expiresAt(defaultnull). GrantRegistry binds owner-selected scope/privacy hash to Work/run/execution session/policy and existing revocation/expiration. Private exclusion occurs in SQL before search limits. Grant metadata marks resource=memory so existing permissions UI does not mislabel it as workspace access. Issuance UI still pending.

[Evidence](evidence/2026-10-04/memory-native.json):9 tests across3 files plus3 browser regression tests pass. Five native cases: public grant, no grant, revoked grant, explicit private grant, private escalation denial. Tool-failed events substantiate denied execution. Type/lint/build/format pass.

- Owner memory grant creation is API-only; scope/privacy grant UI and full identity labels remain missing
- Native project/task reads, child denial, cross-Work replay and private/redaction cases beyond current five-mode matrix need additional dedicated integration coverage
- Read tool returns exact bounded JSON array context; omitted entries are documented in tool description but no per-call truncation flag is included
- No model remember/update implemented; manual locks remain unchanged
- Delivered model/checkpoint copies are not removed by registry deletion; derivative/reference cleanup and withdrawal semantics remain incomplete
- No live external model, Ubuntu or fullAT36/46 evidence; all70 global AT unchanged

## Owner Work grant UI (e56869c3a43e6d83512925041d75b70e69d2e402)

Existing collapsed Work permissions now offers scope selection(task default, bound project when present, user) and separate private checkbox(defaultoff), with model disclosure. Button calls the owner-session daemon endpoint. Confirmed grants show scope/privacy metadata and retain existing revoke CAS. Same intent keeps request ID on error; successful grants disable duplicate issuance while active. Terminal Work cannot issue from UI. Metadata is display-only and excluded from historical grant intent hashing; targetHash remains authority.

[Evidence](evidence/2026-10-04/memory-grant-ui.json):8 native/grant tests,3 browser tests and final focused1 pass. Browser grants private user memory while configured provider is held, releases it and checks actual native model output, then revokes and checks persisted state. Initial fixture incorrectly matched earlier conversation tools; corrected to exact unique toolCall ID. Type/lint/build pass, known chunk warning remains. Screenshots: [1440](evidence/2026-10-04/memory-grant-ui/after-1440.png), [1280](evidence/2026-10-04/memory-grant-ui/after-1280.png), [390](evidence/2026-10-04/memory-grant-ui/after-390.png), [320](evidence/2026-10-04/memory-grant-ui/after-320.png).

- Grant UI applies to already-created active normal configured Work; composer pre-grants and durable wait-for-memory-permission flow remain pending
- Legacy grants without display metadata retain generic memory label; authorization hash and run/session checks unchanged
- Native project/task/child/cross-Work full matrix remains open; owner native writes not implemented
- Chinese light four-width after screenshots only; English/dark grant-specific matrix and matched OpenDots reference not_run
- Model/checkpoint copies already delivered are not removed by registry deletion; all70 global AT unchanged

## Pre-submit memory consent (95c144678f0c591e6b990ae7b4d5b9c8b122523a)

Submission accepts optional memoryRead selections with explicit includePrivate; configured-only, unique scopes, project requires exact registered workspace binding. CopilotKit forwarded props uses the same schema. WorkService creates grants inside the Work admission transaction before dispatch. Submission replay returns existing Work without adding grants; retry-as-new-Work does not copy old grants.

Composer Model/tools popover defaults to no memory access, offers user/selected-project scope and explicit private-to-model checkbox. Options clear after submission and selected model/workspace changes. Existing active-Work grant controls remain available. No second runtime, implicit data injection or permanent extra panel.

[Evidence](evidence/2026-10-04/memory-composer.json):6 native cases plus2 initial contract tests passed; final expanded3 contract tests passed. Browser sends real CopilotKit request to normal daemon/native runtime without held provider, observes private memory in actual tool output and reset selection. Type/lint/build/format pass. Screenshots: [1440](evidence/2026-10-04/memory-composer/after-1440.png), [1280](evidence/2026-10-04/memory-composer/after-1280.png), [390](evidence/2026-10-04/memory-composer/after-390.png), [320](evidence/2026-10-04/memory-composer/after-320.png).

- Composer currently selects one scope(user or selected project); API supports up to3 unique scopes including current task
- No durable wait/resume for an ungranted memory call; it is still denied
- Model remember/update and full project/task/child/cross-Work validation matrix remain open
- Four-width Chinese/light after screenshots only; full reference comparison and grant-specific English/dark matrix not_run
- Deletion cannot recall provider/checkpoint copies already delivered; all70 global AT unchanged

## Native isolation expansion (a0b070cdac06fc788a046364aad81438e1346ff8)

[Evidence](evidence/2026-10-04/memory-isolation.json):11 native integration cases pass10.85s; type/lint/diff pass. Project/task scope tests seed distracting user/project/other-task records and verify only scoped source content reaches the model. A second background Work actually attempts memory_search without inherited grants and emits tool.failed. Native child attempts memory_search despite root grant and receives no memory content. Revoked submission replay stays revoked. Evaluation-mode memory grant admission rolls back all Work/grant state. No production code changes required.

- Fixture configured model over actual normal daemon/Deep Agents path; not a live external provider test
- No new UI/build evidence needed for test-only change; browser matrix unchanged
- Model remember/update, durable ungranted-consent wait, derived-skill invalidation and delivered-checkpoint cleanup remain incomplete
- Expiry races, daemon restart/retry matrix and fullAT36/46 remain open; all70 global AT unchanged

## Bounded native result envelope (8cc548c9cbb0409945540581ad33299ed231824c)

Native memory_search now delivers {items,truncated,encoding,tokenBudget,untrustedData}. It counts the complete serialized JSON, including metadata, against cl100k_base budget and removes whole records until it fits. Native minimum128 reserves metadata space; owner registry search remains2 minimum. Tool description explicitly distinguishes truncated results from absence and suggests narrower query/higher budget. No new authority or exposure added.

[Evidence](evidence/2026-10-04/memory-tool-envelope.json):14 integration tests and4 browser tests pass; type/lint/build/format pass. Actual native delivered strings are independently encoded, budget128 produces empty/truncated=true and no-match produces empty/truncated=false. Earlier array-only/missing-flag notes are historical.

- cl100k_base counts full serialized tool reply, not arbitrary provider tokenizer or complete prompt framing/billing
- Native result can omit whole entries and caps20; no cursor pagination
- No UI layout change/new matched OpenDots comparison in this slice
- Native memory write, ungranted-consent wait, derivative/checkpoint deletion remain incomplete
- Fixture provider only; Ubuntu/live/fullAT not_run; all70 globalAT unchanged
