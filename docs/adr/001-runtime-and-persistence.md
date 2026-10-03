# ADR-001: Native harness and local persistence

Accepted 2026-10-03.

Use Deep Agents 1.14.1 / LangGraph 1.4.10 public APIs. The P0 facade owns Work, receipts, exact approval fingerprints and operation outcomes in node:sqlite. SqliteSaver 1.0.4 owns graph checkpoints in a separate database. Native task and todoListMiddleware run with explicit root and child policy middleware. No host filesystem backend or shell is exposed.

FixtureModel is a deterministic external-response fixture accessed through an explicitly configured loopback HTTP server. It does not execute tools or plan outside Deep Agents. Both UI and trusted evaluation call the same factory. Actual provider configuration, worker IPC, full Work/session semantics and recovery coverage remain subsequent tasks.

CopilotKit 1.77.0 selfManagedAgents emitted an Enterprise warning during investigation and was removed. The retained path uses OSS runtimeUrl discovery and standard AG-UI SSE, with a thin local gateway forwarding into WorkService. No Intelligence key, BuiltInAgent, licensed feature flag or license bypass is used. SDK/public schemas are inspected in installed declarations.

P0 UI displays public CUSTOM events and final messages; it is not yet full provider token streaming. RUN_FINISHED ends a gateway invocation, not the Work authority.
