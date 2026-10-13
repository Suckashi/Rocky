# Roko artwork

Roko is Rocky's assistant mascot. Imported unchanged from the owner's existing
Roko integration pack on 2026-10-04; original filename `spritesheet-extended.png`.
The source directory was not modified. The manifest retains the source grid and
used columns; only its runtime image filename changes.

- PNG: 1536 × 2288 RGBA, 3,057,640 bytes.
- SHA-256: `0d47eb7f7495849818b8285fee2df7722ba76a8e8f22145cb147817516cf0ef3`.
- One runtime atlas, shared decoded image, fixed 192 × 208 cells, 8 FPS.
- Timing and state mapping are Rocky integration decisions, not exported platform timing.

On 2026-10-04 the repository owner identified the artwork as **GPT-generated**,
with inspiration from _Project Hail Mary_ (《極限返航》), and authorized its inclusion
in the public `Suckashi/Rocky` repository. This is an owner-provided source statement,
not a claim of official affiliation or third-party rights clearance.

**The artwork is excluded from the repository's Apache-2.0 code license.** No
separate artwork reuse license has been specified. Ask the owner before reusing
or redistributing the artwork; do not infer an MIT/Apache grant from the code license.
No trademark or character-rights clearance is asserted. The manifest's historical
verification flag describes the import pack, not current Rocky test results.
The UI uses it in `src/web/components/Roko.tsx`.

## Runtime copies (`rows/roko-row-<n>.webp`)

On 2026-10-13 the owner approved lossless WebP copies for the UI, so pages load less
(ADR 0038). The PNG above stays unchanged as the source of record and is not loaded by the UI.

- One file per sprite row (`n` = 0–10, each 1536 × 208 RGBA), so the first screen only waits
  for the row it shows (the waving row is 113,338 bytes; all eleven are 2,146,136 bytes).
- Made from `roko-spritesheet.png` with Pillow: crop row `n` (`y = n × 208`), then save with
  `lossless=True, exact=True, method=6`.
- Checked after encoding: every RGBA pixel of each row equals the PNG's, including fully
  transparent ones. `sha256sum assets/roko/rows/*.webp` lists the current hashes.
- The same rights note applies: it is the owner's artwork, not covered by Apache-2.0.

## Face centres (`roko-faces.json`)

The centre of Roko's visor in each 192 × 208 cell, measured from `roko-spritesheet.png` with
Pillow and NumPy (the bounding box of opaque, near-black visor pixels). The UI crops its
small round face avatar around these points, so the face stays in frame while Roko jumps,
leans or runs. It is measured data about the artwork, not a change to it.

