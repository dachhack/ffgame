#!/usr/bin/env node
// Batch fantasy-mashup avatars: send ESPN player headshots to Gemini's image
// model and save the results (e.g. Marvin Harrison Jr. as a dragonborn).
//
// Roster source is src/data/headshots.ts (slug -> ESPN headshot URL), so
// there's no separate list to maintain. Outputs land at
//   scripts/fantasy-avatars/out/<style>/<slug>.png
// plus a manifest.json per style recording ok / refused / error per player —
// Gemini sometimes declines images of identifiable people, and the manifest
// makes those visible instead of silently missing.
//
// Requires GEMINI_API_KEY in the environment (aistudio.google.com/apikey).
// Run it locally, not in CI — it spends real API money (~$0.04/image).
//
// Usage:
//   GEMINI_API_KEY=... node scripts/fantasy-avatars/generate.mjs --style dragonborn --limit 5
//   node scripts/fantasy-avatars/generate.mjs --style orc --players marvin-harrison-jr,ja-marr-chase
//   node scripts/fantasy-avatars/generate.mjs --prompt "as a 1920s noir detective, sepia" --style noir
//   node scripts/fantasy-avatars/generate.mjs --style elf --dry-run
//
// Flags:
//   --style <name>        preset name (see STYLES below) and the output folder
//   --prompt "<text>"     custom style clause; overrides the preset text
//                         (still pass --style to name the output folder)
//   --style-map "QB=wizard,RB=orc,WR=elf,TE=dwarf"
//                         style per position (from scripts/pbp/crosswalk.json);
//                         one folder for the whole set (--style names it,
//                         default "mixed"); unmapped positions are skipped
//   --players a,b,c       only these slugs (comma-separated)
//   --limit N             stop after N players (after skip-existing filtering)
//   --concurrency N       parallel requests (default 3)
//   --model <id>          Gemini model (default gemini-2.5-flash-image)
//   --out <dir>           output root (default scripts/fantasy-avatars/out)
//   --grid N              pack N players per API call as a contact sheet and
//                         slice the result — ~N× cheaper, lower per-face detail
//                         (try 9; 25 max is sensible at Gemini's ~1024px output)
//   --passes N            re-feed each result through Gemini N-1 extra times
//                         with a "mutate away from the real face" prompt
//                         (multiplies cost by N; does NOT erase likeness rights)
//   --keep-bg             skip chroma-keying, save Gemini's opaque output as-is
//   --key-only <file>     just chroma-key an existing PNG to <file>.keyed.png
//   --grid-preview        with --grid: build the first contact sheet and slice
//                         it back apart locally (no API call) to inspect both
//   --verify              re-hash out/<style>/*.png against the manifest's
//                         sha256 stamps; exit 1 if anything moved or changed
//   --force               regenerate even if the output PNG already exists
//   --dry-run             list what would be generated, no downloads/API calls
//
// Backgrounds: Gemini can't output transparency, so results are keyed locally.
// The prompt asks for flat magenta, but the model often ignores that — so the
// keyer detects the actual background color from the image border and keys
// whatever flat color came back (see keyOutBackground).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

const STYLES = {
  dragonborn: 'as a fearsome dragonborn warrior — scaled draconic skin, small horns, glowing eyes',
  orc: 'as a battle-hardened orc — green-grey skin, tusks, tribal war paint',
  elf: 'as a regal high elf — pointed ears, luminous skin, silver circlet',
  dwarf: 'as a stout dwarven champion — braided beard, rune-etched armor',
  barbarian: 'as a hulking barbarian warlord — war paint, fur-trimmed pauldrons, battle scars, wild braided hair',
  wizard: 'as an arcane wizard — wide-brimmed hat, crackling magical energy',
  knight: 'as an armored paladin knight — polished plate armor, heraldic colors',
  vampire: 'as an elegant vampire lord — pale skin, crimson eyes, high collar',
  werewolf: 'as a mid-transformation werewolf — fur, amber eyes, elongated jaw',
  robot: 'as a chrome battle android — panel seams, glowing circuit lines',
  zombie: 'as a gridiron zombie — weathered undead skin, glowing eyes, torn jersey',
};

// The wrapper around the style clause. Keeps team colors so avatars still read
// as "your player", but scrubs real trademarks: NFL shields, team logos, and
// wordmarks get replaced with invented fantasy heraldry. Gemini can't emit an
// alpha channel, so we ask for a solid magenta ground (no NFL team wears it,
// no fantasy skin tone is it) and chroma-key it to transparency after download.
const NO_TRADEMARKS =
  `Keep the jersey and its team colors, but REPLACE every real-world logo, NFL shield, ` +
  `team emblem, wordmark, and brand mark with invented fantasy heraldry (fictional crests, ` +
  `sigils, or runes in the same spots) — no real trademarks may appear anywhere. `;

