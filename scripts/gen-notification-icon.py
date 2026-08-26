#!/usr/bin/env python3
"""Bake the notification SILHOUETTE — the droplet, white on transparent.

    python3 scripts/gen-notification-icon.py

Outputs (both committed, both the same 96x96 mask):
  * apps/mobile/assets/notification-icon.png — the app's Android small icon,
    wired through the expo-notifications plugin in apps/mobile/app.json.
  * public/icons/pwa/badge-96.png — the web push `badge` in public/sw.js.

── WHY THIS IS NOT ONE OF THE PWA ICONS ──────────────────────────────────────
Android's status-bar glyph keeps ONLY THE ALPHA CHANNEL. It throws the colours
away and tints the remaining shape itself, so a full-colour icon — whose alpha
is a solid opaque square — arrives as a solid block, and the system draws its
own default robot instead. That is exactly what both surfaces were doing: the
app declared no icon at all, and sw.js pointed `badge` at icon-192.png.

So this asset is a MASK, not a picture. Nothing here is worth painting in
colour, and anything with interior detail (the DF letters, the mascot) turns to
mush by 18px — which is the size that actually matters.

── WHY IT IS COMPUTED RATHER THAN RENDERED ───────────────────────────────────
Coverage is exact arithmetic, so we compute it instead of rasterising: headless
Chromium silently drops SVG and CSS transforms at a 96px window on this box
(measured — it returns a 2-pixel image), and Pillow is not installed, which is
also why scripts/gen-pwa-icons.py cannot be extended to cover this. Depending
on neither keeps the asset reproducible anywhere Python runs.

The droplet is the union of a circle and the triangle formed by the two TANGENT
lines from the apex to that circle. Tangency is the whole trick: a hand-placed
triangle leaves a visible kink where the straight edge meets the arc, and at
18px a kink is the only thing you can see.
"""
import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUTS = [
    ROOT / 'apps/mobile/assets/notification-icon.png',
    ROOT / 'public/icons/pwa/badge-96.png',
]

# Geometry in a 96-unit box. The shape spans y 8..88 and x 20..76, which leaves
# the padding Android expects inside the 24dp frame — the system does NOT inset
# for you, and a glyph drawn to the edges is a glyph that touches the clock.
SIZE = 96
CX, CY, R, APEX_Y = 48.0, 60.0, 28.0, 8.0
SS = 4  # samples per axis, so edges are anti-aliased rather than stepped


def tangent_points():
    """Where the straight sides meet the circle, so the join has no kink."""
    d = CY - APEX_Y                 # the apex sits directly above the centre
    tl = math.sqrt(d * d - R * R)   # tangent length
    return ((CX - R * tl / d, CY - R * R / d),
            (CX + R * tl / d, CY - R * R / d))


TL, TR = tangent_points()
APEX = (CX, APEX_Y)


def _in_triangle(x, y, a, b, c):
    def side(p, q):
        return (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0])
    s1, s2, s3 = side(a, b), side(b, c), side(c, a)
    return not ((s1 < 0 or s2 < 0 or s3 < 0) and (s1 > 0 or s2 > 0 or s3 > 0))


def inside(x, y):
    if (x - CX) ** 2 + (y - CY) ** 2 <= R * R:
        return True
    return _in_triangle(x, y, APEX, TL, TR)


def coverage(size):
    scale = SIZE / size
    rows = []
    for py in range(size):
        row = []
        for px in range(size):
            hit = sum(
                1
                for sy in range(SS)
                for sx in range(SS)
                if inside((px + (sx + 0.5) / SS) * scale,
                          (py + (sy + 0.5) / SS) * scale)
            )
            row.append(round(255 * hit / (SS * SS)))
        rows.append(row)
    return rows


def _chunk(tag, data):
    return (struct.pack('>I', len(data)) + tag + data
            + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))


def write_png(path, rows):
    """rows: alpha per pixel. Colour is white everywhere; only alpha is read."""
    h = len(rows)
    w = len(rows[0])
    raw = bytearray()
    for row in rows:
        raw.append(0)  # filter: none
        for a in row:
            raw += bytes((255, 255, 255, a))
    path.write_bytes(
        b'\x89PNG\r\n\x1a\n'
        + _chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
        + _chunk(b'IDAT', zlib.compress(bytes(raw), 9))
        + _chunk(b'IEND', b'')
    )


if __name__ == '__main__':
    rows = coverage(SIZE)
    # The two properties that make it a valid mask, asserted rather than eyeballed:
    # the corners must be fully transparent (or Android draws a square) and the
    # body must be fully opaque (or the glyph reads as a smudge).
    assert rows[0][0] == rows[0][-1] == rows[-1][0] == rows[-1][-1] == 0, 'corner not transparent'
    assert rows[60][48] == 255, 'body not opaque'
    for out in OUTPUTS:
        write_png(out, rows)
        print(f'wrote {out.relative_to(ROOT)}  {SIZE}x{SIZE}')
