# Mascot stickers

The landing's league builder dresses a mascot from the four answers a
commissioner gives (see `packages/core/src/data/mascot.ts`). Drop PNGs here
and the builder picks them up by filename; any file that is missing falls
back to an emoji at runtime, so the set can arrive piecemeal.

## How the layers work

The mascot is **one base body plus stickers placed by anchor**. Stickers are
separate files positioned by the app over a region of the body (neck, hand,
head, back), not pixel-registered overlays, so they do not have to line up
with any particular body. Draw each sticker alone on a transparent canvas,
filling the frame.

| Anchor | Region of the body it sits on | Stickers |
|---|---|---|
| `body` | the whole stage | the four base bodies |
| `neck` | upper chest, centered | `chain-drip`, `draft-snake` |
| `hand` | right side, mid-height | `finger-classic`, `draft-auction` |
| `head` | top, centered | `mode-golf`, `mode-vampire`, `mode-guillotine` |
| `back` | behind the body | `mode-vampire-cape` |

## Spec

- **WebP with transparent background** is what the app loads. Generate on plain white, key the white out afterwards, convert (`cwebp -q 82`, or Pillow). No scene, no ground shadow, no text.
- **Bases:** 1024 × 1024, the character centered, feet near the bottom
  edge, head near the top, facing the viewer, arms visible at the sides so
  a hand sticker has somewhere to land. Same pose across all four.
- **Stickers:** 512 × 512, the object alone, filling about 85% of the frame.
- Keep each file under ~150 KB (they ship as static assets).
- Must read against both a dark teal and a cream background.

## Files (28)

Three kinds, by what they touch. Deliver in any order: the app tries the
geared body first, then the plain body plus a head sticker, then a drawn
stand-in; a scene simply doesn't appear until its file exists.

### Scenes — one per league mode (4)

Wide, behind the mascot, cropped to a square on the stage with the bottom
fading out. Dark and moody so the character pops; no text, no logos.

- `bg-classic.webp` — a night stadium from the tunnel mouth, floodlights
  and haze, empty field, crowd as bokeh.
- `bg-golf.webp` — a manicured putting green at dawn, a flag in the hole,
  the fairway running to a pair of goalposts in the mist.
- `bg-vampire.webp` — a floodlit stadium at midnight under a full moon,
  bats over the goalposts, fog on the turf.
- `bg-guillotine.webp` — an empty stadium at night with a real wooden
  guillotine standing on the fifty-yard line, torches along the sideline,
  one just gone out.

### Geared bodies — each body wearing each mode (12)

Ask ChatGPT to EDIT the plain cutout (attach it): same character, same
pose, same lighting, plain white background, and add the gear. One line
each, times four bodies:

- `base-<type>-golf.webp` — a white golf visor and a putter held in the
  right hand, head-cover on the club.
- `base-<type>-vampire.webp` — vampire fangs in the grin, a high-collared
  black cloak with red lining over the shoulders, the eyes catching light.
- `base-<type>-guillotine.webp` — a black executioner's hood over the head
  (eyes visible through the holes) and a broad blade held in the right hand.

Where `<type>` is `redraft` (Rook), `keeper` (Vault), `dynasty` (Duke),
`contract_dynasty` (Suits).

### Body-agnostic stickers (4), and stand-ins (4)

The chain, finger, snake and gavel below overlay any body. The four
`mode-*` head stand-ins are drawn only while a geared body is missing.

## The plain bodies

Base bodies, one per league type — **DONE** (v0.420.0): the founder's four
renders, cut out and placed on the 1024 canvas. Kept here as the brief they
answered, and for whoever redraws them:

- `base-redraft.webp` — **Rook.** The orange shaggy one: wild fur, huge
  eyebrows, navy jersey with orange stripes. Fresh chaos, every August.
- `base-keeper.webp` — **Vault.** The stone golem: mossy rock arms, green
  jersey, built to hold on. Nothing gets pried loose.
- `base-dynasty.webp` — **Duke.** The horned bison: tan mane, navy jersey,
  the oldest head in the room. Plans in seasons, not weeks.
- `base-contract_dynasty.webp` — **Suits.** The blue bird: sharp beak, crisp
  white jersey, reads the fine print before it signs.

Bench (cut out, not wired — swap any in by renaming): the purple cyclops, the
blue mohawk, the purple ogre, the red cyclops.

Matchup style:

- `chain-drip.png` — a thick gold chain with a teal water-droplet pendant
  (the drip mark), glossy, meant to lie on a chest.
- `finger-classic.png` — a foam "#1" finger in teal, worn on a hand.

Draft type:

- `draft-snake.png` — a friendly cartoon snake coiled in an S, teal scales,
  meant to drape over shoulders.
- `draft-auction.png` — a wooden auctioneer's gavel, held upright.

League mode:

- `mode-golf.png` — a white golf visor with a small putter crossed behind
  it.
- `mode-vampire.png` — a pair of white fangs on a small grin with two
  magenta drops, plus a widow's-peak hairline; sits over the face.
- `mode-vampire-cape.png` — a high-collared black cape with a magenta
  lining, drawn as if worn from behind (this one sits BEHIND the body).
- `mode-guillotine.png` — a black executioner's hood with eye holes and a
  small axe leaning against it.

## Style block for a generator

> Single game mascot sticker for a fantasy football app: bold cartoon
> style with thick dark outlines, simple shapes, soft cel shading and a
> glossy highlight, palette of teal, mint, deep navy with one accent of
> magenta or gold. Transparent background, no text, no scene, no ground
> shadow. Square composition.

For the eight stickers, attach the cut-out body the sticker will sit on as a
reference image and ask for the object ALONE, in that render style — thick
fur, worn fabric, cinematic lighting — on a PLAIN WHITE background. Ask for
white, not transparent: generators fake transparency with a checkerboard,
and a flat white keys out cleanly. The alpha is done afterwards (the
checkerboard cut-out script in the session notes handles white too). Nothing here may
reference a real team, a real mascot, or a named game character.
