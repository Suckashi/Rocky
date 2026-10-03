# Confirmed native conversation context

2026-10-03, commit 7287653. T-011/T-013 contribution; not complete continuous-conversation acceptance.

At admission, the daemon selects only the immediately prior completed normal main Work with matching model connection revision, mode and workspace scope. ExecutionSession records its source graph thread and generation. Background/evaluation sessions never select a main source. Unconfigured chat has no invented workspace registration; resource admission falls back to Work identity.

The trusted worker reads that immutable completed thread through official SqliteSaver and copies only messages/files through the public agent.updateState API into the new owned run thread. It does not copy pending tasks, interrupts, scheduling state or operation effects. Each Work/run/executionSession remains distinct. Native invocation uses sync checkpoint durability. Resume remains scoped to the current live Work and its exact approval. Result IPC returns the latest message; private history remains in graph storage.

Actual fixture tests prove model recollection across turns/restart, background/evaluation/workspace isolation, fresh approval and unchanged prior operation rows. Synthetic responders are confined to fixtures. No SDK patch, custom checkpoint format or second runtime was introduced.

Current gap: immediately prior cancelled/failed/blocked Work, changed model revision or changed workspace starts fresh graph context. This is a temporary implementation limit, not the final behavior requirement. Safe reconstruction of confirmed visible context must preserve previous instructions without replaying uncertain graph tasks. Inbox batch/high-watermark acknowledgement is still absent. Native compaction and long model IPC bounds require their explicit acceptance scenarios; no global AT is marked passed.

See [actual commands and outcomes](evidence/2026-10-03/continuous-context.json). Browser functional cases pass; the selected command also ran the known AdGuard egress test and exited1. This failure is retained, not waived.
