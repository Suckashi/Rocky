# Rocky engineering instructions

Rocky is an independent greenfield product. Read `specs/rocky/AGENT_START_HERE.md` and the current task's contracts before changes. Apsis and OpenDots are read-only references, never implementation roots or migration sources.

- Use Node 24 and npm; pin dependencies and commit the lockfile. No Python/compiler fallback in core installation.
- Keep one Deep Agents runtime. Native tasks are ephemeral children, not a second durable job scheduler.
- Treat the daemon as the authority for Work, approvals and operation effects. Never infer success from stream termination.
- Run relevant tests and record real platform, mode, command, exit code and limitations in `docs/implementation/` and the existing plan JSON.
- Do not mark incomplete acceptance tests passed. Never fabricate live or Ubuntu evidence.
- No remote creation, visibility changes, first push, merge, tag or deployment without explicit authorization.
- Keep credentials, local databases, browser profiles and private evidence out of Git.
