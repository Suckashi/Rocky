# Changelog

User-visible changes are recorded here. Commands and acceptance evidence remain in [implementation records](docs/implementation/README.md). No version has been published from this repository.

## Unreleased — 0.1.0-dev.0

### Added

- Local conversation UI and daemon-owned Work, approvals, operation receipts, and reconnectable history.
- Configured model/MCP connections, workspace tools, worktrees, documents, and attachments.
- Native commands, owned browser sessions, routines, and configured MCP tracking.
- Scoped Memory, versioned Skills, and consent-based Learning with evaluation and human publication.
- Rocky-only backup/restore, setup/doctor commands, bilingual guides, and contribution tooling.
- Roko mascot with daemon-driven activity, one-time completion feedback, reduced motion, hidden/offscreen pause, and an image-load fallback; artwork rights are recorded separately.
- `npm run test:recovery` for persistence, worker, inbox, operation ledger, and backup regression checks.

### Verification and limitations

Pre-publication hardening pins Vitest 4.1.11, refreshes dependency attribution, repairs test-history isolation, and adds separate empty-installation CI coverage. See the [fresh verification record](docs/implementation/pre-publication.md) for exact results.

Windows fixture and browser evidence exists. The [Roko integration report](docs/implementation/roko.md) adds scoped Ubuntu WSL 2 Node-only installation, MCP, and owned-process tests. Ubuntu desktop/browser coverage, strict browser egress, real container enforcement, live-service acceptance, dependency security, and artwork distribution clearance remain open. See the [roadmap](docs/ROADMAP.md) and [Security policy](SECURITY.md). This entry is not a stable-release claim.
