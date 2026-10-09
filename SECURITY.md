# Security

## Reporting a vulnerability

Do not open a public issue containing an exploit, credential, or private diagnostic. Use [GitHub private vulnerability reporting](https://github.com/Suckashi/Rocky/security/advisories/new) (**Security → Report a vulnerability**). Include the affected revision, a minimal synthetic reproduction, the impact, and a proposed mitigation if known. There is no guaranteed response time.

## Status

Rocky V1 is on `main` with no tagged release. Nothing here is a production security assurance.

## Runtime boundaries (design)

- Rocky listens on 127.0.0.1 only and must never be exposed to a LAN or public network.
- Every action that changes the outside world passes one action gate, is bound to a hash of its exact content, and leaves an operation log entry. Unknown outcomes are never retried automatically.
- Rocky has no OS sandbox on any platform; commands run with your user's permissions. See [ADR 0007](docs/adr/0007-m2-tools-approvals-eval.md) and [ADR 0019](docs/adr/0019-lighter-guardrails-plan-mode.md); in hands-off mode dangerous commands run without asking.
- Reading a secret file (`.env`, keys, `.ssh` and similar) always asks, in every mode and for OpenCode too. A search leaves secret files out unless you approved searching that path. `opencode acp` serves HTTP on a loopback port; Rocky gives it a new random password at every start. See [ADR 0020](docs/adr/0020-secret-reads-opencode.md).
