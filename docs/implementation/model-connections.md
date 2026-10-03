# Model connection settings (T-007, partial)

Open **模型連線設定 / Model connections** beneath the synthetic fixture controls. Saving stores a new revision in Rocky's own database and sends no model requests. After entering an explicit context window larger than the output reserve, choose **使用此模型 / Use this model**, then send a message. Selection alone sends nothing; submitting sends the message to that exact connection revision. Tools currently operate only on synthetic samples, not real workspaces or external accounts. Clearing selection or enabling the synthetic fixture returns to fixture mode; selection is not automatically restored after reload.

Choose OpenAI-compatible, OpenAI, Anthropic or Ollama-compatible and explicitly enter the API base URL including its version path (for example a locally configured `/v1`). Rocky appends `/chat/completions` for OpenAI-compatible formats or `/messages` for Anthropic. There is no endpoint fallback. Context can remain unknown; maximum output tokens must be explicit.

Only enter an environment variable **name** in the credential field. Set its value in the daemon's launch environment before starting Rocky. For PowerShell, this avoids embedding a value in command history:

```powershell
$env:ROCKY_MODEL_KEY = Read-Host 'Model credential' -MaskInput
npm run dev
```

No key value is accepted in the settings schema or returned to the browser. Environment reference names are stored in the domain DB; key values are not. Editing is full replacement: re-enter needed credential/CA reference names or leave them blank to clear. Every edit invalidates earlier probe results. Concurrent stale edits return a revision conflict.

**Test connection** explicitly sends at most five requests: nonce text, one automatically selected synthetic echo tool call, its fixed tool-result roundtrip, streaming text, and client-side stream cancellation. The deadline is 15 seconds and each request's output limit is the smaller of 128 and the configured maximum. Responses are bounded to 64 KiB. A provider may charge for these requests; the limit is not a measured currency budget. Cancellation confirms the client aborts its transport, not that a provider stops billing. No workspace data or user conversation is sent and no real tool is executed.

Probe IDs are idempotent. Dispatch counts are persisted before I/O. A restart marks unfinished probes interrupted without retrying them. Editing cancels outstanding probes for older revisions, and old results cannot verify a newer revision. Only check states and safe error codes are retained, not provider response bodies.

Proxy modes are direct (default), explicitly configured HTTP(S) proxy, or environment policy. Environment mode honors `http_proxy`/`HTTP_PROXY`, `https_proxy`/`HTTPS_PROXY` and `no_proxy`/`NO_PROXY`, with lowercase taking precedence even when empty. NO_PROXY supports `*`, exact or suffix host names, leading `.`/`*.`, optional ports and bracketed IPv6 literals. CIDR entries and proxy authentication references are not implemented. Proxy URLs cannot embed credentials.

For an enterprise/model CA, place PEM certificate content in a daemon environment variable and enter its name as the CA reference. That connection adds the certificate to Node's default trust set. Other connections retain their own trust; TLS verification is never disabled. HTTPS proxy certificates still use default trust (there is no separate custom proxy-CA field). No system or npm proxy/CA setting is changed.

The endpoint host/IP/port is explicitly selected by the owner, permitting configured local or company models. Redirects are rejected before any follow-up or credential forwarding. This client is not an OS network sandbox and does not grant network permissions to tools, websites, MCP or learning.

The current Agent fixture/evaluation path now reserves a durable shared root budget before each model call (48 calls by default, including native children). `GET /api/v1/works/:id/model-usage` exposes the validated snapshot. Reported usage can settle token/cost reservations, but synthetic results remain explicitly unknown. See [budget contract](../adr/008-root-model-budget.md).

The configured model adapter parses ordinary OpenAI-compatible/Anthropic usage and runs through the same native Agent factory and daemon Work path. The UI and CopilotKit facade pass only a connection ID/revision; credentials remain in the daemon. Registry leases pin revisions and abort on configuration changes. Older pending approvals cannot write after that revision changes. Completed work preserves its original model selection, and replaying a submission ID never creates another run. See [adapter contract](../adr/009-configured-model-adapter.md).

Still pending within T-007: trusted tokenizer profiles, cache-priced usage, editable budgets and expanded DNS/rebind policy evidence. Vision/structured-output capability is unverified. One authorized live endpoint passed the protocol probe; full live Work, Ubuntu and HTTPS proxy custom trust remain unverified. Do not interpret local protocol fixtures as live-provider certification or full AT acceptance.

## Configured evaluation

The trusted evaluation provider accepts `{ mode: "configured", modelSelection: { connectionId, revision } }`. Case text accepts only transport and synthetic approval decision; it cannot change the model or grant another endpoint. Root and child run through the same Work service and durable budget as normal Work. Output metadata includes Work ID, pinned selection, event IDs and the authoritative usage snapshot.

For the dedicated `scripts/evaluate.ts` runner, set `ROCKY_EVAL_DIR` to an isolated Rocky evaluation directory whose `work` subdirectory already has its own configured model registry. Set `ROCKY_EVAL_MODEL_SELECTION` to the JSON connection ID/revision, and supply credential references in the process environment. The script deliberately does not import settings from another product or invent a default provider. Run `npm run test:learning`; without the selection variable it remains fixture mode. `test:network` is the local-only audit command and should retain fixture mode.

The configured endpoint is allowed only for the duration of each evaluation call, including native children/resume. Both global fetch and configured ModelNetwork check the active evaluation guard; endpoint permissions are reference counted for concurrent calls and revoked afterward. Only synthetic `write_sample` approval is automatic. Four development cases are not sufficient evidence to publish a learned skill.

## Per-Work budget

Work submission and CopilotKit forwarded properties accept optional `modelBudget`, with `maxCalls` (default 48), nullable `maxTokens`, nullable `maxMicroUsd`, and explicit input/output micro-USD-per-million pricing when money is capped. The daemon validates and persists this budget atomically with Work creation. The same root budget includes native children. Submission retries cannot change the budget, and Work CAS updates cannot replace it. Existing persisted Works without an explicit budget retain the default.

Trusted evaluation configuration accepts the same budget. The runner reads `ROCKY_EVAL_MODEL_BUDGET` as JSON, for example `{"maxCalls":12}`. This is a per-Work cap, not an aggregate campaign cap. UI budget controls and campaign budgets are still pending. Token/cost caps require trusted bounds; without a configured trusted tokenizer they fail before dispatch rather than guessing. Prices are owner-supplied estimates, not provider invoices.
