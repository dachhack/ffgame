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

- **PNG with transparent background.** No scene, no ground shadow, no text.
- **Bases:** 1024 × 1024, the character centered, feet near the bottom
  edge, head near the top, facing the viewer, arms visible at the sides so
  a hand sticker has somewhere to land. Same pose across all four.
- **Stickers:** 512 × 512, the object alone, filling about 85% of the frame.
- Keep each file under ~150 KB (they ship as static assets).
- Must read against both a dark teal and a cream background.

## Files (12)

Base bodies, one per league type. Four distinct characters in one style,
the way a city's four mascots share a sport but not a face:

- `base-redraft.png` — **Rook.** A round, fuzzy, bright green rookie: wide
  eyes, eager grin, a number 1 on the chest, bouncing on its toes.
- `base-keeper.png` — **Vault.** A squat blue mascot whose torso is a small
  safe with a dial, hugging two player cards to its chest, protective.
- `base-dynasty.png` — **Duke.** A tall regal purple mascot with a long
  fur collar and an upturned chin, one paw on its hip, built for a crown.
- `base-contract_dynasty.png` — **Suits.** An orange mascot in a tiny navy
  blazer, tie loosened, briefcase in one paw, reading glasses on its head.

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

Use the same block for every file, and hand the first finished base back
in as a reference image so the other three match it. Nothing here may
reference a real team, a real mascot, or a named game character.
