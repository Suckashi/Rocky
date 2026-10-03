# ADR-003: Explicit fixture endpoints and server authority

Accepted 2026-10-03.

P0 only accepts explicit mode=fixture and stdio/http selection. Each run configures its own loopback model endpoint and synthetic MCP connection. No external model, arbitrary URL, shell, workspace or secret is accepted by this facade.

Model requests pass the exact-endpoint network client; redirects and unconfigured destinations fail closed. This is a P0 exact-endpoint spike, not the full DNS/proxy/CA implementation of T-007. SDK telemetry/update flags are set before import.

CopilotKit discovery exposes only the local Rocky gateway. Browser egress assertions are independent of functional E2E. Host AdGuard injection was observed calling local.adguard.org; the strict egress test remains failing in that environment. No allowlist exception or system setting change is made to hide it.

Pending approval includes exact run/tool/args/transport/policy/schema fingerprint. Native interrupt produces the checkpoint; daemon validates the owner decision and the tool checks the grant again. Persona and client-supplied fields never bypass this. Unknown effects are not automatically retried. Current P0 restart blocks unfinished work; full generation/inbox/recovery semantics are not claimed.
