<div align="center">

<img src="assets/rocky/mark.svg" alt="Rocky" width="96" height="96" />

# Rocky

**A local-first AI engineering partner for one person and one computer.**

Rocky chats with you, works in your project folders, reads and writes Office documents,
and hands larger coding tasks to an external coding agent. Every change it makes goes
through one approval gate and can be undone.

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Node.js 24](https://img.shields.io/badge/node-24-339933.svg)
![Platform: Linux | Windows](https://img.shields.io/badge/platform-Linux%20%7C%20Windows-lightgrey.svg)
![Status: V1](https://img.shields.io/badge/status-V1-orange.svg)

**English** · [繁體中文](README.zh-TW.md)

[Features](#features) · [Quick start](#quick-start) · [How it works](#how-it-works) ·
[Security](#security-and-privacy) · [Development](#development) · [Decisions](docs/adr/)

</div>

---

## Features

- **Works in your project.** Search, read, edit files and run commands inside the folder you
  choose, then run your tests to check the result. Rocky follows the project's `AGENTS.md`.
- **Approvals that stay out of your way.** Three modes (always ask, ask when needed, hands
  off). Dangerous commands and actions outside the project always ask, in every mode.
  Approvals are bound to a hash of the exact content, so a changed command asks again.
- **Undo for every change.** Files are snapshotted before each write; each turn ends with a
  card listing what changed and a **Restore all** button. Every action leaves a receipt.
- **Plan review.** For larger or ambiguous tasks Rocky proposes 1–3 options before it starts.
- **Documents as first-class files.** PDF, Word, Excel, PowerPoint, Markdown and HTML are read
  as Markdown and created from Markdown; Word, Excel and PowerPoint are edited in place,
  keeping their formatting. Chinese text round-trips intact. A side panel previews the layout
  before and after a change.
- **Delegation to [OpenCode](https://opencode.ai).** Ask Rocky to hand off a coding task. It runs
  in the background in its own Git worktree; you approve its actions in Rocky; Rocky checks
  the diff and reruns the tests before you apply or discard the result.
- **Extensible.** Long-term memory in Markdown files, skills (`SKILL.md` folders) and MCP
  servers (stdio or HTTP), each tool with its own approval setting.
- **Bilingual interface.** Traditional Chinese (default) and English, with Roko the mascot
  showing what Rocky is doing.

## Quick start

### Requirements

- [Node.js 24](https://nodejs.org/) and [Git](https://git-scm.com/)
- A model: any OpenAI-compatible endpoint, OpenAI, or a local [Ollama](https://ollama.com/)
- Optional: OpenCode for delegation (`npm install -g opencode-ai`)

No C/C++ compiler, Python or Microsoft Office is needed.

### Install and start

```sh
git clone https://github.com/Suckashi/Rocky.git
cd Rocky
npm ci
npm start
```

Rocky prints a one-time login link and opens it in your browser.

On Windows you can instead run the launcher, which installs the pinned dependencies on first
run (`npm ci`), starts Rocky, and reopens the browser if Rocky is already running:

```powershell
powershell -ExecutionPolicy Bypass -File .\Start-Rocky.ps1
```

Rocky is verified on Linux and Windows; macOS is untested.

### First run

1. **Choose a model**: base URL, model name and API key. The key is stored only on your computer.
2. **Choose a project folder**: Rocky reads, edits and runs commands only there.
3. Start chatting. When Rocky needs you, the approval panel replaces the input box: press
   `1`–`4` to choose, `Enter` to confirm, `Esc` to reject.

## Configuration

Settings are made in the app. A few environment variables cover the rest:

| Variable             | Default                                          | Purpose                                       |
| -------------------- | ------------------------------------------------ | --------------------------------------------- |
| `ROCKY_PORT`         | `4317`                                           | Local port (always bound to `127.0.0.1`)      |
| `ROCKY_DATA_DIR`     | `%LOCALAPPDATA%\Rocky` or `~/.local/share/rocky` | Where Rocky keeps its data                    |
| `ROCKY_OPEN_BROWSER` | on                                               | Set to `0` to only print the login link       |
| `ROCKY_OPENCODE_BIN` | found on `PATH`                                  | Path to the OpenCode executable               |
| `ROCKY_PDF_FONT`     | a system CJK font                                | `.ttf` or `.ttc` font used when creating PDFs |

The data folder holds conversations, receipts and snapshots (`rocky.sqlite`, `snapshots/`),
memory (`memory/`), skills (`skills/`), job worktrees (`worktrees/`) and `secrets.json`
(model key and MCP settings). It is never inside a Git checkout.

## How it works

```
Browser (React, zh-TW / en)
   │  HTTP + SSE on 127.0.0.1, every request authenticated
   ▼
Rocky (one Node.js process)
 ├─ Agent        Deep Agents + LangChain, OpenAI-compatible models
 ├─ Action gate  policy → approval → single-use pass → execute → receipt
 ├─ Snapshots    content-addressed copies of every file before it changes
 ├─ Jobs         OpenCode over ACP, one Git worktree per job, queued
 ├─ MCP client   your stdio / HTTP servers
 ├─ Documents    pure Node libraries for pdf, docx, xlsx, pptx, md, html
 └─ Storage      node:sqlite + files in the data folder
```

Every tool call passes the **action gate** before it runs, including calls from OpenCode, MCP
and the Restore button. The functions that write files or run commands accept only a
single-use pass issued by the gate for that exact content, so nothing can skip the gate.
Commands run as argument lists, never through a shell. An action whose outcome is unknown
is never retried automatically.

The reasoning behind each design choice is recorded in the
[architecture decision records](docs/adr/).

## Security and privacy

- Rocky listens on `127.0.0.1` only. Do not expose it to a network.
- No telemetry. Third-party install and runtime telemetry is switched off.
- Rocky's own outbound requests go only to the model endpoints and MCP servers you configure.
  OpenCode, when you use it, also contacts the npm registry at startup and may download ripgrep.
- Rocky's access token never leaves its process: the browser signs in with a one-time code.
  The model API key is never shown in the interface; OpenCode receives it to call the model.
- Rocky has **no operating-system sandbox**: approved commands run with your user's
  permissions. Read what you approve.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Development

```sh
npm ci
npm run check        # type check, lint, formatting, i18n, unit and integration tests
npm run test:e2e     # browser end-to-end tests against a scripted model
npm run test:e2e:jobs  # the same for delegation (needs OpenCode)
npm run eval         # 31 real tasks against a live model, compared with evals/baseline.json
```

The end-to-end tests use the system Edge, or the browser set in `ROCKY_E2E_BROWSER`.
Run `npm run eval` after changing prompts, tools or the agent loop; models vary between runs,
so use `--repeat 3` before treating a drop as real.

There is no hosted CI. On Windows, `scripts/verify-windows.ps1` runs the install, all checks,
both browser tests and the launcher in one go and writes a summary to `verify-results\`.

Project layout:

```
src/server/   Node.js server: agent, action gate, jobs, documents, MCP, storage
src/web/      React interface and i18n catalogs (zh-TW, en)
tests/        unit and integration tests (Vitest)
scripts/      browser end-to-end tests, i18n check, Windows verification
evals/        evaluation tasks and baseline
docs/adr/     architecture decision records
```

## Project status

Rocky V1 is feature-complete. It is verified on Linux, and on Windows with
`scripts/verify-windows.ps1`; macOS is untested. There is no packaged release yet. Known limitations include:

- No operating-system sandbox; commands run with your permissions.
- Only OpenCode is supported for delegation.
- Layout previews are drawn by Rocky and can differ from how Office shows the file.
- Scanned (image-only) PDFs cannot be read.

## Contributing

Rocky is maintained by its owner for personal use. Before changing code, read [AGENTS.md](AGENTS.md): every user-facing string goes through the
i18n catalogs, checks must be reported honestly, and a change of approach gets a short ADR.

## License

Rocky's source code is licensed under the [Apache License 2.0](LICENSE).
The Roko mascot artwork in `assets/roko/` is **not** covered by that license; see
[NOTICE](NOTICE) and [assets/roko/README.md](assets/roko/README.md).
Third-party attributions are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
