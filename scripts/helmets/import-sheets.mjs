// AI HELMET SHEETS → per-team left- and right-facing helmets
//
//   node scripts/helmets/import-sheets.mjs        (npm run import:helmets)
//   then npm run gen:helmets
//
// Left-facing helmets come from sheets in source/ai-left/ (four per sheet,
// lettering painted in, white background), mapped to teams by ai-helmets.json.
// Each right-facing helmet comes from, in order:
//   1. source/ai-right/{ABBR}.png|jpg   a single AI-drawn helmet (Gemini, ChatGPT…)
//   2. source/ai-right/hN.png|jpg       an AI-drawn sheet in hN's team order
//   3. mirroring, for teams listed in mirrorOk only: the lettering is lifted
//      off (blobs walled in by the shell, in its upper half), the shell is
//      painted back (Laplace fill, so gradients carry through), the helmet is
//      mirrored and the original lettering goes back at the mirrored spot.
//      This fails on dark, patterned or low-contrast shells, hence the list.
//
// Every helmet is cut out, its white background (and white showing through
// the face mask) made transparent, and framed like template.png, so the
// number zone in template.json fits it too. Writes ai/{ABBR}-{left|right}.png
// (512×512) for gen-helmets.mjs, and preview/ai-sheet.png to check them.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { decodeImage, encodePng, unpremultiply } from './png.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'source');
const OUT = join(HERE, 'ai');
const PREVIEW = join(HERE, 'preview');
const config = JSON.parse(readFileSync(join(HERE, 'ai-helmets.json'), 'utf8'));
const mirrorOk = new Set(config.mirrorOk);
const SIZE = 512;
// template.png's helmet is 786 px wide on an 868 px canvas, centered.
const FRAME_W = 786 / 868;

const N4 = (W) => [-1, 1, -W, W];
const N8 = (W) => [-1, 1, -W, W, -W - 1, -W + 1, W - 1, W + 1];

// Connected components of pixels where pred(p) holds. → labels, list of {pixels}
function components(W, H, pred, nbrs = N4(W)) {
  const label = new Int32Array(W * H).fill(-1);
  const comps = [];
  for (let s = 0; s < W * H; s++) {
    if (label[s] !== -1 || !pred(s)) continue;
    const id = comps.length, pix = [s];
    label[s] = id;
    for (let k = 0; k < pix.length; k++) {
      const p = pix[k], x = p % W;
      for (const d of nbrs) {
        const q = p + d;
        if (q < 0 || q >= W * H || Math.abs((q % W) - x) > 1 || label[q] !== -1 || !pred(q)) continue;
        label[q] = id; pix.push(q);
      }
    }
    comps.push({ id, pix });
  }
  return { label, comps };
}

