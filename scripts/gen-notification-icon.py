#!/usr/bin/env python3
"""Bake the notification SILHOUETTE — a drop cut out of a football, white on transparent.

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
colour, and fine interior detail (the DF letters, the mascot) turns to mush by
18px — which is the size that actually matters.

── WHY A DROP IN A FOOTBALL (v0.433.4) ──────────────────────────────────────
Founder: "The notification icon is just a drop of water. I think we can do
better." Then, from a sheet of eleven — drops, footballs, helmets, and mashups
of the three — "Let's try 11 but with the solid drop of 5": the football,
plain, with the drop KNOCKED OUT of it. A bare droplet in a status bar is a
hydration reminder or a weather app; a football with a drop cut clean through
it is ours and nobody else's, and it is two shapes, both of which survive as
a mask: the ball is one solid lens and the drop is one solid hole. No laces,
no end seams — at 24px those thinned to specks that read as damage on the
ball's edge, and the drop is the detail worth keeping. The drop is 56% of the
full drop, sized so its bulb clears the ball's edge on every side at every
density (a hole that opens onto the background is a bite, not a drop).

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

# Geometry in a 96-unit box, which leaves the padding Android expects inside
# the 24dp frame — the system does NOT inset for you, and a glyph drawn to the
# edges is a glyph that touches the clock.
SIZE = 96
SS = 4  # samples per axis, so edges are anti-aliased rather than stepped

# THE BALL: a lens — the intersection of two equal circles — with half-length
# A and half-width B along its own axis, tilted TILT degrees (nose up-right).
BX, BY, A, B, TILT = 48.0, 48.0, 40.0, 24.0, -38.0
# THE DROP, knocked out: the tangent-built droplet below (circle + the two
# tangent lines from the apex), scaled by K about (48, 50).
CX, CY, R, APEX_Y = 48.0, 60.0, 28.0, 8.0
K, KX, KY = 0.56, 48.0, 50.0


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


def _in_drop(x, y):
    if (x - CX) ** 2 + (y - CY) ** 2 <= R * R:
        return True
    return _in_triangle(x, y, APEX, TL, TR)


def _in_ball(x, y):
    # Into the ball's own frame: un-tilt about its centre.
    t = math.radians(TILT)
    c, s = math.cos(t), math.sin(t)
    u = BX + (x - BX) * c + (y - BY) * s
    v = BY - (x - BX) * s + (y - BY) * c
    # A lens of half-length A and half-width B is the intersection of two
    # circles of radius RR whose centres sit CC either side of the axis.
    RR = (A * A + B * B) / (2 * B)
    CC = RR - B
    return ((u - BX) ** 2 + (v - (BY + CC)) ** 2 <= RR * RR
            and (u - BX) ** 2 + (v - (BY - CC)) ** 2 <= RR * RR)


def inside(x, y):
    """White where the ball is and the drop is not."""
    return _in_ball(x, y) and not _in_drop(KX + (x - KX) / K, KY + (y - KY) / K)


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
    # The properties that make it a valid mask, asserted rather than eyeballed:
    # the corners fully transparent (or Android draws a square); the ball
    # fully opaque; the drop fully clear at its apex and its bulb; and white
    # ball between the drop and the background on every side — a hole that
    # opens onto the background is a bite, not a drop.
    assert rows[0][0] == rows[0][-1] == rows[-1][0] == rows[-1][-1] == 0, 'corner not transparent'
    assert rows[30][72] == 255 and rows[66][24] == 255, 'ball not opaque'          # on the ball's axis, ±30 from centre
    assert rows[56][48] == 0 and rows[36][48] == 0, 'drop not clear'                # the bulb's centre, the neck
    assert rows[56][30] == 255 and rows[56][66] == 255, 'drop reaches the ball\'s edge (sides)'
    assert rows[25][48] == 255 and rows[73][48] == 255, 'drop reaches the ball\'s edge (top/bottom)'
    for out in OUTPUTS:
        write_png(out, rows)
        print(f'wrote {out.relative_to(ROOT)}  {SIZE}x{SIZE}')
