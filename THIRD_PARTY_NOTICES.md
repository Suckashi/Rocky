# Third-party notices

Rocky source is Apache-2.0 (see `LICENSE`). Roko artwork is excluded; see `NOTICE` and `assets/roko/README.md`.

Dependencies keep their own licenses; exact versions are pinned in `package-lock.json`.

## OpenDots

Rocky's UI layout and server patterns follow OpenDots at
https://github.com/CopilotKit/OpenDots/tree/c2569bb6a13a22e565cf3eb791c62267d06babb1 (MIT).
When code, structure or values are adapted, the adapted files are listed here.

Adapted files:

- `src/server/http/security.ts`: the API guard (Host, Origin, `sec-fetch-site`, constant-time token
  check, JSON-only writes) from `src/server/app.ts`; Rocky always requires the token.
- `src/server/shutdown.ts`: the deadline-bound shutdown from `src/server/shutdown.ts`.
- `src/web/components/Chat.tsx`: the conversation flow (`useAgent` with a per-thread agent,
  `connectAgent` for history, `addMessage` + `runAgent`, run-error subscription) from `src/client/Chat.tsx`.
- `src/web/components/ThreadList.tsx`: the `useThreads` conversation list from `src/client/ThreadList.tsx`.
- Layout (rail, conversation list, chat, right panel) follows `src/client/App.tsx` and `style.css`;
  colors and spacing come from the owner's Rocky design, not from OpenDots' CSS.

Copyright (c) Atai Barkai

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## CopilotKit

`src/server/agent/runner.ts` follows the run lifecycle of `InMemoryAgentRunner` in
`@copilotkit/runtime` 1.77.0 (MIT, Copyright (c) CopilotKit), storing history in SQLite instead of memory.

## Noto Sans TC (test fixture)

`tests/fixtures/fonts/noto-tc-subset.ttf` is a subset of Noto Sans TC Regular (only the glyphs
the S4 tests draw), built with fontTools from the `@fontsource/noto-sans-tc` 5.3.0 package.
SIL Open Font License 1.1; the full license text is in `tests/fixtures/fonts/OFL-NotoSansTC.txt`.
