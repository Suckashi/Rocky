# Implemented P0 architecture

React/Vite + CopilotKit OSS runtimeUrl discovery sends AG-UI input to the Hono gateway. The gateway creates a durable Work before calling the single createRockyAgent factory. Native task, todo middleware and interrupt produce real SDK execution. Root/child policy hooks expose public evidence; all fixture tools call the official MCP client over stdio or Streamable HTTP.

Domain state, receipts, decisions, operation outcomes and events live in node:sqlite. Official SqliteSaver persists graph checkpoints separately. SSE sends only persisted domain events. UI detach does not cancel Work. Explicit stop aborts the selected work; restart blocks unfinished work instead of replaying pending effects.

A fixture model HTTP server is explicitly scoped to each run. It supplies deterministic responses; Deep Agents executes the actual middleware and tool path. Evaluation marks Work runMode=evaluation and uses the same factory. Promptfoo is imported only by the dedicated evaluation command, not the browser or normal daemon startup.

Current routes: /api/v1/session, health, capabilities, works, works/:id, conversation/messages, approvals/:id/decision, works/:id/stop, events; /api/v1/copilotkit/info and agent/rocky/run form the OSS gateway. Production assets are served on 127.0.0.1:3211, development UI on 127.0.0.1:3210.

This P0 facade is deliberately incomplete: worker isolation, full canonical domain contracts, background sessions, steering, live provider configuration, cursor snapshots/history paging, artifact/document storage, automatic learning and final Rocky assets are not implemented.
