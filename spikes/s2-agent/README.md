# S2 spike: Deep Agents in-process

Proves the agent path before M1: Deep Agents (in the Rocky process) → real `ChatOpenAI`
client → action gate middleware → AG-UI 1.0 events.

- `scenario.ts`: scripted run against a fake OpenAI-compatible server on 127.0.0.1.
  Covered by `tests/spikes/s2-agent.test.ts`, so CI runs it on Windows and Ubuntu.
- `live.ts`: the same wiring against a real model. It needs a key and network, so it is
  never part of `npm test`.

## Run against an OpenAI-compatible endpoint (Command Code)

```powershell
$env:ROCKY_S2_BASE_URL = "https://api.commandcode.ai/provider/v1"
$env:ROCKY_S2_API_KEY = $env:COMMANDCODE_API_KEY
$env:ROCKY_S2_MODEL = "deepseek/deepseek-v4-flash"   # cheap and calls tools correctly
node spikes/s2-agent/live.ts
```

It asks `Allow? [y/N]` before every write and prints a report at the end (gate decisions,
tool calls, token usage with cache read/write, hosts contacted, files written).

| Variable                | Meaning                                                                          |
| ----------------------- | -------------------------------------------------------------------------------- |
| `ROCKY_S2_BASE_URL`     | OpenAI-compatible URL ending in `/v1` (default: Ollama on 127.0.0.1)             |
| `ROCKY_S2_MODEL`        | Model id, for example `deepseek/deepseek-v4-flash`                               |
| `ROCKY_S2_API_KEY`      | Only for endpoints that need one                                                 |
| `ROCKY_S2_AUTO_APPROVE` | Unset: ask. `1`: allow everything. `reject-first`: reject the first request only |

Behind an HTTPS proxy (for example a cloud container), also set `NODE_USE_ENV_PROXY=1`:
Node's built-in fetch ignores `HTTPS_PROXY` otherwise.

## Optional: Ollama

```powershell
ollama pull qwen3-coder:30b        # or any tool-calling model you already have
$env:ROCKY_S2_MODEL = "qwen3-coder:30b"   # base URL defaults to http://127.0.0.1:11434/v1
node spikes/s2-agent/live.ts
```

Findings are recorded in `docs/adr/0001-agent-runtime-spike.md`.