const promptFor = (clause) =>
  `Transform this NFL player headshot into a stylized fantasy character portrait: ${clause}. ` +
  `Keep the pose and framing recognizable from the original photo. ${NO_TRADEMARKS}` +
  `Render as a detailed pixel-art style bust portrait, head and shoulders only, centered, ` +
  `no text or watermarks. The entire background must be one solid flat uniform bright ` +
  `magenta color (#FF00FF) — no gradient, no shadow, no vignette, no outline glow.`;

// Pass 2+ re-feeds the generated art (not the photo) to push it further from
// the source likeness: same character, mutated features.
const mutatePromptFor = () =>
  `Push this fantasy character portrait further from any real person: mutate and exaggerate ` +
  `the facial structure (brow, jaw, nose, eyes, skin texture) into the fantasy species so the ` +
  `face is no longer recognizable as the original subject, while keeping the same art style, ` +
  `pose, palette, jersey colors, and overall character design. ${NO_TRADEMARKS}` +
  `Keep the entire background one solid flat uniform bright magenta color (#FF00FF).`;

// ---- CLI ------------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name) => args.includes(`--${name}`);

const customPrompt = flag('prompt');

// --style-map "QB=wizard,RB=orc,WR=elf,TE=dwarf": one run, style per position
// (positions come from scripts/pbp/crosswalk.json, same slugs as headshots).
// Everything still lands in one out/<style>/ folder so the set ships together.
const styleMapFlag = flag('style-map');
let styleMap = null;
if (styleMapFlag) {
  if (customPrompt) {
    console.error('--style-map cannot be combined with --prompt (map entries use presets).');
    process.exit(1);
  }
  styleMap = {};
  for (const part of styleMapFlag.split(',')) {
    const [pos, s] = part.split('=').map((x) => x.trim());
    if (!pos || !STYLES[s]) {
      console.error(`Bad --style-map entry "${part}" — use POS=preset, presets: ${Object.keys(STYLES).join(', ')}`);
      process.exit(1);
    }
    styleMap[pos.toUpperCase()] = s;
  }
}

const style = flag('style') ?? (styleMap ? 'mixed' : 'dragonborn');
const onlyPlayers = flag('players')?.split(',').map((s) => s.trim()).filter(Boolean);
const limit = flag('limit') ? Number(flag('limit')) : Infinity;
const concurrency = flag('concurrency') ? Number(flag('concurrency')) : 3;
const model = flag('model') ?? 'gemini-2.5-flash-image';
const outRoot = flag('out') ?? path.join(HERE, 'out');
const force = has('force');
const dryRun = has('dry-run');
const keepBg = has('keep-bg');
const grid = flag('grid') ? Number(flag('grid')) : 0; // players per API call, 0 = one per call
const passes = flag('passes') ? Number(flag('passes')) : 1; // 2+ re-feeds output to mutate away from the source face

const clause = customPrompt ?? STYLES[style];
if (!clause && !styleMap) {
  console.error(`Unknown style "${style}". Presets: ${Object.keys(STYLES).join(', ')}`);
  console.error('Or pass --prompt "<style clause>" with your own --style name for the folder.');
  process.exit(1);
}
const prompt = clause ? promptFor(clause) : null; // per-player prompts override under --style-map

const keyOnly = flag('key-only'); // chroma-key an existing PNG, no API (testing/repair)

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey && !dryRun && !keyOnly && !has('grid-preview') && !has('verify')) {
  console.error('GEMINI_API_KEY is not set. Create one at https://aistudio.google.com/apikey');
  console.error('and run:  GEMINI_API_KEY=... node scripts/fantasy-avatars/generate.mjs ...');
  process.exit(1);
}

// ---- Roster from src/data/headshots.ts -------------------------------------
const headshotsTs = await readFile(path.join(REPO, 'src', 'data', 'headshots.ts'), 'utf8');
const roster = [...headshotsTs.matchAll(/"([a-z0-9-]+)":\s*"(https:[^"]+)"/g)]
  .map(([, slug, url]) => ({ slug, url }));
if (!roster.length) {
  console.error('Could not parse any players out of src/data/headshots.ts');
  process.exit(1);
}

let queue = roster;
if (onlyPlayers) {
  const want = new Set(onlyPlayers);
  queue = roster.filter((p) => want.has(p.slug));
  const missing = onlyPlayers.filter((s) => !queue.some((p) => p.slug === s));
  if (missing.length) console.warn(`Not in headshots.ts, skipping: ${missing.join(', ')}`);
}

