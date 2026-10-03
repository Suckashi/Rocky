# Registered workspace owner preview

2026-10-04, Windows x64, Node24.12.0/npm11.6.4. Source commit `67013c59a1ccac505a4660949c9956112dd7b683`. T-017 remains in_progress; no global acceptance was promoted.

The daemon now persists explicitly registered local roots in SQLite schema16. Registration uses request receipts, CAS revisions and canonical-root deduplication. Parallel identical requests commit once; unfinished Work reservations prevent changing a registered root. Restart preserves registration. The owner UI uses the existing OpenDots-derived dialog, neutral form/card tokens and compact icon rows. File names truncate in the list and remain readable through their accessible names, title and preview heading. Text preview has its own bounded scroll area and keyboard focus.

`GET/POST /api/v1/workspaces`, `GET /api/v1/workspaces/:id/files?revision=...&path=...` and `GET /api/v1/workspaces/:id/file?revision=...&path=...&sha256=...` use existing loopback/origin and owner-command session guards. Reads require the registered revision and recheck root identity. The optional hash rejects a changed file. File content is previewed as text, never executed; existing public-evidence redaction applies, while SHA-256 identifies original bytes.

Actual filesystem tests reject traversal, Windows junctions, hardlinks, changed roots, stale revisions, binary/NUL data, private daemon storage, `.env`, sensitive directories and oversized previews. Registration rejects relative roots, entire volumes, the whole home directory, system directories and UNC/device-prefix paths. Files are bounded to1MiB for preview; the shared target fingerprint may hash up to8MiB before rejecting the preview. Listings scan at most2000 entries and return at most200 with an explicit truncated flag. This intentionally excludes private data rather than importing any other product's store.

Native permission checks are application snapshot/rechecks, **not an OS sandbox or atomic filesystem transaction**. A concurrently hostile process can race path resolution; Linux openat-style resolution and equivalent Windows handle-based protection have not been proven. No complete sandbox acceptance is claimed. GET uses the application's existing loopback/origin policy; registration requires its session token.

## Actual verification

- `npm run check`, `npm run lint`, `npm run build`: exit0. Existing experimental SQLite and large Vite chunk warnings remain.
- `npm test`: exit0,50 files/223 tests; this run had the first3 workspace tests. After adding the reservation/truncation case, `npx vitest run tests/workspaces.test.ts tests/file-target.test.ts tests/operation-ledger.test.ts`: exit0,13 tests including4 workspace cases.
- `npx playwright test --config playwright.production.config.ts`: exit0,3 actual browser flows against the normal daemon: existing MCP tool/data approval plus actual local owner workspace registration/read. After adding English and keyboard preview checks, focused workspace browser rerun: exit0,1 test.
- Earlier explicit-fixture daemon workspace browser run: exit0,1 test. Workspace contents in both modes are actual isolated temporary files, not synthetic API responses. No paid service or live business-system claim.
- `npm run check:secrets`, `npm run check:docs`, scoped Prettier and `git diff --check`: exit0.

Chromium148.0.7778.96, DPR1,100% zoom. Browser checks cover1440×900,1280×800,390×844,320×844; no full-page/dialog horizontal overflow, actual binary error, hidden `.env`, long filename/text/code, Escape focus return, persistence when reopening, preview keyboard focus and reduced-motion smoke. Dark320px and English dark320px are checked; this is not a complete focus audit or all theme/language cross-product. Desktop and320px screenshots were visually inspected, including the first defective inline form; form layout and oversized file button were corrected before the final captures.

[Desktop form](evidence/2026-10-04/workspaces/workspace-1440-form.png), [desktop preview](evidence/2026-10-04/workspaces/workspace-1440.png), [320px form](evidence/2026-10-04/workspaces/workspace-320-form.png), [320px dark English](evidence/2026-10-04/workspaces/workspace-320-dark-en.png). All captures use disposable test files and may show their temporary paths. [Machine-readable evidence](evidence/2026-10-04/workspaces/verification.json).

## Remaining implementation

At initial67013c5 registration granted owner browsing only. Follow-up fcca9ad adds registered revision binding and explicitly granted native root/child reads; see [workspace-native-reads.md](workspace-native-reads.md). Registration itself still grants no assistant access. Writes/diff/shell, complete leases/target locks, worktrees and edit/unregister UI remain gaps. Source preview is not an immutable artifact or editable Document; T-020 remains pending. No upstream backend or independent polling was added.

The upstream reference remains OpenDots `c2569bb6a13a22e565cf3eb791c62267d06babb1`, read-only outside Git. WorkspaceDialog presentation and the existing extracted tokens informed the form/dialog adaptation; upstream SpaceLibrary product/data behavior was not copied. These screenshots document Rocky interaction and adaptation, not a new matched reference/before/after comparison. Original shell comparisons remain in uiux-opendots-alignment.md; full library/result/Computer alignment is unfinished. Ubuntu, pinned browser clean install and external integration acceptance remain deferred as previously recorded. No remote action.
