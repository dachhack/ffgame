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
- `packages/core/src/data/helmetSpec.ts` (`gen-digits.mjs`, run by `gen:helmets`): the number's size, colours and anchor from the manifest, and Jersey 15's digits 0–9 as SVG paths. The apps draw the number from these paths (helmet mode, `data/helmets.ts`), so the phone needs no font loader.

`scripts/helmets/preview/sheet.png` (ignored) shows every helmet with sample numbers. Check it after any change.

## AI helmet art (named helmets)

The named helmets use AI-drawn art with the lettering painted in. The template above is only a fallback.

```
npm run import:helmets   # source/ → ai/ (ignored), check preview/ai-sheet.png
npm run gen:helmets      # ai/ + template → public/helmets/
```

| File | What it is |
| --- | --- |
| `source/ai-left/h1–h8.jpg` | Gemini sheets, four left-facing helmets each, in the team order in `ai-helmets.json` |
| `source/ai-right/` | Right-facing helmets (h1–h8 here are ChatGPT redraws of the left sheets): `{ABBR}.png` for one helmet, or `hN.png` for a whole sheet in `hN`'s team order |
| `ai-helmets.json` | Sheet → team mapping, and `mirrorOk`: teams whose right-facing helmet can be made by mirroring |
| `import-sheets.mjs` | Cuts helmets out, removes the white background, frames them like `template.png` |

Where each right-facing helmet comes from, in order:

1. `source/ai-right/{ABBR}.*`
2. `source/ai-right/hN.*`
3. Mirroring, for `mirrorOk` teams only. The script lifts the lettering off, paints the shell back, mirrors the helmet and puts the lettering back unmirrored. This breaks on dark, patterned or low-contrast shells, so only teams that came out clean are listed.
4. Otherwise the template helmet, with a warning from `gen-helmets`.

Once a team's AI right-facing helmet is in `source/ai-right/`, it wins over mirroring automatically.

Prompt for right-facing sheets (works in ChatGPT and Gemini):

> Redraw this exact image with every helmet facing RIGHT (face mask on the right). Keep each helmet's colors, stripes, face mask, shading and lettering identical, and keep all text reading normally left to right, not mirrored. Same layout, same size, plain white background.

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
