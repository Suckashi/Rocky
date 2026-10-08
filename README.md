# Rocky

A single-user AI engineering partner that runs only on your own computer (Windows first).
Rocky chats, works in your project folders, handles documents, and delegates heavy coding
to external coding agents over ACP. Roko, our mascot, keeps you company.

**Status: V1 (M0–M5), on `main`.** Verified on Linux; on Windows the owner ran
`scripts/verify-windows.ps1` and fixed what it found (see [ADR 0014](docs/adr/0014-no-hosted-ci-merge-rebuild.md)). There is
no hosted CI: run the checks below locally. The previous Rocky is only in Git history
(before commit `87963aa`).

## Start

You need [Node.js 24](https://nodejs.org/) and Git.

```powershell
git clone https://github.com/Suckashi/Rocky.git
cd Rocky
powershell -ExecutionPolicy Bypass -File .\Start-Rocky.ps1
```

The first run installs dependencies with `npm ci` (no compiler needed). Rocky then opens
your browser with a one-time login link. Run the launcher again to reopen Rocky while it is
running. On other systems use `npm ci` and `npm start`.

Data lives in `%LOCALAPPDATA%\Rocky` (Windows) or `~/.local/share/rocky`: conversations,
receipts and snapshots (`rocky.sqlite`, `snapshots/`), memory (`memory/`), skills
(`skills/`), job worktrees (`worktrees/`), and `secrets.json` (model key, MCP settings).

## Use

1. **Choose a model**: any OpenAI-compatible endpoint (for example Command Code), OpenAI,
   or Ollama. **Choose a project folder**: Rocky only reads, edits and runs commands there.
2. **Chat** in Traditional Chinese or English. Rocky searches, reads, edits files, runs
   commands (argv only, no shell) and runs your tests after changing code. It reads the
   project's `AGENTS.md` at the start of each turn.
3. **Approvals** replace the input box when Rocky needs you (keys `1`–`4`, `Enter`, `Esc`).
   Three modes: always ask, ask when needed (default), hands off. Dangerous commands and
   outside actions always ask. Every action has a receipt; every file change has a
   snapshot and a "restore all" per turn. Details: [ADR 0007](docs/adr/0007-m2-tools-approvals-eval.md).
4. **Documents**: pdf, docx, xlsx, pptx, md and html are read as Markdown, created from
   Markdown, and (Office files) edited in place keeping their formatting.
5. **Delegate** coding to [OpenCode](https://opencode.ai) (`npm i -g opencode-ai`): ask Rocky
   to hand a task to OpenCode. It works in a git worktree; you approve its actions in Rocky;
   Rocky checks the diff and runs the tests; you apply or discard it on the Jobs page.
6. **Memory** (ask Rocky to remember something), **skills** (folders with a `SKILL.md` in the
   skills folder) and **MCP servers** (Settings) extend Rocky. MCP calls always go through
   approval unless you mark a tool read-only.

## Develop

`npm run check` runs type checks, lint, formatting, the i18n checks and the tests.
`npm run test:e2e` (and `test:e2e:jobs`, which needs OpenCode) drive the UI in a real browser
against a scripted model (the system Edge, or `ROCKY_E2E_BROWSER`).
`npm run eval` runs about 30 real tasks against a live model and compares with
`evals/baseline.json` (see `evals/run.ts`). Run it after changing prompts, tools or the agent
loop; models vary between runs, so repeat (`--repeat 3`) before reading a drop as real.

To check everything on a Windows computer in one go (install, checks, both browser tests,
the launcher, leftover processes, and optionally the evaluation), run
`powershell -ExecutionPolicy Bypass -File .\scripts\verify-windows.ps1` (add `-Eval -EvalBaseUrl
<url> -EvalModel <model>` for the evaluation; the API key is asked for and never shown or saved).
It writes `verify-results\<time>\summary.md` to paste back.

- Decisions: [docs/adr/](docs/adr/)
- Engineering rules: [AGENTS.md](AGENTS.md)

Rocky listens on 127.0.0.1 only, keeps all data on your machine, and sends no telemetry.
