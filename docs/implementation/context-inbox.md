# Context and inbox delivery

Source370e855; Windows local fixture contribution to T-011/T-013, not full acceptance.

At main admission, the daemon selects the latest completed normal main graph in the same mode/workspace. Model selection changes do not erase visible context. The new owned graph receives only messages/files through the official SDK; pending tasks, interrupts and operation effects are excluded. Visible main instructions and terminal receipts after that source are reconstructed as evidence. Background and evaluation graph execution remains independent.

The daemon snapshots eligible background completion receipts and stores an immutable context batch with a high watermark. Late completions wait for the next main. Every read validates current Work/run/session ownership and exact sequential cursor. UTF-8 chunks are at most8192 bytes, within the existing64KiB IPC envelope. Only after the worker writes all items and a digest marker using public updateState does it request acknowledgement.

The daemon opens official SqliteSaver and validates the claimed checkpoint in the current run thread: exact marker and every exact item ID/content must be present. A missing checkpoint, foreign thread or incomplete delivery fails closed. Batch acknowledgement, membership and persisted public event share one domain transaction. A checkpoint is evidence of saved context, never evidence that Work or an effect succeeded.

Consumption is relative to completed source ancestry. Each batch records its own included items; recursive ancestry resolves inherited membership without duplicating all prior rows. If a branch checkpoints context and then fails, the next safe completed source excludes that branch and redelivers its results. A repeated acknowledgement for the same checkpoint is idempotent. This is separate from exact operation authorization and receipts.

Tests cover held-main/late-background delivery, failure after context save, actual native checkpoint proof, cursor/owner rejection, Unicode chunks, domain-write fault rollback, cancellation preservation and model/workspace isolation. See [recorded commands](evidence/2026-10-03/inbox-checkpoint.json). No live service or Ubuntu evidence is claimed.

Remaining: long-history native compaction, larger model request transport, precise steering/reset/retry, full crash matrix and public inbox inspection commands. Batch storage and Work snapshots are not yet final long-history performance implementations. These remain product defects or missing functionality, not deferred external verification.