if (styleMap) {
  const crosswalk = JSON.parse(await readFile(path.join(REPO, 'scripts', 'pbp', 'crosswalk.json'), 'utf8'));
  const before = queue.length;
  queue = queue
    .map((p) => ({ ...p, styleName: styleMap[crosswalk[p.slug]?.pos?.toUpperCase()] }))
    .filter((p) => p.styleName)
    .map((p) => ({ ...p, prompt: promptFor(STYLES[p.styleName]) }));
  if (before !== queue.length) {
    console.log(`Skipping ${before - queue.length} player(s) whose position isn't in the style map.`);
  }
}

const outDir = path.join(outRoot, style);
await mkdir(outDir, { recursive: true });
if (!force) {
  const before = queue.length;
  queue = queue.filter((p) => !existsSync(path.join(outDir, `${p.slug}.png`)));
  if (before !== queue.length && !keyOnly && !has('verify')) console.log(`Skipping ${before - queue.length} already-generated (use --force to redo).`);
}
queue = queue.slice(0, limit);

// --verify: re-hash every generated PNG against the manifest so a folder can
// be trusted (no renames/shuffles since generation) before wiring into the app.
if (has('verify')) {
  const m = JSON.parse(await readFile(path.join(outDir, 'manifest.json'), 'utf8'));
  let bad = 0, checked = 0;
  for (const [slug, entry] of Object.entries(m.players ?? {})) {
    if (entry.status !== 'ok' || !entry.sha256) continue;
    checked++;
    const file = path.join(outDir, `${slug}.png`);
    let actual;
    try { actual = createHash('sha256').update(await readFile(file)).digest('hex').slice(0, 16); } catch { /* missing */ }
    if (actual !== entry.sha256) { bad++; console.error(`  MISMATCH ${slug} — ${actual ? 'contents differ from manifest' : 'file missing'}`); }
  }
  console.log(`${checked} file(s) checked, ${bad} mismatch(es)`);
  process.exit(bad ? 1 : 0);
}

if (!keyOnly) {
  console.log(`Style "${style}" → ${outDir}`);
  if (styleMap) console.log(`Style map: ${Object.entries(styleMap).map(([p, s]) => `${p}→${s}`).join('  ')}`);
  else console.log(`Prompt: ${prompt}\n`);
  console.log(`${queue.length} player(s) queued${Number.isFinite(limit) ? ` (limit ${limit})` : ''}, concurrency ${concurrency}, model ${model}`);
  if (grid > 1) console.log(`Grid mode: ${Math.ceil(queue.length / grid)} API call(s) of up to ${grid} players each`);
}

if (dryRun) {
  for (const p of queue) console.log(`  would generate: ${p.slug}${p.styleName ? ` [${p.styleName}]` : ''}  (${p.url})`);
  process.exit(0);
}

// ---- Chroma key -------------------------------------------------------------
// Gemini returns opaque images. The prompt asks for a flat #FF00FF ground, but
// the model often ignores that and picks its own background — so instead of
// assuming magenta, sample the image border to find the actual background
// color, require it to be reasonably flat, then flood-fill it out from the
// borders (interior patches of the same color survive) and soften the rim.
const KEY = { r: 255, g: 0, b: 255 }; // what we ask for; used by grid stitching
const HARD = 70;   // Euclidean RGB distance: border-connected pixels this close are cleared
const SOFT = 140;  // rim pixels between HARD and SOFT get partial alpha
const POCKET = 48; // enclosed (unconnected) pixels this close are cleared too

const rgbDist = (r1, g1, b1, r2, g2, b2) =>
  Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);

const hueOf = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
};
const hueDelta = (a, b) => {
  const x = Math.abs(a - b) % 360;
  return x > 180 ? 360 - x : x;
};

/** Background color estimated from the border ring, or null when the border
 *  isn't flat enough to key: modal 16-level bucket, refined to the exact mean
 *  of the ring pixels in that bucket (gradients pull the raw bucket color). */
