# Third-party notices

Original Rocky source is Apache-2.0. No Apsis code or upstream brand assets are copied. OpenDots presentation CSS is adapted under MIT as listed below.

Dependencies and exact versions/licenses are inventoried in docs/implementation/dependency-licenses.json and package-lock.json. npm-installed packages retain their upstream license and copyright files. Omitted optional packages are not approved for inclusion in a release.

- CopilotKit / AG-UI: MIT. Rocky uses OSS gateway APIs only.
- Deep Agents / LangChain / LangGraph: MIT.
- Hono / React / Vite / TypeScript / Rollup WASM: see exact package licenses in the inventory (MIT or Apache-2.0).
- Promptfoo: MIT; its optional commercial/provider/image integrations are omitted.
- SQLite: public domain; node:sqlite is built into Node. better-sqlite3 is MIT.
- khroma 2.1.0: MIT, copyright 2019-present Fabio Spampinato, Andrew Maney.
- xmlhttprequest-ssl 2.1.2: MIT, copyright 2010 passive.ly LLC.
- url-template 2.0.8: BSD-3-Clause, copyright 2012-2014 Bram Stein.
- parse5 7.3.0: MIT, copyright 2013-2019 Ivan Nikulin. Used unmodified as the daemon-side HTML parser for restricted artifact previews; its installed package retains the full MIT license.
- caniuse-lite 1.0.30001814: browser compatibility data, CC-BY-4.0; upstream https://github.com/browserslist/caniuse-lite, derived from https://caniuse.com. Data is unmodified; its package includes the full attribution license.

This source-stage inventory does not replace the P8 complete bundled/distribution notice review. No film imagery, upstream avatars, remote fonts or generated brand assets are included.

## OpenDots presentation adaptation

js-tiktoken 1.0.21 is a pinned MIT dependency used unmodified with its bundled cl100k_base ranks for daemon-side Memory context budgeting. Source/license: https://github.com/dqbd/tiktoken and https://raw.githubusercontent.com/dqbd/tiktoken/main/LICENSE. Copyright (c) 2022 OpenAI, Shantanu Jain. The MIT permission and warranty text below also applies to this dependency. No CDN loading or Python/WASM fallback is used.

Source: https://github.com/CopilotKit/OpenDots/tree/c2569bb6a13a22e565cf3eb791c62267d06babb1

Upstream src/client/style.css and src/client/editor.css effective compact chrome rules are adapted into apps/web/src/style.css and apps/web/src/tokens.css: selectors reduced to Rocky presentation, semantic theme tokens, mobile/focus changes. apps/web/src/chrome.tsx and main.tsx are Rocky implementations aligned to App/Chat/ChatTranscript/PageReviewCard structure, with no upstream API, persistence or polling. ResultPane presentation from the same source commit also informs chrome.tsx and style.css: 64px top offset, clamp(390px,40vw,660px) desktop width, 1100px overlay and 700px full-width breakpoints; Rocky adds immutable artifact cards, explicit downloads and keyboard/focus handling. PageDocument/editor.css source-mode metrics additionally inform document-editor.tsx/style.css (420px minimum source height,18px padding,13px/1.8 monospace and40px/32px title). Rocky retains explicit revision CAS, source-only editing, semantic theme tokens and visible keyboard focus rather than upstream autosave/rich-editor state. No upstream images, logo or mascot are used.

Copyright (c) Atai Barkai

The conversation delivery card in work-artifacts.tsx/style.css additionally adapts PageReviewCard presentation at this commit:16px radius,14px/18px header/footer padding,18px/22px body padding,20px title and9px action radius. Rocky replaces review decisions with confirmed immutable-result open/download actions and uses its semantic theme tokens. No upstream persistence or API is imported.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## YAML parser

yaml 2.9.1 is pinned and used unmodified to parse Agent Skills frontmatter as data. Source: https://github.com/eemeli/yaml. License: ISC. The installed package retains this notice:

Copyright Eemeli Aro <eemeli@gmail.com>

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
