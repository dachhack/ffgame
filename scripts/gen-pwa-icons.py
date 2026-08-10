#!/usr/bin/env python3
"""Bake the PWA / home-screen icon set from the square brand mark.

Run only when the brand mark changes — the outputs are committed, so a normal
build (and CI) never needs Pillow:

    pip install pillow && python3 scripts/gen-pwa-icons.py

Source is `public/brand/ig-profile.png` (1000x1000, the Instagram profile art):
mascot on top, DRIP FANTASY wordmark below. The wordmark is unreadable at 192px,
so every icon here crops to the MASCOT only, keeping the source's own dark teal
backdrop — which also makes the files opaque, as iOS requires (a home-screen icon
with alpha gets composited onto black).

Two treatments, because the platforms mask differently:
  * FULL — the widest crop that clears the wordmark. Used for the `any` icons and
    Apple's touch icon, which are drawn full-bleed (iOS just rounds the corners).
  * MASKABLE — the same crop inset to ~73% of the frame so it survives Android's
    circle mask, over a blurred blow-up of itself. The blur is what keeps the
    inset from showing a seam: the backdrop is near-flat dark teal, so a blurred
    copy of it is indistinguishable from more backdrop, and it beats a flat fill
    (which clashes with the source's gradient and diagonal texture).
"""
from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'public/brand/ig-profile.png'
OUT = ROOT / 'public/icons/pwa'

# Mascot bounding box in the 1000x1000 source, measured with a brightness mask
# over the top 64% (the region above the wordmark). Re-measure if the art changes.
MASCOT = (242, 86, 758, 638)
# The wordmark starts just under the mascot; crops must stop above it.
WORDMARK_TOP = 650
# Share of the maskable frame the artwork may fill. The spec's safe zone is the
# middle 80%; 88% of that leaves the drips a little room before the circle bites.
MASKABLE_FILL = 0.88
FEATHER = 26  # px of soft edge on the inset tile, at 512 — hides the composite


def full_crop() -> Image.Image:
    """The largest square above the wordmark, centred on the mascot."""
    x0, _, x1, _ = MASCOT
    im = Image.open(SRC).convert('RGB')
    w, _ = im.size
    side = WORDMARK_TOP
    left = min(max((x0 + x1) / 2 - side / 2, 0), w - side)
    return im.crop((round(left), 0, round(left + side), side))


def maskable(base: Image.Image, size: int) -> Image.Image:
    """`base`, inset over a blurred blow-up of itself."""
    bg = base.resize((size, size), Image.LANCZOS).filter(ImageFilter.GaussianBlur(size / 8))
    inner = round(size * MASKABLE_FILL)
    tile = base.resize((inner, inner), Image.LANCZOS)
    # Feathered alpha so the tile dissolves into the blur instead of ending on a line.
    mask = Image.new('L', (inner, inner), 0)
    ImageDraw.Draw(mask).rectangle((FEATHER, FEATHER, inner - 1 - FEATHER, inner - 1 - FEATHER), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(FEATHER / 2))
    off = (size - inner) // 2
    bg.paste(tile, (off, off), mask)
    return bg


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    base = full_crop()
    for img, name in (
        (base.resize((192, 192), Image.LANCZOS), 'icon-192.png'),
        (base.resize((512, 512), Image.LANCZOS), 'icon-512.png'),
        (base.resize((180, 180), Image.LANCZOS), 'apple-touch-180.png'),
        (maskable(base, 512), 'maskable-512.png'),
    ):
        img.save(OUT / name, optimize=True)
        print(f'  {name}  {img.size[0]}x{img.size[1]}')


if __name__ == '__main__':
    main()