function detectBackground(data, w, h) {
  const ring = [];
  for (let x = 0; x < w; x++) ring.push(x, x + w * (h - 1));
  for (let y = 1; y < h - 1; y++) ring.push(y * w, y * w + w - 1);
  const buckets = new Map();
  for (const p of ring) {
    const i = p * 4;
    const k = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    buckets.set(k, (buckets.get(k) ?? 0) + 1);
  }
  const [modal] = [...buckets.entries()].sort((a, b) => b[1] - a[1])[0];
  let r = 0, g = 0, b = 0, n = 0;
  for (const p of ring) {
    const i = p * 4;
    const k = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    if (k !== modal) continue;
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
  }
  const key = { r: r / n, g: g / n, b: b / n };
  const near = ring.filter((p) => {
    const i = p * 4;
    return rgbDist(data[i], data[i + 1], data[i + 2], key.r, key.g, key.b) < SOFT;
  }).length;
  return near / ring.length >= 0.6 ? key : null; // busts touch the bottom edge; 60% flat is plenty
}

function keyOutBackground(pngBuf) {
  const img = PNG.sync.read(pngBuf);
  const { width: w, height: h, data } = img;
  const key = detectBackground(data, w, h);
  if (!key) return { buf: pngBuf, keyedFrac: 0 };
  // Magenta/pink-family ground? Then despill the rim, and let the flood also
  // take connected pixels whose HUE matches the key even when brightness has
  // drifted far (Gemini paints gradients/vignettes). Hue separates the bg from
  // team colors — Vikings purple sits ~30° away from magenta and stays put.
  const magentaKey = key.r > 150 && key.b > 110 && key.g < 110;
  const keyHue = hueOf(key.r, key.g, key.b);
  const dist = (i) => rgbDist(data[i], data[i + 1], data[i + 2], key.r, key.g, key.b);
  const bgLike = (i) => {
    if (dist(i) < HARD) return true;
    if (!magentaKey) return false;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    return r - g > 60 && b - g > 30 && hueDelta(hueOf(r, g, b), keyHue) < 22;
  };

  // Flood fill from every border pixel across near-magenta neighbors.
  const cleared = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) stack.push(x, x + w * (h - 1));
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const p = stack.pop();
    if (cleared[p] || !bgLike(p * 4)) continue;
    cleared[p] = 1;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }

  // Pocket sweep: background enclosed by the subject (gaps between dreadlocks,
  // under arms) never connects to the border, so the flood fill misses it.
  // Clear unconnected pixels that closely match the bg color — tighter
  // tolerance than the flood so near-bg art (a pink tongue on a magenta
  // ground) isn't punched out.
  for (let p = 0; p < w * h; p++) {
    if (!cleared[p] && dist(p * 4) < POCKET) cleared[p] = 1;
  }

  let hit = 0;
  const rim = [];
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (cleared[p]) { data[i + 3] = 0; hit++; continue; }
    const x = p % w, y = (p / w) | 0;
    if (
      (x > 0 && cleared[p - 1]) || (x < w - 1 && cleared[p + 1]) ||
      (y > 0 && cleared[p - w]) || (y < h - 1 && cleared[p + w])
    ) rim.push(p);
  }

  // Rim pass, up to 3px deep: edge pixels fade by their bg-similarity and get
  // despilled. Expansion stops at solid-subject pixels, so only the blended
  // fringe band is touched — wide gradients around hair need more than 1px.
  const softened = new Uint8Array(w * h);
  let frontier = rim;
  for (let depth = 0; depth < 3 && frontier.length; depth++) {
    const next = [];
    for (const p of frontier) {
      if (softened[p] || cleared[p]) continue;
      softened[p] = 1;
      const i = p * 4;
      const d = dist(i);
      if (d >= SOFT) continue; // solid subject — leave it, don't expand past it
      data[i + 3] = Math.round(data[i + 3] * Math.min(1, Math.max(0, (d - HARD) / (SOFT - HARD))));
      if (magentaKey) {
        const spillCap = Math.max(data[i + 1], Math.min(data[i], data[i + 2]));
        if (data[i] > spillCap) data[i] = spillCap;
        if (data[i + 2] > spillCap) data[i + 2] = spillCap;
      }
      const x = p % w, y = (p / w) | 0;
      if (x > 0) next.push(p - 1);
      if (x < w - 1) next.push(p + 1);
      if (y > 0) next.push(p - w);
      if (y < h - 1) next.push(p + w);
    }
    frontier = next;
  }
  // If almost nothing keyed, Gemini likely ignored the magenta ask — keep the
  // original rather than shipping a nibbled image, and let the caller warn.
  return { buf: PNG.sync.write(img), keyedFrac: hit / (w * h) };
}

if (keyOnly) {
  const { buf, keyedFrac } = keyOutBackground(await readFile(keyOnly));
  const dest = keyOnly.replace(/\.png$/i, '') + '.keyed.png';
  await writeFile(dest, buf);
  console.log(`keyed ${(keyedFrac * 100).toFixed(1)}% of pixels → ${dest}`);
  process.exit(0);
}

