# Roko artwork

Roko is Rocky's assistant mascot. Imported unchanged from the owner's existing
Roko integration pack on 2026-10-04; original filename `spritesheet-extended.png`.
The source directory was not modified. The manifest retains the source grid and
used columns; only its runtime image filename changes.

- PNG: 1536 × 2496 RGBA, 3,284,732 bytes (rows 0–10 as imported, row 11 added 2026-10-13).
- SHA-256: `c966b3bbd76b895cda108ca4cfe580f3f9569f907fd373ac6ba8f6db54563c29`. As imported (rows 0–10 only): 1536 × 2288,
  3,057,640 bytes, `0d47eb7f7495849818b8285fee2df7722ba76a8e8f22145cb147817516cf0ef3`.
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

- One file per sprite row (`n` = 0–11, each 1536 × 208 RGBA), so the first screen only waits
  for the row it shows (the waving row is 113,338 bytes; all eleven are 2,146,136 bytes).
- Made from `roko-spritesheet.png` with Pillow: crop row `n` (`y = n × 208`), then save with
  `lossless=True, exact=True, method=6`.
- Checked after encoding: every RGBA pixel of each row equals the PNG's, including fully
  transparent ones. `sha256sum assets/roko/rows/*.webp` lists the current hashes.
- The same rights note applies: it is the owner's artwork, not covered by Apache-2.0.

## Row 11: poses added 2026-10-13

The owner supplied four new poses (`source/roko-poses-2026-10.png`, kept as delivered) for
states the existing rows could not tell apart. They were placed into row 11, one pose per
cell (columns 4–7 are empty), without redrawing: each figure was cropped to its opaque
pixels, all four scaled by the same factor (0.330, Lanczos) so the widest fits 184 px and
the tallest 196 px, centred, and stood on y = 200 like the existing cells. With the owner's
approval (2026-10-13) the stone was then tone-matched to rows 0–10: the stone pixels (bright,
low-saturation; the dark visor, joints and amber glow are left out by a soft mask) were moved
in CIELAB to the old rows' stone mean and spread, which makes the new stone a little warmer and
pinker. Shapes and proportions are unchanged. Rows 0–10 of
the PNG are byte-for-byte the same pixels as before. `rows/roko-row-11.webp` (168,374 bytes)
was made and checked the same way as the other rows.

| Column | Manifest name  | Pose                                   | Used for                       |
| ------ | -------------- | -------------------------------------- | ------------------------------ |
| 0      | `reading-book` | reading an open book                   | reading or searching files     |
| 1      | `working`      | holding a glowing slate                | running a command, writing     |
| 2      | `raise-hand`   | one hand raised, an exclamation above  | waiting for the user to decide |
| 3      | `sitting`      | sitting, hands in lap                  | not used yet                   |

