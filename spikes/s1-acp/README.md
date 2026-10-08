# S1 spike: OpenCode over ACP

Proves the external-agent path before M3: Rocky starts `opencode acp`, answers every
permission request itself (only `allow_once` / `reject_once`), and verifies the worktree.

- `opencode.ts`: finds the real OpenCode executable (never the `.cmd` shim), starts it
  with argv and an environment allowlist, and passes Rocky's config inline
  (`OPENCODE_CONFIG_CONTENT`) with network features and project config switched off.
- `client.ts`: the ACP client. Each request is hashed (kind, diff or command, cwd);
  `cancel` answers open requests with `cancelled`; `close` ends stdin first.
- `worktree.ts`: every changed file must equal content Rocky approved.
- `host-log.ts`: a CONNECT proxy on 127.0.0.1 that records the hosts OpenCode reaches.
- `scenario.ts`: approve, reject, command, cancel and resume against a scripted model.
  Covered by `tests/spikes/s1-acp.test.ts`, which runs only where OpenCode is installed
  (skipped otherwise). Set `ROCKY_REQUIRE_OPENCODE=1` to make a missing
  OpenCode fail instead of skip.

## Run against a real model on Windows

```powershell
npm install -g opencode-ai@1.18.34
$env:ROCKY_S1_BASE_URL = "https://api.commandcode.ai/provider/v1"
$env:ROCKY_S1_API_KEY = $env:COMMANDCODE_API_KEY
$env:ROCKY_S1_MODEL = "deepseek/deepseek-v4-flash"
node spikes/s1-acp/live.ts
```

It creates a small repository with a failing test, asks OpenCode to fix it and run the
tests, and asks `Allow once? [y/N]` for every edit and command. The report at the end
lists the answers, changed files, whether the changes match the approved diffs, Rocky's
own test run, token usage and the hosts OpenCode contacted. Paste it back into the session.
Set `ROCKY_S1_AUTO_APPROVE=1` to approve automatically, and `ROCKY_OPENCODE_BIN` if
OpenCode is installed somewhere other than `npm i -g`.

Findings are recorded in `docs/adr/0003-opencode-acp-spike.md`.