// ---- Grid batching -----------------------------------------------------------
// --grid N packs N headshots into one contact-sheet image per API call. One
// output image costs the same as one portrait, so a 5x5 grid is ~25x cheaper
// and stretches free-tier quota — at the price of less detail per face
// (Gemini outputs ~1024px total, so a 5x5 cell is ~200px).
const CELL = 256;

function stitchGrid(shotBufs, cols, rows) {
  const canvas = new PNG({ width: cols * CELL, height: rows * CELL });
  for (let i = 0; i < canvas.data.length; i += 4) {
    canvas.data[i] = KEY.r; canvas.data[i + 1] = KEY.g; canvas.data[i + 2] = KEY.b; canvas.data[i + 3] = 255;
  }
  shotBufs.forEach((buf, idx) => {
    const src = PNG.sync.read(buf);
    const scale = Math.min(CELL / src.width, CELL / src.height);
    const w = Math.max(1, Math.round(src.width * scale));
    const h = Math.max(1, Math.round(src.height * scale));
    const ox = (idx % cols) * CELL + ((CELL - w) >> 1);
    const oy = ((idx / cols) | 0) * CELL + ((CELL - h) >> 1);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = ((Math.min(src.height - 1, (y / scale) | 0)) * src.width + Math.min(src.width - 1, (x / scale) | 0)) * 4;
        const d = ((oy + y) * canvas.width + ox + x) * 4;
        const a = src.data[s + 3] / 255; // ESPN headshots are transparent PNGs — blend onto magenta
        canvas.data[d] = Math.round(src.data[s] * a + KEY.r * (1 - a));
        canvas.data[d + 1] = Math.round(src.data[s + 1] * a + KEY.g * (1 - a));
        canvas.data[d + 2] = Math.round(src.data[s + 2] * a + KEY.b * (1 - a));
      }
    }
  });
  return PNG.sync.write(canvas);
}

function sliceGrid(outBuf, cols, rows, count) {
  const img = PNG.sync.read(outBuf); // output size ≠ input size; slice proportionally
  const cells = [];
  for (let idx = 0; idx < count; idx++) {
    const col = idx % cols, row = (idx / cols) | 0;
    const x0 = Math.round((col * img.width) / cols), x1 = Math.round(((col + 1) * img.width) / cols);
    const y0 = Math.round((row * img.height) / rows), y1 = Math.round(((row + 1) * img.height) / rows);
    const cell = new PNG({ width: x1 - x0, height: y1 - y0 });
    for (let y = y0; y < y1; y++) {
      img.data.copy(cell.data, (y - y0) * cell.width * 4, (y * img.width + x0) * 4, (y * img.width + x1) * 4);
    }
    cells.push(PNG.sync.write(cell));
  }
  return cells;
}

const gridPromptFor = (n, cols, rows, c = clause) =>
  `This image is a ${cols}x${rows} grid of ${n} NFL player headshot photos on a solid magenta background. ` +
  `Transform EVERY headshot into a stylized fantasy character portrait: ${c}. ` +
  `Keep each transformed character in exactly the same grid cell as its source photo — one character ` +
  `per cell, same layout, no swapping, merging, or moving subjects between cells. Keep each player's ` +
  `pose recognizable. Every character must be VISIBLY DIFFERENT, derived from its own source photo: ` +
  `keep that player's face shape, hairstyle, facial hair, and skin tone under the fantasy features — ` +
  `do not give every cell the same face. Each character must keep the jersey colors from ITS OWN ` +
  `source photo — never copy jersey colors, patterns, or team designs from a neighboring cell, and ` +
  `never render readable letters or words. ${NO_TRADEMARKS}Absolutely no NFL shield anywhere — ` +
  `replace every chest, collar, and sleeve logo with a fictional dragon-crest sigil. ` +
  `Render as detailed pixel-art style bust portraits, ` +
  `no text or watermarks. All background inside and between cells must stay one solid flat uniform ` +
  `bright magenta color (#FF00FF) — no gradients, shadows, or grid lines. Leave empty magenta cells empty.`;

// ---- Jersey audit (grid mode) -----------------------------------------------
// Gemini sometimes paints a cell with a NEIGHBOR's team colors (right cell,
// wrong jersey — layout checks can't see it). Detect it by color: histogram
// the torso region of each output cell and compare against every input in
// the batch; a cell that matches someone else's jersey clearly better than
// its own gets rejected and that player regenerates solo.