const bbox = (pix, W) => {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (const p of pix) { const x = p % W, y = (p / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
};

// ---- 1. cut helmets out of a sheet ----------------------------------------

function cutSheet(path, count) {
  const { width: W, height: H, pixels: px } = decodeImage(path);
  const white = (p) => { const i = p * 4; const lo = Math.min(px[i], px[i + 1], px[i + 2]); return lo > 228 && Math.max(px[i], px[i + 1], px[i + 2]) - lo < 22; };
  // Background = white reachable from the sheet's edge.
  const bg = new Uint8Array(W * H);
  const stack = [];
  for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
  while (stack.length) {
    const p = stack.pop();
    if (bg[p] || !white(p)) continue;
    bg[p] = 1;
    const x = p % W;
    for (const d of N4(W)) { const q = p + d; if (q >= 0 && q < W * H && Math.abs((q % W) - x) <= 1 && !bg[q]) stack.push(q); }
  }
  const { comps } = components(W, H, (p) => !bg[p], N8(W));
  const big = comps.filter((c) => c.pix.length > 4000).sort((a, b) => b.pix.length - a.pix.length).slice(0, count);
  if (big.length < count) throw new Error(`${path}: found ${big.length} helmets, expected ${count}`);
  big.forEach((c) => { c.box = bbox(c.pix, W); });
  // Reading order: rows of two, left to right.
  big.sort((a, b) => a.box.y0 - b.box.y0);
  const rows = [];
  for (let i = 0; i < big.length; i += 2) rows.push(big.slice(i, i + 2).sort((a, b) => a.box.x0 - b.box.x0));
  return rows.flat().map((c) => {
    const PAD = 6, { x0, y0, w, h } = c.box;
    const cw = w + PAD * 2, ch = h + PAD * 2;
    const out = new Uint8Array(cw * ch * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const sp = (y0 + y) * W + (x0 + x), dp = ((y + PAD) * cw + (x + PAD)) * 4;
      if (bg[sp]) continue;
      out.set([px[sp * 4], px[sp * 4 + 1], px[sp * 4 + 2], 255], dp);
    }
    return { W: cw, H: ch, px: out };
  });
}

// White showing through the face mask: walled-in white blobs in the front
// part of the helmet that are wider than a face-mask bar.
function clearMaskGaps(img) {
  const { W, H, px } = img;
  const white = (p) => { const i = p * 4; if (!px[i + 3]) return false; const lo = Math.min(px[i], px[i + 1], px[i + 2]); return lo > 232 && Math.max(px[i], px[i + 1], px[i + 2]) - lo < 18; };
  const { comps } = components(W, H, white);
  for (const c of comps) {
    const b = bbox(c.pix, W);
    if (b.x1 > W * 0.55 || b.y0 < H * 0.2) continue;              // only the face mask area
    if (Math.min(b.w, b.h) < 12) continue;                          // a bar, not a gap
    if (c.pix.some((p) => { const x = p % W; return x === 0 || px[(p - 1) * 4 + 3] === 0; })) continue;
    for (const p of c.pix) px[p * 4 + 3] = 0;
  }
}

// ---- 2. find the lettering ------------------------------------------------

function findLettering(img) {
  const { W, H, px } = img;
  const diff = (p, q) => Math.abs(px[p * 4] - px[q * 4]) + Math.abs(px[p * 4 + 1] - px[q * 4 + 1]) + Math.abs(px[p * 4 + 2] - px[q * 4 + 2]);
  // Grow the shell from the most promising seed: back of the helmet, mid height.
  let best = null;
  for (const [fx, fy] of [[0.9, 0.55], [0.88, 0.45], [0.92, 0.65], [0.82, 0.7], [0.85, 0.35]]) {
    const s = Math.round(fy * H) * W + Math.round(fx * W);
    if (!px[s * 4 + 3]) continue;
    const shell = new Uint8Array(W * H);
    const st = [s]; shell[s] = 1; let n = 0;
    while (st.length) {
      const p = st.pop(); n++;
      const x = p % W;
      for (const d of N4(W)) {
        const q = p + d;
        if (q < 0 || q >= W * H || Math.abs((q % W) - x) > 1 || shell[q] || !px[q * 4 + 3]) continue;
        if (diff(p, q) > 24) continue;
        shell[q] = 1; st.push(q);
      }
    }
    if (!best || n > best.n) best = { shell, n };
  }
  const { shell } = best;
  // Blobs that are not shell and are walled in by shell on every side.
  const { label, comps } = components(W, H, (p) => px[p * 4 + 3] && !shell[p], N8(W));
  const letters = new Uint8Array(W * H);
  const specks = new Uint8Array(W * H);
  const picked = [];
  for (const c of comps) {
    const b = bbox(c.pix, W);
    let enclosed = true;
    for (const p of c.pix) {
      const x = p % W;
      for (const d of N4(W)) {
        const q = p + d;
        if (q < 0 || q >= W * H || Math.abs((q % W) - x) > 1 || (label[q] !== c.id && !shell[q])) { enclosed = false; break; }
      }
      if (!enclosed) break;
    }
    if (!enclosed) continue;
    if (c.pix.length < 25) { for (const p of c.pix) specks[p] = 1; continue; } // JPEG specks on the shell
    // Lettering sits in the upper part; the ear hole lower down stays art.
    const cy = (b.y0 + b.y1) / 2 / H;
    if (cy > 0.58 || b.w * b.h > W * H * 0.25) continue;
    picked.push(b);
    for (const p of c.pix) letters[p] = 1;
  }
  // Grow so soft edges come along: letters 2px, specks 1px.
  const grow = (m, times) => {
    for (let r = 0; r < times; r++) {
      const add = [];
      for (let p = 0; p < W * H; p++) if (m[p]) for (const d of N4(W)) { const q = p + d; if (q >= 0 && q < W * H && !m[q] && px[q * 4 + 3]) add.push(q); }
      for (const q of add) m[q] = 1;
    }
  };
  grow(letters, 2);
  grow(specks, 1);
  const mask = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) mask[p] = letters[p] | specks[p];
  return { mask, letters, shell, picked };
}

// ---- 3. paint the shell back ------------------------------------------------

function inpaint(img, mask) {
  const { W, H, px } = img;
  const out = new Float32Array(W * H * 3);
  for (let p = 0; p < W * H; p++) for (let k = 0; k < 3; k++) out[p * 3 + k] = px[p * 4 + k];
  const holes = [];
  for (let p = 0; p < W * H; p++) if (mask[p]) holes.push(p);
  for (let it = 0; it < 600; it++) {
    for (const p of holes) {
      const x = p % W;
      let s0 = 0, s1 = 0, s2 = 0, n = 0;
      for (const d of N4(W)) {
        const q = p + d;
        if (q < 0 || q >= W * H || Math.abs((q % W) - x) > 1 || !px[q * 4 + 3]) continue;
        s0 += out[q * 3]; s1 += out[q * 3 + 1]; s2 += out[q * 3 + 2]; n++;
      }
      if (n) { out[p * 3] = s0 / n; out[p * 3 + 1] = s1 / n; out[p * 3 + 2] = s2 / n; }
    }
  }
  const clean = new Uint8Array(px);
  for (const p of holes) for (let k = 0; k < 3; k++) clean[p * 4 + k] = Math.round(out[p * 3 + k]);
  return clean;
}

// ---- 4. mirror and re-letter ------------------------------------------------

function mirrorKeepLettering(img, clean, letters, picked) {
  const { W, H, px } = img;
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = (y * W + (W - 1 - x)) * 4;
    out.set(clean.subarray(s, s + 4), (y * W + x) * 4);
  }
  // Where the lettering block sits: the letters themselves, not the specks.
  const x0 = Math.min(...picked.map((b) => b.x0)), x1 = Math.max(...picked.map((b) => b.x1));
  const shift = W - 1 - x0 - x1;
  for (let p = 0; p < W * H; p++) {
    if (!letters[p]) continue;
    const x = p % W, y = (p / W) | 0, nx = x + shift;
    if (nx < 0 || nx >= W) continue;
    out.set(px.subarray(p * 4, p * 4 + 4), (y * W + nx) * 4);
  }
  return out;
}

