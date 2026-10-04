# Pre-publication verification — 2026-10-04

Rocky is prepared as development-preview source. This record covers the existing V1 working tree, open-source documentation and community files, dependency remediation, fresh Windows regression runs, public-file review, and local snapshot preparation. Stable-release acceptance remains open.

## Exact snapshot and evidence

- [Verification record](evidence/2026-10-04/pre-publication/verification.json): actual commands, exits, platform, lockfile and limitations.
- [Source manifest](evidence/2026-10-04/pre-publication/source-manifest.json): hashes of implementation, tests, fixtures, configuration and CI files.
- [Publication review](evidence/2026-10-04/pre-publication/publication-review.json): source-review scope, image inventory, history checks and dependency assessment.
- [Final unit/service run](evidence/2026-10-04/pre-publication/unit-final.json): **402 passed, 0 failed, 0 skipped** in a fresh full invocation.
- [Final seeded browser run](evidence/2026-10-04/pre-publication/browser-final.json): **49 passed, 1 failed, 1 skipped**.
- [Separate empty installation](evidence/2026-10-04/pre-publication/empty-final.json): **1 passed**. This case deliberately does not run against seeded history.
- [Windows Node-only clean-copy check](evidence/2026-10-04/pre-publication/no-python.json): npm ci, typecheck, build, selected core/Learning tests and evaluation pass; no forbidden-tool attempts. This is a constrained-PATH check on this host, not Ubuntu or pristine-machine evidence.

The final unit and browser totals come from complete invocations. They are not combined from selected reruns. Initial [unit](evidence/2026-10-04/pre-publication/unit-initial.json), [second unit](evidence/2026-10-04/pre-publication/unit-second.json), and [browser](evidence/2026-10-04/pre-publication/browser-initial.json) failures are retained separately. New public summaries omit raw provider messages and absolute workstation paths; raw runner diagnostics remain in ignored local reports.

## Commands

Platform: Windows x64; Node 24.12.0; npm 11.6.4. Browser-dependent checks explicitly use installed Chromium 1223, version 148.0.7778.96. The pinned Playwright Chromium 1243 download timed out on both attempts, including an extended timeout retry.

| Command                                                                                                | Mode    | Exit |
| ------------------------------------------------------------------------------------------------------ | ------- | ---- |
| `npm run check`                                                                                        | static  | 0    |
| `npm run build`                                                                                        | static  | 0    |
| `npm run test:learning`                                                                                | fixture | 0    |
| `npm run test:network`                                                                                 | fixture | 0    |
| `npm run test:no-python`                                                                               | fixture | 0    |
| `npm run test:e2e`                                                                                     | fixture | 1    |
| `npm run test:e2e -- tests/e2e/empty-install.spec.ts`                                                  | fixture | 0    |
| `npm test -- --reporter=default --reporter=json --outputFile=.rocky-reports/bootstrap-unit-final.json` | fixture | 0    |

Build succeeds with existing large-chunk warnings. Local typecheck, lint, formatting, documentation consistency, source/history guards and package inventory checks are recorded in the verification JSON. No GitHub Actions execution or branch protection is claimed.

## Repairs made during this pass

1. Pin Vitest 4.1.11 and refresh the lockfile/license inventory. The audit changes from 7 high + 2 moderate to 7 high + 0 moderate; critical remains zero. The remaining seven affected-package entries come from the braces and node-forge dependency chains. [Before](evidence/2026-10-04/pre-publication/dependency-before.json) and [after](evidence/2026-10-04/pre-publication/dependency-after.json) results remain available. CI retains the moderate-or-higher failure threshold.
2. Reconnect tests now compare daemon-owned Work IDs and statuses. Earlier completed history and identical Work titles are legitimate and must not cause false failures.
3. The attachment fixture matches its exact tool-call ID; historical tool messages cannot prematurely complete the image scenario.
4. Storage failure polling allows the actual worker startup and model round trip. Artifact fault injection targets the publication event, so a late cleanup event cannot consume the injected failure. Persistence and rollback assertions remain intact.
5. UI completion timing uses a MutationObserver and two animation frames. The original 500 ms projection threshold remains; the local final p95 is 443 ms. This is a current-host dev-server baseline, not relative-speedup or all-platform acceptance.
6. CI installs the pinned browser before native browser integration and runs the empty-installation case separately. The acceptance table exposes each entry's revision, platform, mode, command, report and limitations.

## Review and remaining gates

The candidate inventory and critical authority/persistence/transport paths were reviewed. All 251 current screenshots were inspected in contact sheets; the observed content is synthetic test data and reference comparisons. Some older screenshots retain temporary paths and the Windows account folder name. This was not exhaustive OCR or inspection of every historical image revision. The 17 changed historical JSON records were compared structurally with HEAD and retain the same data. Source/history pattern guards and the 707-file package inventory found no configured violations; these checks are not an exhaustive security audit.

Strict browser egress still fails with observed host-injected local.adguard.org requests. Pinned-browser/clean-environment acceptance, Ubuntu, live external provider/MCP acceptance, actual container enforcement, remaining performance criteria and dependency security remain open. No acceptance status was promoted by this preparation pass. See [Security](../../SECURITY.md) and the [roadmap](../ROADMAP.md).

No remote was created, configured or pushed. No merge, tag or deployment occurred. The owner/name/visibility, private reporting route, hosted CI and default-branch protection belong to the separately authorized GitHub bootstrap. The [release checklist](../release-checklist.md) remains the handoff guide.
