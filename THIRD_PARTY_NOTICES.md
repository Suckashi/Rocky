# Third-party notices

Rocky source is Apache-2.0 (see `LICENSE`). Roko artwork is excluded; see `NOTICE` and `assets/roko/README.md`.

Dependencies keep their own licenses; exact versions are pinned in `package-lock.json`.

## OpenDots

Rocky's UI layout and server patterns follow OpenDots at
https://github.com/CopilotKit/OpenDots/tree/c2569bb6a13a22e565cf3eb791c62267d06babb1 (MIT).
When code, structure or values are adapted, the adapted files are listed here.

Adapted files: none yet.

Copyright (c) Atai Barkai

The conversation delivery card in work-artifacts.tsx/style.css additionally adapts PageReviewCard presentation at this commit:16px radius,14px/18px header/footer padding,18px/22px body padding,20px title and9px action radius. Rocky replaces review decisions with confirmed immutable-result open/download actions and uses its semantic theme tokens. No upstream persistence or API is imported.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Noto Sans TC (test fixture)

`tests/fixtures/fonts/noto-tc-subset.ttf` is a subset of Noto Sans TC Regular (only the glyphs
the S4 tests draw), built with fontTools from the `@fontsource/noto-sans-tc` 5.3.0 package.
SIL Open Font License 1.1; the full license text is in `tests/fixtures/fonts/OFL-NotoSansTC.txt`.
