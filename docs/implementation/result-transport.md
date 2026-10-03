# Bounded result transport

Source d3f595b, T-009/T-011/T-013 contribution. Both directions keep the existing64KiB IPC envelope, capability-owned run/session and strictly increasing sequence. Large daemon model/tool responses and worker final invocation results use private result_begin/chunk/commit frames. No public API or second execution runtime is introduced.

The header fixes request identity, result kind, exact UTF-8 byte count and SHA-256 digest. Base64 chunks preserve split Unicode boundaries, with exact sequential indexes. Receivers permit only current pending RPCs or the current native invocation; wrong-kind, foreign, incomplete, duplicate or expired transfers fail closed. A direct result cannot replace an in-progress transfer. Only a validated complete JSON result resolves the original promise.

Limit:2MiB per result,8 simultaneous receive transfers and8MiB aggregate declared payload. Idle transfers expire after30 seconds on subsequent ingestion; cancellation/disconnect clears receiver buffers. Sending waits for each Node send callback, bounding queued frames per in-flight RPC and respecting backpressure. Every daemon frame rechecks Work ownership. These are transport limits, not provider context limits or an artifact storage API.

Node exit code0 without a confirmed Agent invocation now records an interrupted worker job. Completing a transfer does not complete Work by itself: the daemon still examines native result, outstanding operations and its persisted lifecycle before setting the outcome. Known tool receipts already persisted by the daemon are not replayed merely because their delivery fails.

Tests use actual child processes/native checkpoints: a large Unicode model response crosses daemon→worker and final result crosses worker→daemon intact; a large synthetic tool receipt requires exact native approval, is executed once and is offloaded by native middleware; a configured provider fixture answer reaches authoritative Work and durable visible history. Fault fixtures exercise missing commit, direct-result bypass and wrong kind. No real external effect or paid provider is implied by these synthetic responses.

Remaining: oversized tools/interrupt arguments still follow existing bounded rejection; registered MCP/host workspace capabilities are not implemented by this transport. Large public Work snapshots/history pages need separate payload/performance policies. Abrupt machine power loss and hostile OS-level isolation remain unverified. See evidence/2026-10-03/result-transfer.json for actual commands.
