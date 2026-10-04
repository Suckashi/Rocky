# Roadmap and known gaps

Rocky is a development preview. The goal is a local engineering assistant with explicit network access, daemon-owned operations, and reviewed Learning. The [task/acceptance ledger](../specs/rocky/implementation-plan.json) is authoritative; this page summarizes direction without turning task counts into a release percentage.

## Implemented paths

The current source connects conversation and background Work, precise approvals and stop/steering, model/MCP configuration, workspace tools and worktrees, documents and attachments, Native execution, owned browser sessions, routines and tracking, scoped Memory/Skills, Learning review/evaluation/publication, and Rocky-only backup/restore.

Windows fixtures and browser runs cover these paths with scoped limitations. The [pre-publication report](implementation/pre-publication.md) records fresh complete runs and the remaining failures. The earlier [concentrated verification report](implementation/evidence/2026-10-04/v1-concentrated/verification.json) combines initial runs and focused repairs. Neither establishes acceptance for untested environments or live integrations.

## Before a verified release

- Extend the [Ubuntu WSL 2 Node-only and MCP evidence](implementation/roko.md) to native desktop/browser and remaining command coverage.
- Pass strict browser egress in a clean environment using the pinned browser.
- Resolve remaining dependency advisories; see [Security](../SECURITY.md).
- Verify a real container engine's enforcement, including network behavior.
- Establish a comparable performance baseline and the full resource acceptance conditions.
- Run the authorized external model/MCP acceptance path.
- Review artwork distribution rights and final presentation; the original-source license alone does not settle name or trademark review.

Container browser transport and unsafe generated-code evaluation remain unavailable when no verified executor exists. There is no automatic host fallback or automatic skill publication.

## Public repository preparation

Repository documentation and contribution tooling can be published as preview source while release gates remain explicit. First publication requires a reviewed Git snapshot, agreed owner/name/visibility, private vulnerability reporting, and real CI results. Follow the [bootstrap and release checklist](release-checklist.md); do not tag a stable release based on this roadmap.
