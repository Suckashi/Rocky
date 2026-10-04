# Open-source repository preparation — 2026-10-04

Scope: T-001, T-034, T-036; documentation, repository tooling, packaging attribution, and GitHub configuration. Existing runtime development changes were preserved. This work does not close live, Ubuntu, dependency-security, or other product release gates.

## Structure

The existing `apps/`, `packages/`, `tests/`, `fixtures/`, `scripts/`, `assets/`, and `specs/` boundaries remain appropriate. Runtime modules were not moved. Added a [documentation index](../README.md), [architecture/file-placement guide](../architecture.md), development guide, roadmap, ADR index, and implementation-record index. Generated and private local directories remain ignored on disk.

English and Traditional Chinese READMEs now share feature scope, preview status, prerequisites, quick start, repository map, contribution links, and attribution. Added contribution/review guidance, support and conduct policies, an unreleased changelog, Issue forms, a PR template, and a GitHub bootstrap/release checklist. No contact address, repository URL, badge, release, or remote setting is fabricated.

## Verification and maintenance

- `check:docs` checks the existing DAG plus public local file links, required source/package notices, Node version consistency, pinned Actions, and basic Issue/Dependabot configuration. It does not validate external URLs or full GitHub service behavior.
- `docs:status` generates the acceptance table from the existing plan; `check:docs` rejects a stale table. Dated status and P0 architecture notes are explicitly marked historical. No task or acceptance status was promoted.
- Added the missing NOTICE and included THIRD_PARTY_NOTICES and the dependency-license inventory in the package allowlist. The package guard checks that these legal files actually appear in `npm pack --dry-run`.
- CI retains Windows/Ubuntu verification and the moderate-or-higher dependency gate. Dependency audit now runs independently. Added time limits, cancellation of superseded runs, cache configuration, explicit hosted-Linux Chromium prerequisites, and seven-day diagnostic artifact retention. No hosted run or branch protection is claimed.
- Dependabot configuration requests weekly dependency/Actions PRs; it does not enable auto-merge.

## Local evidence

See [machine-readable verification](evidence/2026-10-04/repository-preparation/verification.json). Windows x64 / Node 24.12.0 / npm 11.6.4:

| Command                 | Mode    | Exit | Result                                                                         |
| ----------------------- | ------- | ---- | ------------------------------------------------------------------------------ |
| `npm run docs:status`   | static  | 0    | Acceptance summary synchronized                                                |
| `npm run check:docs`    | static  | 0    | DAG and public metadata/links valid                                            |
| `npm run lint`          | static  | 0    | No lint errors                                                                 |
| `npm run format:check`  | static  | 0    | Formatting valid                                                               |
| `npm run build`         | static  | 0    | Build passed; existing large-chunk warning remains                             |
| `npm run test:contract` | fixture | 0    | 12 tests in 3 files passed                                                     |
| `npm run check:secrets` | static  | 0    | No configured source guard findings                                            |
| `npm run check:package` | static  | 0    | 4,443 history objects and actual package checked; no configured guard findings |
| `git diff --check`      | static  | 0    | No whitespace errors                                                           |

Pattern guards are not a comprehensive secret/PII audit. Current and historical source patterns, file sizes, and package exclusions were checked; every historical screenshot was not manually reviewed. Existing test failures and release gaps remain documented rather than hidden.

A separate temporary copy passed the documentation check, then correctly rejected four deliberate faults: a broken public link, a stale acceptance table, NOTICE missing from the package allowlist, and an Action using a mutable branch instead of a commit SHA. The source working tree was not mutated by this smoke check.

## Before GitHub publication

The working tree includes substantial earlier implementation changes. It still needs a reviewed local commit and an explicitly authorized owner/name/visibility/first push. Establish private vulnerability and conduct reporting routes on the real repository, then run hosted CI and configure protection using the actual check names. See the [bootstrap checklist](../release-checklist.md).
