# Rocky engineering rules

Rocky is a single-user AI engineering partner that runs only on the owner's own
computer (Windows first). It chats, runs background work in project folders,
handles documents, and delegates heavy coding to external coding agents over ACP.

## Map

- `docs/rebuild/product.md`: what we build (goals, non-goals, V1 scope, success criteria).
- `docs/rebuild/architecture.md`: how we build it, and why.
- `docs/adr/`: one short file per decision that changes either of the above.
- `apps/`, `packages/`, `specs/`, `docs/refactor/`: the old Rocky. Read-only
  reference: do not modify, import from or port it wholesale.
- OpenDots (MIT, github.com/CopilotKit/OpenDots): UI and server-pattern reference.
  When copying structure or values, credit it in `THIRD_PARTY_NOTICES.md`.

## Never break these

- Listen on 127.0.0.1 only. No cloud services in the core path, LAN access,
  multi-user or telemetry.
- Every local API call is authenticated. Processes Rocky spawns (commands, MCP
  servers, external agents) never receive that token.
- Every action that changes the outside world goes through one approval pipeline.
  An approval is bound to a hash of the exact content (diff, argv, cwd, target).
  If the content changes before execution, ask again.
- Every action leaves a receipt. Outcomes are only `succeeded`, `failed` or
  `unknown`. Never retry an `unknown` outcome automatically.
- Never infer success from a stream ending. Rocky verifies external-agent work
  itself (diff the worktree, run the checks).
- External agents answer to Rocky's policy: reply `allow_once` or `reject_once`
  only. "Always allow" rules live in Rocky, never in the external agent.
- Redaction applies to logs and display only. It never alters content sent to a
  model or written back to files.
- Credentials, local databases, browser profiles and private evidence stay out of Git.
- Roko, the mascot, must appear in the UI.
- The UI is switchable between Traditional Chinese (default) and English. Every
  user-facing string goes through the i18n catalog; no hardcoded UI text.

## How we work

- Node 24, TypeScript, npm. Pin dependencies and commit the lockfile. `npm ci`
  must not need a compiler or Python. Every new dependency needs a one-line
  reason in the commit message.
- One Rocky process and one agent runtime (Deep Agents). External agents and MCP
  servers are child processes, not extra runtimes or schedulers.
- Windows is the primary platform: spawn with argv (no shell string), handle
  `.cmd` shims, backslash paths, junctions and CRLF. Test on Windows before
  claiming something works there.
- Changes come with tests. Changes to prompts, tools or the agent loop also run
  the eval suite. A drop in the score blocks the change.
- When reporting, state the real platform, command, exit code and limitations.
  Never mark a failing or unrun test as passed. Never fabricate Windows or
  live-model results.
- Code, comments and commit messages are in English. User-facing text lives in
  the i18n catalogs (`zh-TW` complete first, `en` alongside).
- Prefer deleting code to adding abstractions. No requirement ledgers or plan JSON.

## Git

- No push to main, merge, tag, new repository, visibility change or deployment
  without the owner's explicit approval.
