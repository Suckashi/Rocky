# Rocky

A single-user AI engineering partner that runs only on your own computer (Windows first).
Rocky chats, works in your project folders, handles documents, and delegates heavy coding
to external coding agents over ACP. Roko, our mascot, keeps you company.

**Status: rebuild in progress (M1).** You can chat with Roko through a model you choose.
Working in project folders, approvals and delegation come in later milestones.
The previous Rocky lives on `main`.

## Start

You need [Node.js 24](https://nodejs.org/) and Git.

```powershell
git clone -b claude/rocky-rebuild https://github.com/Suckashi/Rocky.git
cd Rocky
powershell -ExecutionPolicy Bypass -File .\Start-Rocky.ps1
```

The first run installs dependencies with `npm ci` (no compiler needed). Rocky then opens
your browser with a one-time login link. Run the launcher again to reopen Rocky while it is
running. On other systems use `npm ci` and `npm start`.

Data lives in `%LOCALAPPDATA%\Rocky` (Windows) or `~/.local/share/rocky`.

## Develop

`npm run check` runs type checks, lint, formatting, the i18n checks and the tests.
`npm run test:e2e` drives the UI in a real browser against a scripted model
(the system Edge, or `ROCKY_E2E_BROWSER`).

- Product: [docs/rebuild/product.md](docs/rebuild/product.md)
- Architecture: [docs/rebuild/architecture.md](docs/rebuild/architecture.md)
- Approvals: [docs/rebuild/approvals.md](docs/rebuild/approvals.md)
- Plan: [docs/rebuild/plan.md](docs/rebuild/plan.md)
- Decisions: [docs/adr/](docs/adr/)
- Engineering rules: [AGENTS.md](AGENTS.md)

Rocky listens on 127.0.0.1 only, keeps all data on your machine, and sends no telemetry.
