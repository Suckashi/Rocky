# Security

## Reporting a vulnerability

Do not open a public issue containing an exploit, credential, or private diagnostic. Use [GitHub private vulnerability reporting](https://github.com/Suckashi/Rocky/security/advisories/new) (**Security → Report a vulnerability**). Include the affected revision, a minimal synthetic reproduction, the impact, and a proposed mitigation if known. There is no guaranteed response time.

## Status

Rocky V1 is on `main` with no tagged release. Nothing here is a production security assurance.

## Runtime boundaries (design)

- Rocky listens on 127.0.0.1 only and must never be exposed to a LAN or public network.
- Every action that changes the outside world passes one action gate, is bound to a hash of its exact content, and leaves an operation log entry. Unknown outcomes are never retried automatically.
- Rocky has no OS sandbox on Windows; commands run with your user's permissions. See [docs/rebuild/approvals.md](docs/rebuild/approvals.md).
