# Implemented P0 architecture

React/Vite + CopilotKit OSS runtimeUrl discovery sends AG-UI input to the Hono gateway. The gateway creates a durable Work; bounded admission launches a child worker using the single createRockyAgent factory. Daemon model/tool RPC retains provider credentials and authority. Native task, todo middleware and interrupt produce real SDK execution. Root/child policy hooks expose public evidence; all fixture tools call the official MCP client over stdio or Streamable HTTP.

Domain state, receipts, decisions, operation outcomes and events live in node:sqlite. Official SqliteSaver persists graph checkpoints separately. SSE sends only persisted domain events. UI detach does not cancel Work. Explicit stop aborts the selected work; restart blocks unfinished work instead of replaying pending effects.

A fixture model HTTP server is explicitly scoped to each run. It supplies deterministic responses; Deep Agents executes the actual middleware and tool path. Evaluation marks Work runMode=evaluation and uses the same factory. Promptfoo is imported only by the dedicated evaluation command, not the browser or normal daemon startup.

Current routes: /api/v1/session, health, capabilities, works, works/:id, conversation/messages, approvals/:id/decision, works/:id/stop, events; /api/v1/copilotkit/info and agent/rocky/run form the OSS gateway. Production assets are served on 127.0.0.1:3211, development UI on 127.0.0.1:3210.

Current local implementation includes canonical DTO/event contracts, cursor snapshot/SSE projection, configured providers/probes, native fixture/configured workers, bounded main/background/evaluation admission, exact approvals/stop/grant revocation/reconciliation and original Rocky SVG assets. Incomplete: precise steering, cross-turn context and inbox delivery, real workspace/MCP tools, artifact/document storage, Computer and automatic Learning. The OpenDots-aligned shell is presentation only; it does not introduce upstream persistence or a second runtime.

2026-10-03 update: configured root provider SSE is now incremental, with explicit protocol termination, privacy-preserving fragment projection, canonical Work outcomes, numeric ordered cursor replay and an initial-snapshot reconnect action. Local fixture/browser verified; native guarded scratch and persistent conversation/session/history APIs are implemented; cross-turn context, exact steering and inbox/checkpoint coordination remain pending. See streaming/verification.json; no live or Ubuntu claim.

Conversation/history APIs now separate visible user/result records from graph state and per-Work execution sessions. History is immutable, bounded-paginated and excludes evaluation; UI history paging is connected; agent cross-turn context/inbox-checkpoint consumption remains pending. See conversation-history.json.

History UI now uses persistent bounded pages and shared Work-event references; full Work snapshot pagination/performance remains pending. Stream/history scroll verified by local provider fixture. See history-ui/verification.json.