// ---- framing and sources --------------------------------------------------

const flipH = (img) => {
  const { W, H, px } = img;
  const out = new Uint8Array(px.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = (y * W + (W - 1 - x)) * 4;
    out.set(px.subarray(s, s + 4), (y * W + x) * 4);
  }
  return { W, H, px: out };
};

// Scale the cut-out helmet onto a 512 canvas the way template.png frames its own.
function frame(img) {
  const w = SIZE * FRAME_W, h = (w * img.H) / img.W;
  const href = `data:image/png;base64,${encodePng(img.px, img.W, img.H).toString('base64')}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"><image href="${href}" x="${(SIZE - w) / 2}" y="${(SIZE - h) / 2}" width="${w}" height="${h}"/></svg>`;
  const r = new Resvg(svg).render();
  return encodePng(unpremultiply(new Uint8Array(r.pixels)), r.width, r.height);
}

const findFile = (name) => ['png', 'jpg', 'jpeg'].map((e) => join(SRC, 'ai-right', `${name}.${e}`)).find(existsSync);

// Right-facing AI helmets: cleaned as if left-facing (flip, clean, flip back).
function cleanRight(img) {
  const f = flipH(img);
  clearMaskGaps(f);
  return flipH(f);
}

// ---- run ------------------------------------------------------------------

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const report = { gemini: [], mirrored: [], missing: [] };
const done = [];
for (const { file, teams } of config.sheets) {
  const leftPath = ['png', 'jpg', 'jpeg'].map((e) => join(SRC, 'ai-left', `${file}.${e}`)).find(existsSync);
  const lefts = cutSheet(leftPath, teams.length);
  const rightSheet = findFile(file);
  const rights = rightSheet ? cutSheet(rightSheet, teams.length) : [];
  teams.forEach((abbr, k) => {
    const left = lefts[k];
    clearMaskGaps(left);
    writeFileSync(join(OUT, `${abbr}-left.png`), frame(left));

    let right = null;
    const single = findFile(abbr);
    if (single) { right = cleanRight(cutSheet(single, 1)[0]); report.gemini.push(abbr); }
    else if (rights[k]) { right = cleanRight(rights[k]); report.gemini.push(abbr); }
    else if (mirrorOk.has(abbr)) {
      const { mask, letters, picked } = findLettering(left);
      if (picked.length) {
        right = { W: left.W, H: left.H, px: mirrorKeepLettering(left, inpaint(left, mask), letters, picked) };
        report.mirrored.push(abbr);
      }
    }
    if (right) writeFileSync(join(OUT, `${abbr}-right.png`), frame(right));
    else report.missing.push(abbr);
    done.push(abbr);
  });
}

// Check sheet: every team, left then right (blank where missing).
mkdirSync(PREVIEW, { recursive: true });
const C = 200, COLS = 8;
let sheet = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${C * COLS} ${C * Math.ceil((done.length * 2) / COLS)}"><rect width="100%" height="100%" fill="#5A6B7C"/>`;
done.forEach((abbr, i) => ['left', 'right'].forEach((dir, j) => {
  const f = join(OUT, `${abbr}-${dir}.png`);
  if (!existsSync(f)) return;
  const n = i * 2 + j;
  sheet += `<image x="${(n % COLS) * C}" y="${Math.floor(n / COLS) * C}" width="${C}" height="${C}" href="data:image/png;base64,${readFileSync(f).toString('base64')}"/>`;
}));
writeFileSync(join(PREVIEW, 'ai-sheet.png'), new Resvg(sheet + '</svg>').render().asPng());

console.log(`✓ ${done.length} left-facing helmets → scripts/helmets/ai/, check preview/ai-sheet.png`);
console.log(`  right-facing from AI images (${report.gemini.length}): ${report.gemini.join(' ') || '—'}`);
console.log(`  right-facing by mirroring (${report.mirrored.length}): ${report.mirrored.join(' ') || '—'}`);
if (report.missing.length) console.log(`! no right-facing helmet yet (${report.missing.length}): ${report.missing.join(' ')} — gen-helmets falls back to the template helmet for these`);
