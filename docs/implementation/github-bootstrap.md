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

The recorded dependency audit has seven high affected-package entries. This gate remains enabled and must not be bypassed. Strict browser egress, pinned-browser, Ubuntu desktop/browser, live services, actual container enforcement and relative-performance acceptance remain scoped by their own reports. Public preview source is not a stable release.
