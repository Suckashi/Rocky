# GitHub bootstrap — 2026-10-04

The owner authorized `Rocky`, Public visibility, integration into `main`, repository creation and first push. The authenticated GitHub account was verified as `Suckashi`. The owner separately identified the Roko image as GPT-generated, inspired by _Project Hail Mary_ (《極限返航》). The public repository includes it with a separate rights record; no artwork reuse license or third-party character/trademark clearance is asserted.

## Before first push

- Created the empty public [Suckashi/Rocky](https://github.com/Suckashi/Rocky) repository, ID `1404409838`, without generated source files or imported history.
- Configured `origin` as `https://github.com/Suckashi/Rocky.git`.
- Enabled and read back GitHub private vulnerability reporting. [Report a vulnerability](https://github.com/Suckashi/Rocky/security/advisories/new).
- Verified Actions are enabled, default workflow permissions are read-only, and workflows cannot approve pull requests.
- Added the actual repository/homepage/issue metadata and retained the lockfile. Only public documentation, package metadata and asset provenance changed after the verified candidate `ae719b7`.
- A dedicated private conduct contact remains unspecified; the conduct policy states the available GitHub abuse-reporting route without inventing a mailbox.

This section is a pre-push snapshot: it does not claim a completed push, hosted CI or enabled branch protection. The bootstrap execution receipt and workflow links are recorded after the relevant operations occur. Local verification commands and limitations are in [the evidence record](evidence/2026-10-04/github-bootstrap/verification.json).

## Verification scope

The prior [publication candidate](publication-candidate.md) records 404 passing unit/service tests, one skipped pinned-browser case with a separate passing compatibility-browser rerun, and nine passing focused browser cases. This bootstrap does not convert those into new full-suite results. No runtime behavior or dependency version changed here.

The recorded dependency audit has seven high affected-package entries from two root advisories with no patched release. The gate remains enabled; see [dependency audit exceptions](#dependency-audit-exceptions). Strict browser egress, pinned-browser, Ubuntu desktop/browser, live services, actual container enforcement and relative-performance acceptance remain scoped by their own reports. Public preview source is not a stable release.

## Completed publication and hosted CI

Published `1b11a14bf713b8a5659268fa15aa75bf93ab2a0e` to [Suckashi/Rocky](https://github.com/Suckashi/Rocky), with Public visibility and default branch `main`. Main now requires PRs, fresh Windows/Ubuntu/dependency checks from GitHub Actions, and resolved conversations. Admin enforcement is enabled; force pushes and deletion are disabled. Solo maintenance uses zero required external approvals. Private vulnerability reporting is enabled. No tag, GitHub Release or deployment was created.

[Initial Verify run 37204351525](https://github.com/Suckashi/Rocky/actions/runs/37204351525) failed:

| Job              | Result                           | Observed failure                                             |
| ---------------- | -------------------------------- | ------------------------------------------------------------ |
| Windows          | 386 unit tests passed, 19 failed | Short temporary-path aliases; one aggregate scenario timeout |
| Ubuntu           | 404 unit tests passed, 1 failed  | Native Chromium sandbox startup                              |
| Dependency audit | Failed                           | Seven high affected-package entries                          |

The unit failures prevented later checks in that initial run. [Draft PR 8](https://github.com/Suckashi/Rocky/pull/8) records and repairs the runner configuration. The Ubuntu repair at `a150f57` has passed browser preflight, the full unit step, build, package scan, learning and network fixtures; the whole job was still running at observation. Windows repair normalizes CI temporary paths, preserves private-data exclusion when Store starts through a directory alias, and gives a ten-worker scenario a 90s aggregate budget while retaining each Work's 10s deadline. Its focused Windows regression passed **33 tests in eight files**, with typecheck, focused lint and format checks passing. Fresh hosted verification is pending.

See the [execution receipt](evidence/2026-10-04/github-bootstrap/execution.json) for commands, platform, mode, exit codes, revision scope and limitations. This PR has not been merged and preview publication is not stable-release acceptance. Concurrent unrelated work in the original checkout is preserved; CI repair runs in a separate managed worktree.

## Dependency audit exceptions

The owner chose documented exceptions instead of downgrading Deep Agents or promptfoo, or disabling the job. `npm run check:dependencies` now runs [check-dependencies.mjs](../../scripts/check-dependencies.mjs), which accepts only the advisories in [dependency-audit-exceptions.json](dependency-audit-exceptions.json) on their exact locked versions until `reviewBy`. Any other moderate+ advisory, version change, expiry or stale entry fails the gate.

| Advisory            | Package          | Reachability                                  |
| ------------------- | ---------------- | --------------------------------------------- |
| GHSA-vfj7-8cjw-p6xm | braces 3.0.3     | Runtime, through Deep Agents glob filtering   |
| GHSA-86w9-cpqp-85rv | node-forge 1.4.0 | Test TLS fixtures and promptfoo keystore code |

Both advisories remain installed. The braces stack-exhaustion risk is runtime-reachable and unmitigated. Clean-audit security acceptance is not promoted. Exceptions expire on 2026-11-04. [Evidence](evidence/2026-10-04/dependency-audit/verification.json).
