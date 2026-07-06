# Fantasy avatar batch generator

Sends every player headshot (from `src/data/headshots.ts`, ~600 players) to
Gemini's image model and saves fantasy-mashup portraits — dragonborn, orc,
elf, etc. — one PNG per player per style.

## Setup

Get an API key at https://aistudio.google.com/apikey and pass it via the
environment. **Run this locally** — it spends real API money (roughly
$0.04/image with `gemini-2.5-flash-image`, so a full 600-player style pass
is ~$25... and more if you re-roll).

```sh
# Try 5 players first to tune the prompt
GEMINI_API_KEY=... node scripts/fantasy-avatars/generate.mjs --style dragonborn --limit 5

# Specific players
GEMINI_API_KEY=... node scripts/fantasy-avatars/generate.mjs --style orc \
  --players marvin-harrison,jamarr-chase,saquon-barkley

# Custom style text (folder still named by --style)
GEMINI_API_KEY=... node scripts/fantasy-avatars/generate.mjs \
  --style noir --prompt "as a 1920s noir detective, sepia tones"

# See the queue without calling the API
node scripts/fantasy-avatars/generate.mjs --style elf --dry-run
```

Outputs land at `scripts/fantasy-avatars/out/<style>/<slug>.png` **with
transparent backgrounds**: Gemini can't emit an alpha channel, so the prompt
demands a flat magenta ground and the script chroma-keys it out (flood fill
from the borders, so magenta accents inside the character survive). If Gemini
ignores the magenta ask for an image, it's saved opaque and flagged in the
manifest. `--keep-bg` skips keying; `--key-only file.png` re-keys an existing
magenta-background PNG without touching the API. Requires `npm install`
(pngjs).

The run is resumable: already-generated players are skipped (use `--force`
to redo). `out/<style>/manifest.json` records `ok` / `refused` / `error` per
player — Gemini sometimes declines edits of identifiable people, and
refusals would otherwise just look like missing files.

## Grid mode (~N× cheaper)

`--grid 9` packs 9 players into one contact-sheet image per API call and
slices the result back apart — one output image bills the same as one
portrait, so the roster drops from ~$25 to ~$3 (or goes 9× further on
free-tier quota). The trade-off is detail: Gemini outputs ~1024px total, so
a 3×3 cell is ~340px and a 5×5 cell only ~200px, and identity drift goes up
with cell count. Preview what would be sent (and the slice/key round trip)
without spending anything:

```sh
node scripts/fantasy-avatars/generate.mjs --style dragonborn --grid 9 --limit 9 --grid-preview
```

Style presets: dragonborn, orc, elf, dwarf, wizard, knight, vampire,
werewolf, robot, zombie. Flags: `--style`, `--prompt`, `--players`,
`--limit`, `--concurrency` (default 3), `--model`, `--out`, `--grid`,
`--grid-preview`, `--keep-bg`, `--key-only`, `--force`, `--dry-run`.

## Likeness caveat (read before shipping these)

These images are still derived from a real athlete's face, so the **right of
publicity** applies regardless of the fantasy makeover — the copyright
question and the likeness question are separate, and the likeness one is the
real risk for commercial use. Also note AI-generated output likely has no
copyright protection of its own (no human authorship), so you can't stop
others from copying it either. Fine for personal experimentation; talk to a
lawyer before putting player-derived art in the shipped product. Archetype
avatars not derived from headshots are the safe alternative.
