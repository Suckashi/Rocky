# Rocky visual source

Editable Rocky product marks, authored for this repository:

- `mark.svg`: the mark beside the app name (`src/web/App.tsx`).
- `favicon.svg`: the browser tab icon (`src/web/index.html`).

`vite.config.ts` serves `assets/` as Vite's public directory, so these files are available
at `/rocky/…` and are copied into the production build. The mascot artwork lives in
[assets/roko](../roko/README.md) under separate terms.

No external image, font, movie still or raster texture is embedded in these SVG files.
Their source is Apache-2.0; that license does not settle name, character inspiration or
trademark rights. `asset-manifest.json` records the SHA-256 of each file and that this
rights review is still pending.
