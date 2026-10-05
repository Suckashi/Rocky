# Security

## Reporting a vulnerability

Do not open a public issue containing an exploit, credential, or private diagnostic. Use [GitHub private vulnerability reporting](https://github.com/Suckashi/Rocky/security/advisories/new) (**Security → Report a vulnerability**), enabled for this repository. If GitHub makes that action unavailable, do not send sensitive details through public issues. No dedicated security mailbox is currently published.

Include the affected revision, minimal synthetic reproduction, impact, and proposed mitigation if known. Remove user data and credentials. Maintainers should acknowledge privately, agree on a disclosure plan, and publish a fix or limitation notice; there is currently no guaranteed response time.

## Supported versions

Only the current `main` development line is maintained. There are no stable releases or supported older release lines yet. A development preview is not a production security assurance. See the [release checklist](docs/release-checklist.md) for remaining release gates.

## Runtime boundaries

Rocky runs locally with explicitly configured network connections. Native execution is not an OS sandbox. Do not publish credentials or private diagnostics in issue reports.

Critical and unknown tool effects require server-validated approval. Tool descriptions, model output and persona text cannot grant permission. Unknown external effects must be reconciled, not automatically retried.

The fixture interface operates only on synthetic data. The local daemon must not be exposed to a LAN or public network; it is not a hosted multi-user service.

## Dependency status

Dependency acceptance remains open as of 2026-10-04. `npm run check:dependencies` reports the current registry advisories and fails on moderate or greater severity; removing automated CI does not resolve these findings. The latest pre-publication audit reports 7 high, 0 moderate and 0 critical affected package entries. Vitest is pinned to 4.1.11, removing the remaining [mocker advisory](https://github.com/advisories/GHSA-82fw-gwwq-j7x9). Earlier targeted overrides update Promptfoo's nested MCP SDK, Drizzle, CSV parser and FTP dependency without changing Rocky's runtime framework. Historical audit reports retain the results for their original lockfiles.

Remaining upstream advisories are not represented as a clean scan. [Braces GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) and [node-forge GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) have no patched release in the checked registry. The seven entries include packages affected through these dependency chains; they are not seven independent root advisories. Model-provided native glob patterns are length/depth bounded before the upstream parser, in root and native children. Node-forge is used directly only to generate dummy TLS certificates in tests; Rocky TLS verification uses Node/Undici, and the restricted evaluator does not accept JKS/provider configuration. These are source-level exposure assessments, not a claim that the upstream packages are fixed. Never apply npm's suggested Deep Agents downgrade to bypass the report.

If execution persistence fails, Rocky stops further execution and reports degraded transport health without inventing a durable completion event. Repair storage, restart the daemon, and reconcile unknown operations before a new attempt. Shutdown still attempts owned-resource cleanup when cancellation records cannot be saved; a cleanup error is reported rather than treated as success.
