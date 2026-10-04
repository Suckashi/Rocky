# Implementation records

These files preserve engineering decisions and test evidence. They are not all current product documentation. Start with the [documentation index](../README.md) for usage and the [architecture overview](../architecture.md) for current module responsibilities.

## Status sources

1. [Task and acceptance ledger](../../specs/rocky/implementation-plan.json): authoritative IDs, criteria, statuses, and scoped evidence.
2. [Progress log](progress.md): chronological changes; later entries may supersede earlier limitations.
3. [Acceptance table](acceptance-report.md): generated view of the ledger; refresh with `npm run docs:status`.
4. [Pre-publication verification](pre-publication.md): fresh complete Windows test invocations, dependency remediation and local snapshot review.
5. [V1 concentrated report](evidence/2026-10-04/v1-concentrated/verification.json): earlier Windows results and focused reruns, with original failures retained.

The dated [earlier October 4 snapshot](status-2026-10-04.md), [P0 architecture notes](architecture.md), and feature notes describe their stated revision. Do not add up every historical limitation as a current gap, or apply a later success to an untested platform.

## Evidence conventions

- Record operating system, Node version, revision, lockfile hash, mode, command, exit code, and limitations.
- Use `static`, `fixture`, and `live` accurately. A test name or an event is not proof of a successful external effect.
- Retain original failed runs and identify the specific reruns that supersede them.
- Distinguish a whole-suite run from case-by-case aggregation. An aggregation command's exit code is not a test runner result.
- Publish reviewed synthetic inputs and sanitized results. Live summaries must omit private configuration, credentials, and user content. Keep raw private diagnostics in ignored local storage.
- Preserve paths of existing evidence so task references remain valid. Add new reports in a dated subdirectory.

Historical records are retained for traceability. Refresh summaries from the ledger rather than manually maintaining a competing list of acceptance statuses.
