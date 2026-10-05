# S2 spike: Deep Agents in-process

Proves the agent path before M1: Deep Agents (in the Rocky process) → real `ChatOpenAI`
client → action gate middleware → AG-UI 1.0 events.

- `scenario.ts`: scripted run against a fake OpenAI-compatible server on 127.0.0.1.
  Covered by `tests/spikes/s2-agent.test.ts`, so CI runs it on Windows and Ubuntu.
- `live.ts`: the same wiring against a real model. Run it on the owner's Windows PC:

```powershell
ollama pull qwen3-coder:30b        # or any tool-calling model you already have
$env:ROCKY_S2_MODEL = "qwen3-coder:30b"
node spikes/s2-agent/live.ts
```

It asks `Allow? [y/N]` before every write and prints a report at the end
(gate decisions, hosts contacted, files written). Paste that report back into the session.
For another OpenAI-compatible endpoint, also set `ROCKY_S2_BASE_URL` and `ROCKY_S2_API_KEY`.

Findings are recorded in `docs/adr/0001-agent-runtime-spike.md`.
