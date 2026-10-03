# Model connection settings (T-007, partial)

Open **模型連線設定 / Model connections** beneath the synthetic fixture controls. Saving stores a new revision in Rocky's own database and sends no model requests. Chat still uses the deterministic fixture; passing a connection probe does not enable a live assistant.

Choose OpenAI-compatible, OpenAI, Anthropic or Ollama-compatible and explicitly enter the API base URL including its version path (for example a locally configured `/v1`). Rocky appends `/chat/completions` for OpenAI-compatible formats or `/messages` for Anthropic. There is no endpoint fallback. Context can remain unknown; maximum output tokens must be explicit.

Only enter an environment variable **name** in the credential field. Set its value in the daemon's launch environment before starting Rocky. For PowerShell, this avoids embedding a value in command history:

```powershell
$env:ROCKY_MODEL_KEY = Read-Host 'Model credential' -MaskInput
npm run dev
```

No key value is accepted in the settings schema or returned to the browser. Environment reference names are stored in the domain DB; key values are not. Editing is full replacement: re-enter needed credential/CA reference names or leave them blank to clear. Every edit invalidates earlier probe results. Concurrent stale edits return a revision conflict.

**Test connection** explicitly sends at most five requests: nonce text, one forced synthetic echo tool call, its fixed tool-result roundtrip, streaming text, and client-side stream cancellation. The deadline is 15 seconds and each request's output limit is the smaller of 128 and the configured maximum. Responses are bounded to 64 KiB. A provider may charge for these requests; the limit is not a measured currency budget. Cancellation confirms the client aborts its transport, not that a provider stops billing. No workspace data or user conversation is sent and no real tool is executed.

Probe IDs are idempotent. Dispatch counts are persisted before I/O. A restart marks unfinished probes interrupted without retrying them. Editing cancels outstanding probes for older revisions, and old results cannot verify a newer revision. Only check states and safe error codes are retained, not provider response bodies.

Proxy modes are direct (default), explicitly configured HTTP(S) proxy, or environment policy. Environment mode honors `http_proxy`/`HTTP_PROXY`, `https_proxy`/`HTTPS_PROXY` and `no_proxy`/`NO_PROXY`, with lowercase taking precedence even when empty. NO_PROXY supports `*`, exact or suffix host names, leading `.`/`*.`, optional ports and bracketed IPv6 literals. CIDR entries and proxy authentication references are not implemented. Proxy URLs cannot embed credentials.

For an enterprise/model CA, place PEM certificate content in a daemon environment variable and enter its name as the CA reference. That connection adds the certificate to Node's default trust set. Other connections retain their own trust; TLS verification is never disabled. HTTPS proxy certificates still use default trust (there is no separate custom proxy-CA field). No system or npm proxy/CA setting is changed.

The endpoint host/IP/port is explicitly selected by the owner, permitting configured local or company models. Redirects are rejected before any follow-up or credential forwarding. This client is not an OS network sandbox and does not grant network permissions to tools, websites, MCP or learning.

The current Agent fixture/evaluation path now reserves a durable shared root budget before each model call (48 calls by default, including native children). `GET /api/v1/works/:id/model-usage` exposes the validated snapshot. Reported usage can settle token/cost reservations, but synthetic results remain explicitly unknown. See [budget contract](../adr/008-root-model-budget.md).

The configured model adapter now parses ordinary OpenAI-compatible/Anthropic usage and runs through the same native Agent factory in HTTP fixture integration tests. Registry leases pin revisions and abort on configuration changes. It is not yet selectable through Work submission or the UI. See [adapter contract](../adr/009-configured-model-adapter.md).

Still pending within T-007: Work/evaluation routing and model selection, trusted tokenizer profiles, cache-priced usage, editable budgets and expanded DNS/rebind policy evidence. Vision/structured-output capability is unverified. Production provider endpoints, Ubuntu and HTTPS proxy custom trust have not been exercised. Do not interpret local protocol fixtures as live-provider certification or full AT acceptance.
