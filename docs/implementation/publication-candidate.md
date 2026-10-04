# Local publication candidate — 2026-10-04

This pass reviews and records the existing Roko integration and V1 continuation as a local development-preview candidate. The source changes are accompanied by refreshed English/Traditional-Chinese README asset maps, a current product-mark guide, changelog, and explicit artwork rights and branch bootstrap checklist. No product acceptance status was promoted.

## Current verification

Windows x64, Node v24.12.0, npm 11.6.4.

- Fresh complete unit/service run: **404 passed, 0 failed, 1 skipped**, across 99 files.
- The skipped native-browser case requires the unavailable pinned executable. A [separate compatibility-browser run](evidence/2026-10-04/publication-candidate/native-browser.json) passed 1/1 with installed Chromium 1223; it does not change the full invocation's skipped result.
- Focused Roko/identity/HTML preview/background/reconnect browser run: **9 passed**, no failures or skips. Installed Chromium 1223 compatibility override.
- Typecheck, lint, formatting, documentation, build, source/history and package checks passed. Existing large-chunk build warnings remain.
- Existing Ubuntu WSL 2 Node-only/MCP/process evidence inspected; all eight recorded runtime/lockfile hashes match this source. This pass did not rerun Ubuntu.
- Three existing synthetic Roko screenshots inspected: desktop, mobile dark, and mobile identity.

[Exact commands and limitations](evidence/2026-10-04/publication-candidate/verification.json) · [Unit results](evidence/2026-10-04/publication-candidate/unit.json) · [Browser results](evidence/2026-10-04/publication-candidate/browser.json) · [Source hashes](evidence/2026-10-04/publication-candidate/source-manifest.json)

## Git handoff

Local `main` remains at `e42a0a8`, the previous publication baseline. The Roko candidate is recorded on `codex/opendots-ui-alignment`; creating main did not include these later changes. The exact candidate commit is recorded in the verification JSON by a documentation-only follow-up. Remote setup, integration into main, and first push require explicit owner authorization under AGENTS.md.

## Open publication and release items

The Roko atlas distribution rights require owner clarification before publishing a snapshot containing it. Its source import is not an Apache-2.0 grant. Confirm GitHub owner/name/visibility and bootstrap authorization, then configure real project links, private reporting, hosted CI, and branch protection using the [release checklist](../release-checklist.md).

The unchanged lockfile retains the recorded seven high dependency entries. Strict browser egress, pinned browser, Ubuntu desktop/browser, real container enforcement, authorized live services, and relative performance remain separate open gates. This candidate is not a stable release or all-green CI claim.
