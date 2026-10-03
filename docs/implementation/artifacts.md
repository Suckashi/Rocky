# Immutable artifact snapshot and result pane

Source 0a677c28fd8306b28c8ba9a1b1d58a425477d56b. Windows x64 / Node24.12.0 / fixture mode. T-020 in_progress; T-017/T-019 dependency acceptance remains open.

## Actual behavior

An owner uses Save result snapshot on a succeeded workspace_write operation. The daemon verifies ownership and original receipt, re-reads the registered source against its SHA256, writes a private staging file, syncs and verifies a content-addressed blob, then atomically publishes the manifest and rocky.artifact.published event in SQLite schema17. Artifacts contain Work/run, file MIME/size/hash, entry, source workspace revision/relative path and confirmed operation evidence. The evidence is a write receipt, never an invented test pass. Replaying the same request returns the same artifact; different intent conflicts. SQL failure leaves no visible artifact; orphan blob cleanup is deferred.

GET /artifacts and /artifacts/:id expose manifests. GET /artifacts/:id/files/:fileId serves only verified blob bytes by IDs, with attachment/octet-stream, nosniff and restrictive CSP; it never accepts host paths. Preview is escaped source text and follows existing JSON evidence redaction; raw downloads preserve original bytes. Workspaces can change without changing old artifact bytes. Corruption fails closed.

## Interface and reference

The existing operation details contain the owner save command. Documents & results now opens an actual artifact library/card, source-text preview, download and collapsed provenance. One shared snapshot artifact event invalidates the mounted list; no new poller or event source. Desktop result pane uses OpenDots fixed commit c2569bb6a13a22e565cf3eb791c62267d06babb1 ResultPane structure and effective style.css rules: top64, width clamp(390px,40vw,660px), 56px pane header, overlay at1100 and full width below700. Closing reserves no pane width. Rocky adds explicit immutable-source/permission details and focus handling; no multi-Dot picker or Computer simulation. MIT source attribution retained in THIRD_PARTY_NOTICES.

## Verification

[Exact commands/results](evidence/2026-10-04/artifacts/verification.json). Related22 pass. Full suite returned264pass/1fail from old schema16 assertion; updating that assertion yielded focused4pass, and the full suite was not repeated. Normal-daemon browser6 pass; final enriched artifact/browser download/focus/dark-English flow1 pass. Type/lint/build/format/diff pass. Fixture model scripts tool intent; actual native runtime/daemon/write/publication/filesystem/download are exercised. No synthetic success enters normal product code.

Light screenshots: [1440](evidence/2026-10-04/artifacts/artifact-preview-1440.png), [1280](evidence/2026-10-04/artifacts/artifact-preview-1280.png), [390](evidence/2026-10-04/artifacts/artifact-preview-390.png), [320](evidence/2026-10-04/artifacts/artifact-preview-320.png). [Mobile library](evidence/2026-10-04/artifacts/artifact-library-320.png), [English/dark1440](evidence/2026-10-04/artifacts/artifact-preview-1440-dark-en.png). Pane widths and top offset are asserted against CSS values. These are after/effect evidence, not a new matched full-page reference comparison.

## Gaps

- T-020 partial: single UTF-8 file from confirmed workspace_write receipt only; no native publish tool, arbitrary bundle/image publication or automatic artifact success
- Markdown Document revisions/CAS/editor and file-context references are not implemented
- HTML is escaped source text, not rendered interactive/isolated HTML preview; PNG/JPEG previews remain pending
- Atomic SQL registry/event publication follows verified blob creation; orphan staging/blob cleanup, power-loss fsync guarantees and hostile external race matrix remain unverified
- List currently capped at200; pagination/search and richer source navigation pending
- Existing global evidence redaction applies to JSON source preview; raw download verifies original immutable bytes
- No fresh matched upstream reference/before/after screenshots for populated artifact state; source-based pane geometry is measured, not full fidelity proof
- Ubuntu/live provider/HTML egress/full AT26/27 not_run; existing host AdGuard browser-egress blocker unchanged

All70 global AT remain not_run. No remote changes or Apsis modification. Goal active.