/** 64-bin RGB histogram of the opaque torso region, or null if too little. */
function torsoHist(pngBuf) {
  const img = PNG.sync.read(pngBuf);
  const { width: w, height: h, data } = img;
  const hist = new Float64Array(64);
  let n = 0;
  for (let y = Math.floor(h * 0.55); y < Math.floor(h * 0.98); y++) {
    for (let x = Math.floor(w * 0.1); x < Math.floor(w * 0.9); x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] < 120) continue;
      hist[(data[i] >> 6) * 16 + ((data[i + 1] >> 6) * 4) + (data[i + 2] >> 6)]++;
      n++;
    }
  }
  if (n < 50) return null;
  for (let k = 0; k < 64; k++) hist[k] /= n;
  return hist;
}

function histDist(a, b) {
  let s = 0;
  for (let k = 0; k < 64; k++) s += Math.abs(a[k] - b[k]);
  return s / 2; // 0 (identical) .. 1 (disjoint)
}

const gridMutatePromptFor = (n, cols, rows) =>
  `This image is a ${cols}x${rows} grid of ${n} fantasy character portraits on a solid magenta ` +
  `background. For EVERY portrait: push it further from any real person — mutate and exaggerate the ` +
  `facial structure (brow, jaw, nose, eyes, skin texture) into the fantasy species so no face is ` +
  `recognizable as a real individual, while keeping each character's art style, pose, palette, and ` +
  `jersey colors. Keep every character in exactly the same grid cell — no swapping, merging, or ` +
  `moving subjects. ${NO_TRADEMARKS}All background inside and between cells must stay one solid ` +
  `flat uniform bright magenta color (#FF00FF). Leave empty magenta cells empty.`;

// ---- Generation ------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const digest = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);

async function fetchHeadshot(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`headshot HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get('content-type')?.split(';')[0] || 'image/png';
  return { data: buf.toString('base64'), mime };
}

async function callGemini(headshot, promptText = prompt) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: headshot.mime, data: headshot.data } },
            { text: promptText },
          ],
        }],
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 300)}`);
    err.retryable = res.status === 429 || res.status >= 500;
    if (res.status === 429) {
      // Daily/plan quota (vs. a per-minute rate blip) — retrying won't help.
      err.quota = /quota|plan and billing/i.test(body);
      // Google includes RetryInfo like "retryDelay": "14s" — honor it.
      const m = body.match(/"retryDelay":\s*"(\d+)s"/);
      if (m) err.retryAfterMs = Number(m[1]) * 1000;
    }
    throw err;
  }
  const json = await res.json();
  const cand = json.candidates?.[0];
  const img = cand?.content?.parts?.find((p) => p.inlineData?.data || p.inline_data?.data);
  if (img) {
    const part = img.inlineData ?? img.inline_data;
    return { buf: Buffer.from(part.data, 'base64'), mime: part.mimeType ?? part.mime_type ?? 'image/png' };
  }
  // No image back — usually a policy refusal on identifiable people.
  const why = cand?.finishReason || json.promptFeedback?.blockReason ||
    cand?.content?.parts?.map((p) => p.text).filter(Boolean).join(' ').slice(0, 200) ||
    'no image in response';
  const err = new Error(why);
  err.refused = true;
  throw err;
}

const results = [];
let quotaWall = false; // set when the plan's quota is exhausted — stop the run

async function generateOne(p) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      let input = await fetchHeadshot(p.url);
      let out;
      for (let pass = 1; pass <= passes; pass++) {
        out = await callGemini(input, pass === 1 ? (p.prompt ?? prompt) : mutatePromptFor());
        input = { data: out.buf.toString('base64'), mime: out.mime };
      }
      let buf = out.buf;
      let note;
      if (!keepBg) {
        if (out.mime !== 'image/png') {
          note = `not keyed: got ${out.mime}`;
        } else {
          const keyed = keyOutBackground(buf);
          // <5% cleared means the model ignored the magenta ask; keep original.
          if (keyed.keyedFrac < 0.05) note = 'not keyed: background not flat enough to key';
          else buf = keyed.buf;
        }
        if (note) console.warn(`  warn    ${p.slug} — ${note} (kept opaque)`);
      }
      await writeFile(path.join(outDir, `${p.slug}.png`), buf);
      console.log(`  ok      ${p.slug}`);
      return { slug: p.slug, status: 'ok', sha256: digest(buf), ...(note ? { reason: note } : {}) };
    } catch (e) {
      if (e.refused) {
        console.warn(`  REFUSED ${p.slug} — ${e.message}`);
        return { slug: p.slug, status: 'refused', reason: e.message };
      }
      if (e.quota) {
        // Daily/billing quota exhausted — every further request would 429 too.
        quotaWall = true;
        return { slug: p.slug, status: 'quota' };
      }
      if (attempt < 3 && (e.retryable || e.code === 'ECONNRESET' || e.name === 'TypeError')) {
        const wait = e.retryAfterMs ?? 2000 * 2 ** (attempt - 1);
        console.warn(`  retry   ${p.slug} in ${Math.round(wait / 1000)}s — ${e.message.slice(0, 120)}`);
        await sleep(wait);
        continue;
      }
      console.error(`  ERROR   ${p.slug} — ${e.message}`);
      return { slug: p.slug, status: 'error', reason: e.message };
    }
  }
}

