# S3 spike: install without a compiler

Proves that the planned dependency tree installs with `npm ci` on Windows without a C/C++
toolchain or Python, sends no telemetry, and works on the platform.

`package.json` here is the current dependencies plus every library planned for M1–M4
(Hono, React, Vite, CopilotKit, Tiptap, the document libraries, `playwright-core`, the MCP
SDK, `@langchain/ollama`). It is a separate package so those libraries are not added to
Rocky before they are used. It is not part of CI (too heavy for every push).

- `install-check.ts`: deletes `node_modules`, runs `npm ci` through a host-logging proxy
  (S1's `host-log.ts`) and fails on an install script outside the allowlist, any
  `binding.gyp`, any addon built into `build/Release`, node-gyp / prebuild / cmake output,
  or a host other than `registry.npmjs.org`. `ROCKY_S3_FRESH_CACHE=1` uses an empty npm cache.
- `smoke.ts`: loads every package and does one real thing with each: `node:sqlite` FTS5
  trigram search in Chinese, a Vite build, Hono on 127.0.0.1, docx → mammoth, exceljs,
  pptxgenjs, pdf-lib → unpdf, and HTML → PDF through the system Edge with `playwright-core`.

## Run on Windows

```powershell
cd spikes\s3-install
$env:ROCKY_S3_FRESH_CACHE = "1"
node install-check.ts
node smoke.ts
```

Paste both reports back into the session. Do not run `npm install` here first:
`install-check.ts` does the install itself. Visual Studio Build Tools and Python do not need
to be installed; if they are, the check still fails on any sign that they were used.

Findings are recorded in `docs/adr/0004-install-without-compiler.md`.
