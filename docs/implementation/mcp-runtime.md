# Configured MCP runtime routing

2026-10-03, Windows x64, Node 24.12.0 / npm 11.6.4. Sources `2d8cdf330f58f8b835f8818209ef0c5235b46de5` and UI wording `ce429007312890c4e51b36ca134acb2de7a1bb35`. T-016 remains **in_progress**; this is local fixture evidence, not a real business integration.

## Single strategy and authority

The native Deep Agents graph now exposes one configured-tool strategy: root `mcp_discover` / `mcp_call`. No parallel dynamic tool registry or second runtime. Discovery lists explicitly connected ready servers, then pages five original descriptors using exact server/revision and offset. Descriptions/annotations remain untrusted data. Subagents can discover but cannot call configured external tools; fixture/evaluation/reflection modes cannot use this path.

`mcp_call` uses strict serverId/registryRevision/toolName/arguments contracts. Daemon validates the original input schema before preparing an operation or approval. All configured effects remain `unknown` for policy classification and require fresh exact native interrupt approval; readOnly annotations confer no privilege. Only one approval action per native interrupt is supported; multiple requests fail before dispatch.

Fingerprint binds Work/run/session, original arguments, server/config/registry/schema identity, whole MCP config hash (including credential references/network policy), workspace, model selection and policy revision. Approval and dispatch recheck current connection/catalog. The existing daemon pipeline owns prepared/authorized/dispatched/settled transitions; transport dispatch retains operation ID and intent hash in MCP metadata. No direct frontend tool-call endpoint or frontend authorization boolean.

The manager applies configured timeout and run/connection cancellation, validates SDK result structure/output schema and a 2 MiB result limit. Non-error response is saved as the tool response; Work termination still requires the native graph result. Error/timeout/disconnect after dispatch remains unknown, never failed-known-no-effect. A fixture that writes its exclusive receipt then returns `isError` proves the Work becomes blocked and retry is denied. Generic business completion/remote-pending receipt interpretation is still missing; successful RPC is not independent proof of a remote job finishing.

Retry dedupe compares server/tool/arguments across ancestry while ignoring registryRevision, so reconnecting cannot replay a confirmed effect. Exact approval fingerprints still include revisions. Different server targets remain different effects.

## UI and browser evidence

Existing OpenDots-derived PageReviewCard geometry/tokens are retained. Configured approval shows actual tool/server, external-data impact and an expandable exact-arguments section. The button says "Approve this operation" rather than assuming every MCP call is a write. Composer/settings no longer claim configured tools are synthetic-only. Screenshots: [1440](evidence/2026-10-03/mcp-runtime/approval-1440.png), [1280](evidence/2026-10-03/mcp-runtime/approval-1280.png), [390](evidence/2026-10-03/mcp-runtime/approval-390.png), [320](evidence/2026-10-03/mcp-runtime/approval-320.png). The 600-character argument wraps without whole-page overflow; mobile approval remains actionable after scrolling. Desktop and 320px screenshots were visually inspected. No new OpenDots reference/before/after comparison or dark/English/reduced-motion proof in this slice.

Real browser flow uses configured loopback MCP/provider fixtures, actual native worker and daemon, owner-session configuration, model selection, send, expanded pending approval at four widths, approve, exact single receipt, reload and no second effect. No fake Work is inserted. Fixture corrections: use actual registry revision instead of assuming one; keep the persistent conversation and scope scripted provider replies to the current user turn. An initial screenshot exposed obsolete synthetic-only impact text; corrected and browser-asserted.

## Actual verification and remaining work

[Verification](evidence/2026-10-03/mcp-runtime/verification.json): check/lint, build, full 183 tests before two added boundary cases/final UI text, then final 36 focused tests; final browser 1 passed (previous lifecycle+work browser pair 2 passed). Build retains existing size warnings. No Ubuntu/live business system or remote action.

Not complete: typed structured/image delivery (currently JSON string, no vision), private large-result offload, resources/prompts, owner discovery API, trusted read/resource/target mapping, generic MCP reconciliation and remote-job tracking, schema-change supersession, cancellation/fault matrix, and full schema compatibility/CPU isolation from mcp-schema.md. Inherited synthetic sample tools/connection are still exposed alongside configured tools; remove them from the production configured path and keep fixture tests explicitly isolated. Do not treat this as full AT-08/14/22 acceptance or a finished product.
