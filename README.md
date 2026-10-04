# Rocky

A local AI engineering partner with conversations, controlled tools, and work you can inspect.

[繁體中文](README.zh-TW.md) · [User guide](docs/user-guide.en.md) · [Documentation](docs/README.md) · [Contributing](CONTRIBUTING.md)

Rocky keeps conversations, work records, approvals, documents, memory, and skills on your machine. You choose the model endpoint, MCP servers, and workspaces it can use. One Deep Agents runtime handles ordinary work, native child tasks, and evaluated Learning.

**Status: development preview (`0.1.0-dev.0`).** The main V1 paths are implemented, with Windows fixture and browser evidence. Cross-platform, security, and live-service acceptance remain open. See the [roadmap and known gaps](docs/ROADMAP.md). No stable release or hosted service is available.

## What you can do

- Chat with one persistent Rocky assistant and inspect background work, tool results, approvals, and stop requests.
- Connect your own model and MCP servers; grant explicit workspace access and review file or command effects.
- Create documents, inspect immutable revisions, attach text/images, and preview generated artifacts.
- Use scoped memory and versioned skills. Learning is off by default; candidates require evaluation and human publication.
- Configure routines and MCP follow-ups, inspect owned browser sessions, and back up Rocky's local data.

Native commands run with your operating-system permissions. Native execution is not a sandbox; container isolation has separate setup and verification requirements. Model requests and configured integrations may incur costs.

## Quick start

Prerequisites: **Node.js 24.12.0**, **npm 11.6.4**, and Git for contributing or using worktrees. Run these commands from the repository root after downloading or cloning the source:

```sh
npm ci
npm run build
npm run doctor
npm start
```

Open **http://127.0.0.1:3211**. On first launch, "Connect a model first" asks for a provider (Anthropic / OpenAI / Ollama / OpenAI-compatible), a model ID and an API key; the synthetic fixture is available to try the workflow first. Keys are stored in the daemon data directory as `secrets.env` (unencrypted, mode 0600) or come from environment variables (`npm run dev` reads a root `.env`; see [`.env.example`](.env.example)). Do not paste secrets into repository files. See the [user guide](docs/user-guide.en.md) for model setup, storage locations, and approvals.

Core installation and standard Learning fixtures use Node/npm only. An optional browser download is explicit:

```sh
npm run setup -- browser
```

Container engines are installed separately by the owner. Rocky does not install system services or silently switch isolated work to native execution.

## Development

```sh
npm ci
npm run dev
```

The development UI runs at **http://127.0.0.1:3210**, with the daemon on port 3211 and data in the ignored `.rocky-dev/` directory. Run the development and built applications separately because they share the daemon port.

For checks, debugging prerequisites, and test modes, use the [development guide](docs/development.md). To propose a change, start with [Contributing](CONTRIBUTING.md).

## Repository map

<details>
<summary>Source directories and responsibilities</summary>

| Path                                                 | Purpose                                                        |
| ---------------------------------------------------- | -------------------------------------------------------------- |
| [`apps/web/`](apps/web/)                             | React/Vite conversation UI and settings                        |
| [`apps/daemon/`](apps/daemon/)                       | Local API, persistence, approvals, and operation authority     |
| [`apps/agent-worker/`](apps/agent-worker/)           | Agent child process and daemon IPC                             |
| [`packages/agent-runtime/`](packages/agent-runtime/) | Shared Deep Agents assembly, model and tool adapters           |
| [`packages/contracts/`](packages/contracts/)         | Shared validated DTOs, events, and IPC contracts               |
| [`tests/`](tests/) / [`fixtures/`](fixtures/)        | Unit, integration, browser, and deterministic service fixtures |
| [`scripts/`](scripts/)                               | Development, verification, setup, and packaging commands       |
| [`docs/`](docs/README.md)                            | User guides, architecture, decisions, and verification records |
| [`specs/rocky/`](specs/rocky/README.md)              | Product contracts and the task/acceptance ledger               |
| [`assets/rocky/`](assets/rocky/README.md)            | Product marks, favicon, and provenance                         |
| [`assets/roko/`](assets/roko/README.md)              | Roko mascot atlas, animation manifest, and separate rights     |

See [architecture and file placement](docs/architecture.md) before adding a module. Runtime data, browser profiles, build output, and private diagnostics are excluded from Git.

</details>

## Contributing and support

Read [CONTRIBUTING.md](CONTRIBUTING.md) for the branch → pull request → CI workflow, [SUPPORT.md](SUPPORT.md) for bug reports, and [SECURITY.md](SECURITY.md) for private vulnerability reporting and known security limitations. Community participation follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## License and provenance

Original Rocky source is licensed under [Apache-2.0](LICENSE). Adapted OpenDots presentation code retains its MIT attribution in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [NOTICE](NOTICE). Rocky is an independent project with its own data and runtime, without affiliation implied by those references. Artwork provenance and pending name/character/trademark review are recorded in the [asset manifest](assets/rocky/asset-manifest.json).

The Roko mascot has [separate provenance and rights](assets/roko/README.md). The owner identifies it as GPT-generated artwork inspired by _Project Hail Mary_ and has authorized its inclusion in this public repository. The code license does not license the artwork, and no separate reuse license or official affiliation is asserted.
