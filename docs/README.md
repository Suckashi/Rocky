# Documentation

[Project overview](../README.md) · [繁體中文](../README.zh-TW.md) · [Contribution guide](../CONTRIBUTING.md)

## Use Rocky

| Guide                                                                            | Covers                                                 |
| -------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [English user guide](user-guide.en.md) / [繁體中文操作指南](user-guide.zh-TW.md) | Installation, first model, approvals, and storage      |
| [Attachments](attachments.md)                                                    | Supported inputs and immutable attachment scope        |
| [Browser](browser.md)                                                            | Profiles, ownership, snapshots, and takeover           |
| [Environments](environments.md)                                                  | Native execution and optional container setup          |
| [Routines](routines.md) / [Tracking](tracking.md)                                | Scheduled work and configured MCP follow-ups           |
| [Learning](learning.md)                                                          | Consent, evaluation, human publication, and withdrawal |
| [Backup and restore](backup.md)                                                  | Rocky-only backups and restoration                     |
| [MCP reconciliation](mcp-reconciliation.md)                                      | Handling uncertain external outcomes                   |

## Build and maintain Rocky

- [Architecture and file placement](architecture.md)
- [Development and verification](development.md)
- [Roadmap and known gaps](ROADMAP.md)
- [GitHub bootstrap and release checklist](release-checklist.md)
- [Change history](../CHANGELOG.md)
- [Architectural decision records](adr/README.md)
- [Product specifications](../specs/rocky/README.md) and [task/acceptance ledger](../specs/rocky/implementation-plan.json)

## Read engineering evidence

[Implementation records](implementation/README.md) explain task results, platform coverage, and dated evidence. Historical snapshots describe the revision at which they were written. The task ledger is the status source; an old `not_run` table or a later test count should not silently replace its acceptance criteria.

Public evidence must be reviewed and redacted. Prefer synthetic fixtures; live summaries must omit credentials, private configuration, and user content. Store private diagnostics outside this source tree; see [Security](../SECURITY.md).
