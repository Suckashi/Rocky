# ADR-008: durable root model reservations

Status: implemented budget foundation; T-007 remains in progress.

Domain schema v4 stores immutable per-run budget snapshots and request reservations. The default fixture/evaluation run permits 48 model calls shared by root and native children. Reserving commits before the HTTP call. A duplicate request ID is a dispatch fence, never permission to resend an uncertain request. Failed requests retain their reservation; restart does not reset counters. The Work path enforces this policy before model I/O.

The trusted daemon ledger also supports token caps and configured-price cost caps. These require explicit input/output token bounds before dispatch; unknown context/tokenization never silently becomes a guessed bound. A reported token total settles a reservation exactly once. Missing usage retains its reserved bound and increments the unknown-usage count. A reported overrun is retained and prevents further dispatches under an exhausted budget. This cannot undo a provider's overbilling or enforce a provider's output limit remotely.

Pricing is explicit input/output micro-USD per million tokens. Individual charges are rounded upward using integer arithmetic; aggregate monetary amounts are decimal strings to avoid JavaScript precision loss. Known token totals and known configured-price estimates are partial totals when unknownUsageCalls is nonzero, never a claim of zero total usage. No default provider price or currency conversion is inferred.

`GET /api/v1/works/:id/model-usage` returns a validated snapshot. A run without a budget yet returns 404 rather than invented zero usage. Entries contain purpose, request ID, bounds and usage only; no prompts, response text or credentials. Fixture results deliberately settle with unknown token usage because the synthetic server has no provider token counter.

Still pending: provider usage parsing and trusted token profiles in real model adapters, user-editable run budget profiles, role sub-limits/wall-time limits, and model-purpose routing. These additions must use this shared root ledger and must not create another agent loop. Connection probes retain their separate fixed five-call diagnostic limit.
