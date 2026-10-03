# Markdown document revisions and draft preservation

Source 2a1d9208a08a6c6f1a9efc8af1ad7fac4efe7d03. Windows x64 / Node24.12.0 / fixture. T-020 remains in_progress.

## Implemented

Owner can create an editable copy of a Markdown/plain-text artifact. SQLite schema18 stores document heads, immutable versions, hash-addressed text blobs and idempotency receipts. Source artifact/work/run and workspace scope are retained. Saves require expectedRevision; head update, new version, receipt and rocky.document.updated event commit atomically. Concurrent same-revision commands yield one success and one409. Repeat requests return the original saved revision, not a newer head. Old artifact content remains unchanged.

GET /documents and /documents/:id expose owner-readable metadata/content; revision query reads an immutable historical version. POST /documents creates from artifact and POST /documents/:id saves exact revision. GET /documents/:id/download accepts optionalrevision and returns attachment bytes without a host path. Document text has a64KiB decoded-byte cap; only document command routes allow512KiB request bodies to accommodate bounded JSON escaping. Other API limits remain64KiB. Invalid Unicode/NUL/oversize fail. Protected content/title detected by existing evidence redaction is rejected before editing instead of returning masked text that could overwrite the original.

## UI and reference adaptation

The existing results pane now lists editable documents alongside immutable artifacts. Source editor preserves unknown Markdown syntax as text, shows currentrevision/dirty state and has explicit Save and Compare actions. A409 leaves title/content untouched. Owner may inspect latest server content and explicitly keep the draft against that revision; another server change still conflicts. Per-document drafts survive panel close in this browser tab, with unsaved-reload warning; they are not durable crash recovery. Editor discloses LF normalization. Download always targets the shown savedrevision, not unsaved draft. Entry/back/close focus is handled. Shared document events refresh metadata; no additional poller/runtime.

Fixed upstream PageDocument.tsx and editor.css source-mode/title rules compared at c2569bb6a13a22e565cf3eb791c62267d06babb1. Source area uses420px minimum,18px padding,13px/1.8 monospace; title40px desktop/32px mobile. Rocky uses its existing neutral semantic tokens, visiblefocus and explicitCAS instead of importing upstream autosave/thread/rich-editor services. Source notice updated. Full upstream page-reading/rich-editor visual comparison is not yet evidence.

## Verification

[Commands and limitations](evidence/2026-10-04/documents/verification.json). Related17 tests pass; finalUTF8 fixture1 pass. Six normal-daemon browser flows pass, final styled source-editor flow1 pass. Type/lint/build/format/diff pass. Native scripted-provider fixture writes a real file and artifact; document APIs/SQLite/CAS/downloads are real local effects. No paid/live provider claim.

Screenshots: [1440](evidence/2026-10-04/documents/document-conflict-1440.png), [1280](evidence/2026-10-04/documents/document-conflict-1280.png), [390](evidence/2026-10-04/documents/document-conflict-390.png), [320](evidence/2026-10-04/documents/document-conflict-320.png). Conflict comparison is below the editor and independently scrollable; screenshots show the retained draft at its top. Browser verifies comparison and actions, not just screenshots.

## Remaining scope

- Owner document creation from Markdown/plain-text artifact and owner revision edits only; native agent document mutation/context-reference tools remain unimplemented
- AT-27 full human/agent concurrency is not claimed: two concurrent owner HTTP writers plus browser/HTTP competing edits verified
- Draft cache is browser-tab memory, survives panel close but not process crash/reload; beforeunload warning installed, actual browser-close prompt matrix not_run
- Editor is lossless source text for unsupported Markdown syntax; textarea editing uses LF and UI discloses this; original artifact/revisions retain original bytes
- Recognized protected content/title is rejected instead of silently loading redacted text into an editable document; not a universal secret classifier
- List capped at200; revision history API/download exists but full revision-history browsing, blank-document creation and navigation remain pending
- Four-width Chinese light editor/conflict checks only; document-specific English/dark/reload failure matrix and fresh reference/before/after comparison not_run
- PNG/JPEG and rendered isolated HTML preview, native artifact publication, generic bundle support and remaining T-020/V1 scope unfinished
- Ubuntu/live model and release acceptance not_run; no remote actions

All70 global AT unchanged. Goal active; no Apsis modification or remote action.

## History and explicit restore (565e888edcb0fa2c0c71e34a15954bd44638fcad)

Editor now exposes initially collapsed revision selection, immutable content/title/time preview and historical download. Loading a version is disabled while current draft is dirty. On clean draft, owner can load historical content/title and then Save through existing expectedRevision CAS; restores append a new revision and do not erase earlier versions or source artifact. Source focus returns after loading. No new backend endpoint or persistence format.

Real native write→artifact→document browser flow verifies version1 view, unsaved-draft guard, restore as revision4, unchanged revision3 and original artifact. Four-width checks and final browser1 pass12.4s; document integration1, type/lint/build/format/diff pass. Visual review found the historical number field inherited title typography; title styling is now scoped to document-title and numeric field uses standard14px form type. [Verification](evidence/2026-10-04/document-history/verification.json).

Screenshots: [1440](evidence/2026-10-04/document-history/document-history-1440.png), [1280](evidence/2026-10-04/document-history/document-history-1280.png), [390](evidence/2026-10-04/document-history/document-history-390.png), [320](evidence/2026-10-04/document-history/document-history-320.png). Final320 inspected.

- History navigation selects revision number up to current loaded base; metadata timeline/search and blank-document creation remain pending
- Restore loads historical title/content into a clean draft then uses existing CAS Save to append a revision; it never rewinds the head or deletes history
- Dirty draft blocks restore loading; no automatic merge or discard
- Four-width Chinese light browser fixture verified; new history English/dark and fresh matched OpenDots comparison not_run
- Native document mutation/context references, PNG/JPEG attachments and remaining V1 scope incomplete; all70 global AT unchanged
