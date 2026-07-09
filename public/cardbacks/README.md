# Card back art

Drop card-back images here and they get wired into the deck picker
(⚙ → CARD DECK).

## Spec
- **Aspect ratio:** 2.5 : 3.5 (standard playing card). 750 × 1050 px is ideal.
- **Full-bleed:** the image *is* the whole card back (the app rounds the
  corners and draws a border), so bleed the art to the edges.
- **No watermarks / logos / gutters** — just the card face.
- **Format:** `.jpg` (preferred, ~80–90 quality) or `.png`. Keep each file
  under ~200 KB if you can; they ship as static assets.
- **Naming:** lowercase, hyphenated, e.g. `playbook.jpg`, `heritage.jpg`.
  The filename (minus extension) becomes the deck id.

Once the files are here, ping me and I'll compress them if needed, add each
as a deck skin (felt tint + picker swatch), and pick a default.