/** Grid mode: one API call transforms a whole contact sheet, then we slice it
 *  back apart by cell and key each cell. A refusal/error hits the whole batch. */
async function generateBatch(players) {
  const label = `${players[0].slug}…+${players.length - 1}`;
  const cols = Math.ceil(Math.sqrt(players.length));
  const rows = Math.ceil(players.length / cols);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const shots = await Promise.all(players.map((p) => fetchHeadshot(p.url)));
      const stitched = stitchGrid(shots.map((s) => Buffer.from(s.data, 'base64')), cols, rows);
      let input = { data: stitched.toString('base64'), mime: 'image/png' };
      let out;
      const batchClause = players[0].styleName ? STYLES[players[0].styleName] : clause;
      for (let pass = 1; pass <= passes; pass++) {
        out = await callGemini(input, pass === 1
          ? gridPromptFor(players.length, cols, rows, batchClause)
          : gridMutatePromptFor(players.length, cols, rows));
        input = { data: out.buf.toString('base64'), mime: out.mime };
      }
      // Slice ALL cells (including trailing empties) and sanity-check occupancy
      // before writing anything: a player cell that came back empty, or content
      // in a cell that should be empty, means the model shifted subjects around
      // — files written from that sheet would carry the WRONG player's face
      // under a right slug. Throw → the whole batch retries, then errors.
      const cellCount = cols * rows;
      const cells = sliceGrid(out.buf, cols, rows, cellCount);
      const keyed = cells.map((c) => keyOutBackground(c));
      const bgKeyed = keyed.some((k) => k.keyedFrac >= 0.05);
      if (bgKeyed) {
        for (let i = 0; i < cellCount; i++) {
          if (i < players.length && keyed[i].keyedFrac >= 0.98) {
            throw new Error(`grid drift: cell ${i} (${players[i].slug}) came back empty`);
          }
          if (i >= players.length && keyed[i].keyedFrac < 0.9) {
            throw new Error(`grid drift: unexpected content in empty cell ${i}`);
          }
        }
      }
      // Jersey audit: reject cells wearing another batch member's team colors.
      const inHists = shots.map((s) => torsoHist(Buffer.from(s.data, 'base64')));
      const wrongJersey = new Set();
      for (let i = 0; i < players.length; i++) {
        const outHist = torsoHist(keepBg || !bgKeyed ? cells[i] : keyed[i].buf);
        if (!outHist || !inHists[i]) continue;
        const own = histDist(outHist, inHists[i]);
        let bestOther = Infinity;
        for (let j = 0; j < players.length; j++) {
          if (j !== i && inHists[j]) bestOther = Math.min(bestOther, histDist(outHist, inHists[j]));
        }
        if (own > bestOther * 1.3 + 0.12) wrongJersey.add(i);
      }

      const batch = [];
      for (let i = 0; i < players.length; i++) {
        if (wrongJersey.has(i)) {
          console.warn(`  reject  ${players[i].slug} — cell matches another player's jersey colors; regenerating solo`);
          const solo = await generateOne(players[i]);
          batch.push(solo?.status === 'ok' ? { ...solo, reason: 'grid cell had wrong jersey; regenerated solo' } : solo);
          continue;
        }
        const note = !keepBg && !bgKeyed ? 'not keyed: cell background not flat enough to key' : undefined;
        const buf = keepBg || !bgKeyed ? cells[i] : keyed[i].buf;
        await writeFile(path.join(outDir, `${players[i].slug}.png`), buf);
        console.log(`  ok      ${players[i].slug}${note ? ` — ${note}` : ''}`);
        batch.push({ slug: players[i].slug, status: 'ok', sha256: digest(buf), ...(note ? { reason: note } : {}) });
      }
      return batch;
    } catch (e) {
      if (e.refused) {
        console.warn(`  REFUSED batch ${label} — ${e.message}`);
        return players.map((p) => ({ slug: p.slug, status: 'refused', reason: e.message }));
      }
      if (e.quota) {
        quotaWall = true;
        return players.map((p) => ({ slug: p.slug, status: 'quota' }));
      }
      if (attempt < 3) {
        const wait = e.retryAfterMs ?? 2000 * 2 ** (attempt - 1);
        console.warn(`  retry   batch ${label} in ${Math.round(wait / 1000)}s — ${e.message.slice(0, 120)}`);
        await sleep(wait);
        continue;
      }
      console.error(`  ERROR   batch ${label} — ${e.message}`);
      return players.map((p) => ({ slug: p.slug, status: 'error', reason: e.message }));
    }
  }
}

