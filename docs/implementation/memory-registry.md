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
