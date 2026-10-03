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