// Grid batches must share one style, so group by style before chunking.
function chunkJobs() {
  const groups = new Map();
  for (const p of queue) {
    const k = p.styleName ?? style;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const out = [];
  for (const g of groups.values()) {
    for (let i = 0; i < g.length; i += grid) out.push(g.slice(i, i + grid));
  }
  return out;
}
const jobs = grid > 1 ? chunkJobs() : queue;

// --grid-preview: exercise the local half of grid mode (stitch → slice → key)
// on the first batch, so the contact sheet can be inspected before spending
// API money. Writes grid-preview.png plus keyed per-player cells.
if (has('grid-preview')) {
  if (grid <= 1 || !jobs.length) {
    console.error('--grid-preview needs --grid N (>1) and a non-empty queue.');
    process.exit(1);
  }
  const players = jobs[0];
  const cols = Math.ceil(Math.sqrt(players.length));
  const rows = Math.ceil(players.length / cols);
  const shots = await Promise.all(players.map((p) => fetchHeadshot(p.url)));
  const stitched = stitchGrid(shots.map((s) => Buffer.from(s.data, 'base64')), cols, rows);
  await writeFile(path.join(outDir, 'grid-preview.png'), stitched);
  const previewDir = path.join(outDir, 'grid-preview-cells');
  await mkdir(previewDir, { recursive: true });
  for (const [i, cell] of sliceGrid(stitched, cols, rows, players.length).entries()) {
    await writeFile(path.join(previewDir, `${players[i].slug}.png`), keyOutBackground(cell).buf);
  }
  console.log(`Contact sheet (${cols}x${rows}, what Gemini would receive): ${path.join(outDir, 'grid-preview.png')}`);
  console.log(`Sliced + keyed cells (local round trip, no API): ${previewDir}`);
  process.exit(0);
}
let cursor = 0;
async function worker() {
  while (cursor < jobs.length && !quotaWall) {
    const job = jobs[cursor++];
    if (grid > 1) results.push(...await generateBatch(job));
    else results.push(await generateOne(job));
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));

// ---- Manifest & summary -----------------------------------------------------
const manifestPath = path.join(outDir, 'manifest.json');
let manifest = {};
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { /* first run */ }
const styleOf = new Map(queue.map((p) => [p.slug, p.styleName]));
for (const r of results) {
  if (r.status === 'quota') continue; // not an outcome — the run just stopped here
  const source = roster.find((p) => p.slug === r.slug)?.url;
  manifest[r.slug] = {
    status: r.status,
    ...(r.reason ? { reason: r.reason } : {}),
    // Same slug the app keys players by (HEADSHOTS, rosters) — file: <slug>.png.
    espnId: source?.match(/full\/(\d+)\.png/)?.[1],
    source,
    passes,
    ...(styleOf.get(r.slug) ? { style: styleOf.get(r.slug) } : {}),
    // sha256 (truncated) of the written PNG — verifies files haven't been
    // renamed or shuffled since generation.
    ...(r.sha256 ? { sha256: r.sha256 } : {}),
  };
}
await writeFile(manifestPath, JSON.stringify(
  { style, model, ...(styleMap ? { styleMap } : { prompt }), players: manifest }, null, 2,
));

const tally = results.reduce((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {});
console.log(`\nDone: ${tally.ok ?? 0} ok, ${tally.refused ?? 0} refused, ${tally.error ?? 0} error`);
console.log(`Manifest: ${manifestPath}`);
if (tally.refused) console.log('Refusals are usually Gemini declining identifiable-person edits; try rewording the prompt.');
if (quotaWall) {
  console.error(
    '\nSTOPPED: your Gemini plan quota is exhausted (HTTP 429 "check your plan and billing").' +
    '\nThe free tier allows very few image generations per day. Enable billing on the key\'s' +
    '\nproject at https://aistudio.google.com to run at roster scale, or rerun tomorrow —' +
    '\nalready-generated players are skipped, so the run resumes where it stopped.',
  );
  process.exit(2);
}
