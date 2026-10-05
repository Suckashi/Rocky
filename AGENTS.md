# Rocky engineering rules

Rocky is a single-user AI engineering partner that runs only on the owner's own
computer (Windows first). It chats, runs background work in project folders,
handles documents, and delegates heavy coding to external coding agents over ACP.

Before changing anything, read `docs/rebuild/product.md` (what we build) and
`docs/rebuild/architecture.md` (how). The old Rocky code, its specs and OpenDots
are references only: do not port code or processes from them wholesale.

## Never break these

- Listen on 127.0.0.1 only. No cloud deployment, LAN access, multi-user or telemetry.
- Every local API call is authenticated. Processes Rocky spawns (commands, MCP
  servers, external agents) never receive that token.
- Every action that changes the outside world goes through one approval pipeline.
  An approval is bound to a hash of the exact content (diff, argv, cwd, target);
  if the content changes before execution, ask again.
- Every action leaves a receipt. Outcomes are only `succeeded`, `failed` or
  `unknown`. Never retry an `unknown` outcome automatically.
- Never infer success from a stream ending. Rocky verifies external-agent work
  itself (diff against the worktree, run the checks).
- Redaction applies to logs and display only. It never alters content sent to a
  model or written back to files.
- Credentials, local databases, browser profiles and private evidence stay out of Git.
- Roko, the mascot, must appear in the UI. The UI is Traditional Chinese first.

## How we work

- Node 24, TypeScript, npm. Pin dependencies and commit the lockfile. Installing
  must not require a compiler or Python.
- Changes come with tests. When reporting, state the real platform, command,
  exit code and limitations. Never mark a failing or unrun test as passed, and
  never fabricate Windows or live-model results.
- Record decisions as short ADRs in `docs/adr/`. Do not maintain requirement
  ledgers or plan JSON.
- Prefer deleting code over adding abstractions. One process, one agent runtime.

## Git

- No push to main, merge, tag, new repository, visibility change or deployment
  without the owner's explicit approval.
