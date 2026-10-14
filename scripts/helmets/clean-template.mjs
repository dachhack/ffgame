// AI HELMET ART → template.png
//
//   node scripts/helmets/clean-template.mjs [source image]
//   (default source: scripts/helmets/source/helmet-ai.jpg)
//
// Image models paint a "transparent" checkerboard instead of real
// transparency, and save JPEG noise into flat colors. This strips the
// checkerboard (outside the helmet AND inside the face mask gaps), turns the
// black outline's soft edge into real alpha, and writes a true RGBA PNG that
// gen-helmets.mjs recolors per team.
//
// The art must be left-facing (face mask on the left) and use the placeholder
// colors: magenta #FF00FF shell, cyan #00FFFF stripe, yellow #FFFF00 face mask,
// black outline/pads, white-ish highlights.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeImage, encodePng } from './png.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = process.argv[2] ?? join(HERE, 'source', 'helmet-ai.jpg');
const { width: W, height: H, pixels: px } = decodeImage(src);
const N = W * H;

const chroma = (i) => Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2]);
const light = (i) => Math.min(px[i], px[i + 1], px[i + 2]);
// Checkerboard squares: near-white and near-#DDD, both colorless.
const isBgLike = (p) => chroma(p * 4) < 28 && light(p * 4) > 185;
const isGreySquare = (p) => isBgLike(p) && light(p * 4) < 238;
const isMagenta = (p) => { const i = p * 4; return px[i] > 150 && px[i + 2] > 150 && px[i + 1] < 120; };

// Connected light-neutral regions.
const comp = new Int32Array(N).fill(-1);
const comps = [];
for (let s = 0; s < N; s++) {
  if (comp[s] !== -1 || !isBgLike(s)) continue;
  const id = comps.length;
  const info = { size: 0, grey: 0, edge: false, border: 0, borderMagenta: 0 };
  const stack = [s];
  comp[s] = id;
  while (stack.length) {
    const p = stack.pop();
    info.size++;
    if (isGreySquare(p)) info.grey++;
    const x = p % W, y = (p / W) | 0;
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) info.edge = true;
    for (const q of [p - 1, p + 1, p - W, p + W]) {
      if (q < 0 || q >= N || Math.abs((q % W) - x) > 1) continue;
      if (comp[q] !== -1) continue;
      if (isBgLike(q)) { comp[q] = id; stack.push(q); } else { info.border++; if (isMagenta(q)) info.borderMagenta++; }
    }
  }
  comps.push(info);
}

// Background = touches the frame, or shows the checkerboard's grey squares, or
// is walled in by face mask/outline rather than by shell (a highlight sits on
// the shell, so it's mostly ringed by magenta).
const isBgComp = comps.map((c) => c.edge || c.grey / c.size > 0.08 || (c.size > 30 && c.borderMagenta / c.border < 0.25));
const bg = new Uint8Array(N);
for (let p = 0; p < N; p++) if (comp[p] !== -1 && isBgComp[comp[p]]) bg[p] = 1;

// Distance (in pixels, up to 4) from the background, for the edge pass.
const dist = new Uint8Array(N).fill(255);
let frontier = [];
for (let p = 0; p < N; p++) if (bg[p]) { dist[p] = 0; frontier.push(p); }
for (let d = 1; d <= 4; d++) {
  const next = [];
  for (const p of frontier) {
    const x = p % W;
    for (const q of [p - 1, p + 1, p - W, p + W]) {
      if (q < 0 || q >= N || Math.abs((q % W) - x) > 1 || dist[q] !== 255) continue;
      dist[q] = d; next.push(q);
    }
  }
  frontier = next;
}

const out = new Uint8Array(N * 4);
for (let p = 0; p < N; p++) {
  const i = p * 4;
  if (bg[p]) continue; // fully transparent
  out.set([px[i], px[i + 1], px[i + 2], 255], i);
  // Grey pixels on the rim are black outline blended into the old background:
  // make them black with partial alpha so they sit on any background.
  if (dist[p] <= 4 && chroma(i) < 40) {
    const L = (px[i] + px[i + 1] + px[i + 2]) / 3;
    const a = Math.max(0, Math.min(1, (215 - L) / (215 - 70)));
    out.set([0, 0, 0, Math.round(a * 255)], i);
  }
}

// Crop to the helmet and centre it on a square canvas, same size as the source.
let x0 = W, y0 = H, x1 = 0, y1 = 0;
for (let p = 0; p < N; p++) if (out[p * 4 + 3] > 8) {
  const x = p % W, y = (p / W) | 0;
  if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
}
const PAD = Math.round(W * 0.04);
const S = Math.max(x1 - x0, y1 - y0) + 1 + PAD * 2;
const sq = new Uint8Array(S * S * 4);
const ox = Math.round((S - (x1 - x0 + 1)) / 2), oy = Math.round((S - (y1 - y0 + 1)) / 2);
for (let y = y0; y <= y1; y++) {
  sq.set(out.subarray((y * W + x0) * 4, (y * W + x1 + 1) * 4), ((y - y0 + oy) * S + ox) * 4);
}

writeFileSync(join(HERE, 'template.png'), encodePng(sq, S, S));
const removed = comps.filter((_, k) => isBgComp[k]).length;
console.log(`✓ template.png ${S}×${S} (helmet ${x1 - x0 + 1}×${y1 - y0 + 1}); removed ${removed} background regions, kept ${comps.length - removed} light regions as highlights`);
