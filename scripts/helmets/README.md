# Team helmets

One master image → 32 teams × left/right × named/plain = 128 helmets.

```
npm run gen:helmets
```

| File | What it is |
| --- | --- |
| `source/helmet-ai.jpg` | The AI-generated art (Gemini), left-facing, in placeholder colors |
| `clean-template.mjs` | Strips the fake checkerboard background → `template.png` |
| `template.png` | Cleaned art with real transparency (the generator's input) |
| `template.json` | Where the lettering and the number go, as fractions of the image |
| `teams.json` | Per-team colors, city, nickname |
| `gen-helmets.mjs` | Recolors the template per team and writes everything below |
| `png.mjs` | PNG/JPEG decode and PNG encode, no image library needed |
| `fonts/` | Graduate (helmet lettering) and Jersey 15 (player numbers), both SIL OFL |

Output (committed):

- `public/helmets/png/{ABBR}-{left|right}[-plain].png`: 256×256, transparent
- `public/helmets/manifest.json`: colors, file paths, and where to draw the number
- `public/fonts/jersey-15.ttf`: the number font

`scripts/helmets/preview/sheet.png` (ignored) shows every helmet with sample numbers. Check it after any change.

## Variants

- **named**: abbreviation + nickname ("KC / CHIEFS").
- **plain**: abbreviation only. Use it in mark-free mode, since team nicknames are trademarks and colors aren't (see `packages/core/src/data/teamColors.ts`).

## Drawing the player's number

The number is not baked in. The app draws it on top using `manifest.number`. All sizes are fractions of the image, so they work at any display size:

```
size     = number.fontSize × imageHeight              (Jersey 15)
anchor   = number.anchor[left|right]                   x, y = baseline corner
align    = anchor.align ("right" for left-facing, "left" for right-facing)
draw 1:  stroke number.outlineColor, width number.outlineWidth × size
draw 2:  fill team.number.fill, stroke team.number.stroke, width number.strokeWidth × size
```

Left-facing helmets put the number at the bottom right, and right-facing ones at the bottom left. Either way it sits on the back of the helmet, away from the face mask.

## Swapping in new art

1. Generate a **left-facing**, flat, side-profile helmet with no text or logos, using exactly these colors: shell `#FF00FF`, stripe `#00FFFF`, face mask `#FFFF00`, black outline and pads, white highlights. A checkerboard "transparent" background is fine.
2. Run `node scripts/helmets/clean-template.mjs path/to/image` (or replace `source/helmet-ai.jpg`).
3. If the shell's open area moved, adjust `template.json`.
4. Run `npm run gen:helmets` and check the sheet.
