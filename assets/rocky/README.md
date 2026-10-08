# Rocky visual source

Editable Rocky product marks, authored for this repository:

- `mark.svg`: the app icon, after Roko: a faceted rock body, a dark visor with two glowing
  amber eyes and four rock feet on a dark rounded square. Used beside the app name
  (`src/web/App.tsx`) and at the top of both READMEs.
- `favicon.svg`: the same head without the feet, larger, so it still reads at 16 px in a
  browser tab (`src/web/index.html`).

`vite.config.ts` serves `assets/` as Vite's public directory, so these files are available
at `/rocky/…` and are copied into the production build. The mascot artwork lives in
[assets/roko](../roko/README.md) under separate terms.

No external image, font, movie still or raster texture is embedded in these SVG files.
Their source is Apache-2.0; that license does not settle name, character inspiration or
trademark rights. `asset-manifest.json` records the SHA-256 of each file and that this
rights review is still pending.
