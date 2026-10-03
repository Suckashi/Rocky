# Native assistant artifact delivery

Source 0f31a2a4104566b42b9a56fd689d71c599caa59e. T-020 remains in_progress.

Root-only artifact_publish accepts a prior workspace_write call ID and title. Daemon derives operation ownership from current Work/run, derives stable UUID request identity from publish call, and reuses immutable ArtifactStore. It verifies confirmed source/hash and normal configured active execution identity before starting and immediately before SQL registry/event commit. Repeat identities retain existing intent/receipt checks. Operation reference bounds include run UUID plus the full256-character native call ID. No second runtime, new polling, external sharing or implicit access to another Work.

Native tests exercise write→exact approval→publish→actual bytes and rejection after source changes. Store test injects cancellation immediately before registry commit and asserts no artifact. Existing atomic failure/replay/restart tests remain passing. Browser now uses native publication rather than owner POST, then opens the card, renders isolated HTML, toggles source and downloads original bytes.

[Verification](evidence/2026-10-04/artifact-native/verification.json):11 related tests and1 focused normal-daemon browser flow pass; type/lint/build/format/diff pass. Initial test-edit syntax and envelope failures were corrected, not reported as environment blockers. Existing Vite chunk-size/SQLite/startup proxy warnings remain.

Screenshots: [1440](evidence/2026-10-04/artifact-native/html-preview-1440.png), [1280](evidence/2026-10-04/artifact-native/html-preview-1280.png), [390](evidence/2026-10-04/artifact-native/html-preview-390.png), [320](evidence/2026-10-04/artifact-native/html-preview-320.png). Existing ResultPane UI is unchanged; these prove the native delivery path, not new visual fidelity.

## Remaining scope

- Only root configured normal Work exposes artifact_publish; source must be its own succeeded workspace_write and retain confirmed hash
- Single UTF-8 confirmed file only; PNG/JPEG, bundles, document tools and file-context references remain incomplete
- No external publication/share permission; local immutable copy reuses existing store and source receipt
- Cancellation assertion runs before work and inside registry transaction; blob may remain orphaned if cancelled after staging, existing cleanup gap remains
- Four Chinese-light widths browser-tested;320 screenshot inspected; no new matched OpenDots reference/before/after or dark-English matrix
- Fixture provider with real native worker/files/SQLite/HTTP; no paid live model, Ubuntu or full AT26/27 proof

All70 global AT remain not_run. Goal active, no remote actions.
