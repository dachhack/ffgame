// TEAM HELMETS — one master image, 32 teams, two directions, two variants.
//
//   node scripts/helmets/gen-helmets.mjs          (npm run gen:helmets)
//
// template.png is a left-facing helmet painted in placeholder colors (made from
// AI art by clean-template.mjs). For each team in teams.json this recolors it
// pixel by pixel, letters the city abbreviation and nickname onto the shell,
// and writes:
//
//   public/helmets/png/KC-left.png  KC-right.png       (256×256, abbr + nickname)
//   public/helmets/png/KC-left-plain.png  KC-right-plain.png  (abbr only, for
//                                                             mark-free mode)
//   public/helmets/manifest.json     (colors, files, and where the app draws
//                                     the number)
//   scripts/helmets/preview/sheet.png  (every helmet with a sample number)
//
// The art is mirrored for the right-facing version; the lettering is not, so
// it reads the same both ways. The player's number is NOT baked in: the app
// draws it at manifest.number.anchor in Jersey 15 (public/fonts/jersey-15.ttf).

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { decodeImage, encodePng, unpremultiply } from './png.mjs';

const toPng = (img) => encodePng(unpremultiply(new Uint8Array(img.pixels)), img.width, img.height);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(ROOT, 'public', 'helmets');
const PREVIEW = join(HERE, 'preview');
const FONTS = {
  decal: join(HERE, 'fonts', 'Graduate-Regular.ttf'),
  number: join(HERE, 'fonts', 'Jersey15-Regular.ttf'),
};
const SIZE = 512;  // layout units; files are rendered at OUT_SIZE
const OUT_SIZE = 256; // ≈85px on screen at 3×, like public/avatars

const teams = JSON.parse(readFileSync(join(HERE, 'teams.json'), 'utf8'));
const layout = JSON.parse(readFileSync(join(HERE, 'template.json'), 'utf8'));
const template = decodeImage(join(HERE, 'template.png'));

const px = (z) => ({ x: z.x * SIZE, y: z.y * SIZE, w: z.w * SIZE, h: z.h * SIZE });
const DECAL = px(layout.decal);
const NUMBER = px(layout.number);

// ---- text measuring -------------------------------------------------------

const FAMILY = { decal: 'Graduate', number: 'Jersey 15' };
const fontOpts = (...files) => ({ font: { fontFiles: files, loadSystemFonts: false, defaultFontFamily: 'Graduate' } });

// Ink box of `text` at font-size 100, so callers can scale to fit.
const measured = new Map();
function measure(text, font) {
  const key = `${font}|${text}`;
  if (!measured.has(key)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2000 400"><text x="100" y="300" font-family="${FAMILY[font]}" font-size="100">${esc(text)}</text></svg>`;
    const b = new Resvg(svg, fontOpts(FONTS[font])).getBBox();
    measured.set(key, { w: b.width, h: b.height, dx: b.x - 100, top: 300 - b.y });
  }
  return measured.get(key);
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// ---- color helpers --------------------------------------------------------

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// ---- building one helmet --------------------------------------------------

// Placeholder hues in template.png, as 0/1 channel masks.
const PARTS = { shell: [1, 0, 1], stripe: [0, 1, 1], facemask: [1, 1, 0] };
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// Every template pixel is read as a mix of one placeholder hue, white
// (highlights) and black (outline, pads, JPEG shading): c ≈ a·hue + w·white.
// Fit a and w for each hue, keep the best fit (or plain grey), then rebuild the
// pixel with the team's color in place of the hue.
function recolor(team) {
  const { pixels: src, width, height } = template;
  const out = new Uint8Array(src.length);
  const targets = Object.entries(PARTS).map(([part, u]) => ({ u, t: rgb(team[part]) }));
  for (let i = 0; i < src.length; i += 4) {
    if (!src[i + 3]) continue;
    const c = [src[i] / 255, src[i + 1] / 255, src[i + 2] / 255];
    const mean = (c[0] + c[1] + c[2]) / 3;
    let best = { err: c.reduce((s, v) => s + (v - mean) ** 2, 0), a: 0, w: mean, t: null };
    for (const { u, t } of targets) {
      const uu = u[0] + u[1] + u[2]; // 2 for each placeholder
      const uc = u[0] * c[0] + u[1] * c[1] + u[2] * c[2];
      const ec = c[0] + c[1] + c[2];
      const det = 3 * uu - uu * uu;
      let a = (3 * uc - uu * ec) / det;
      let w = (uu * ec - uu * uc) / det;
      a = Math.max(0, Math.min(1, a));
      w = Math.max(0, Math.min(1 - a, w));
      const err = c.reduce((s, v, k) => s + (v - (a * u[k] + w)) ** 2, 0);
      if (err < best.err) best = { err, a, w, t };
    }
    // Snap away the source's JPEG speckle so flat areas stay flat (and the
    // PNGs compress): near-solid color → solid, near-black → black, the rest
    // to 1/16 steps.
    let { a, w } = best;
    if (best.t && a > 0.82 && w < 0.12) { a = 1; w = 0; }
    else if (a < 0.1 && w < 0.12) { a = 0; w = 0; }
    else { a = Math.round(a * 16) / 16; w = Math.round(w * 16) / 16; }
    for (let k = 0; k < 3; k++) out[i + k] = Math.round(best.t ? a * best.t[k] + w * 255 : w * 255);
    out[i + 3] = src[i + 3];
  }
  return `data:image/png;base64,${encodePng(out, width, height).toString('base64')}`;
}

// White sticker halo around the art: invisible on light backgrounds, keeps
// dark helmets from vanishing on dark ones.
const HALO = `<filter id="halo" x="-5%" y="-5%" width="110%" height="110%">
    <feMorphology in="SourceAlpha" operator="dilate" radius="3" result="grown"/>
    <feFlood flood-color="#FFFFFF"/><feComposite in2="grown" operator="in" result="ring"/>
    <feMerge><feMergeNode in="ring"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>`;

// Lettering block centered in the decal zone: abbreviation big, nickname under it.
function lettering(team, plain, cx) {
  const lines = plain ? [{ text: team.abbr, max: 120 }] : [
    { text: team.abbr, max: 84 },
    { text: team.name.toUpperCase(), max: 34 },
  ];
  const GAP = 12;
  const sized = lines.map((l) => {
    const m = measure(l.text, 'decal');
    const size = Math.min(l.max, (DECAL.w * 0.94 / m.w) * 100, (DECAL.h * (plain ? 0.8 : 0.55) / m.h) * 100);
    return { ...l, m, size, h: (m.h * size) / 100 };
  });
  const total = sized.reduce((s, l) => s + l.h, 0) + GAP * (sized.length - 1);
  let top = DECAL.y + (DECAL.h - total) / 2;
  return sized.map((l) => {
    const baseline = top + (l.m.top * l.size) / 100;
    const x = cx - ((l.m.w / 2 + l.m.dx) * l.size) / 100;
    top += l.h + GAP;
    const sw = Math.max(3, l.size * 0.11);
    return `<text x="${x.toFixed(1)}" y="${baseline.toFixed(1)}" font-family="${FAMILY.decal}" font-size="${l.size.toFixed(1)}" fill="${team.text}" stroke="${team.textStroke}" stroke-width="${sw.toFixed(1)}" stroke-linejoin="round" paint-order="stroke">${esc(l.text)}</text>`;
  }).join('\n  ');
}

function helmetSvg(team, art, dir, plain) {
  // Named helmets use the AI art (lettering painted in) where import-sheets.mjs
  // made it; plain ones, and anything missing, come from the template.
  const ai = !plain && team.ai[dir];
  if (ai) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
  <defs>${HALO}</defs>
  <g filter="url(#halo)"><image href="${ai}" width="${SIZE}" height="${SIZE}"/></g>
</svg>`;
  const cx = DECAL.x + DECAL.w / 2;
  const flip = dir === 'left' ? '' : ` transform="translate(${SIZE} 0) scale(-1 1)"`;
  const text = lettering(team, plain, dir === 'left' ? cx : SIZE - cx);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
  <defs>${HALO}</defs>
  <g filter="url(#halo)"><image href="${art}" width="${SIZE}" height="${SIZE}"${flip}/></g>
  ${text}
</svg>`;
}

// ---- the number the app overlays ------------------------------------------

// Size the number so a wide two-digit number fits the zone, then pin it to the
// zone's outer bottom corner. Everything in the manifest is a fraction of the
// image's width/height, so it works at any display size.
const n88 = measure('88', 'number');
const NUMBER_SIZE = Math.min((NUMBER.w * 0.9 / n88.w) * 100, (NUMBER.h * 0.9 / n88.h) * 100);
const PAD = 8;
const numberAnchor = {
  left: { x: (NUMBER.x + NUMBER.w - PAD) / SIZE, y: (NUMBER.y + NUMBER.h - PAD) / SIZE, align: 'right' },
  right: { x: (SIZE - NUMBER.x - NUMBER.w + PAD) / SIZE, y: (NUMBER.y + NUMBER.h - PAD) / SIZE, align: 'left' },
};
const numberStyle = {
  font: 'Jersey 15',
  fontFile: '/fonts/jersey-15.ttf',
  fontSize: NUMBER_SIZE / SIZE,      // × image height
  strokeWidth: 0.07,                  // × font size, in the team's number.stroke
  outlineWidth: 0.13,                 // × font size, dark outline under that stroke
  outlineColor: '#10131A',
};

function numberSvg(team, dir, num) {
  const a = numberAnchor[dir];
  const fs = numberStyle.fontSize * SIZE;
  const anchor = a.align === 'right' ? 'end' : 'start';
  const x = (a.x * SIZE).toFixed(1);
  const y = (a.y * SIZE).toFixed(1);
  const t = (stroke, w) => `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${FAMILY.number}" font-size="${fs.toFixed(1)}" fill="${team.number.fill}" stroke="${stroke}" stroke-width="${(w * fs).toFixed(1)}" stroke-linejoin="round" paint-order="stroke">${num}</text>`;
  return t(numberStyle.outlineColor, numberStyle.outlineWidth) + t(team.number.stroke, numberStyle.strokeWidth);
}

// ---- run ------------------------------------------------------------------

rmSync(join(OUT, 'svg'), { recursive: true, force: true }); // from the vector template era
mkdirSync(join(OUT, 'png'), { recursive: true });
mkdirSync(PREVIEW, { recursive: true });
copyFileSync(FONTS.number, join(ROOT, 'public', 'fonts', 'jersey-15.ttf'));

const warnings = [];
const manifest = {
  generated: 'scripts/helmets/gen-helmets.mjs — edit teams.json, template.png or template.json and re-run; do not hand-edit',
  size: OUT_SIZE,
  number: { ...numberStyle, anchor: numberAnchor },
  teams: {},
};

for (const team of teams) {
  // White number, stroked in the team's first dark color: reads on the shell
  // and on light or dark app backgrounds alike.
  team.number ??= {
    fill: '#FFFFFF',
    stroke: [team.shell, team.stripe, team.textStroke, team.text].find((c) => luminance(c) < 0.2) ?? '#10131A',
  };
  // Outlined letters read by their fill or their outline, so one of the two
  // has to stand off the shell.
  const c = Math.max(contrast(team.text, team.shell), contrast(team.textStroke, team.shell));
  if (c < 3) warnings.push(`${team.abbr}: lettering ${team.text}/${team.textStroke} on shell ${team.shell} is only ${c.toFixed(2)}:1`);

  team.art = recolor(team);
  team.ai = {};
  for (const dir of ['left', 'right']) {
    const f = join(HERE, 'ai', `${team.abbr}-${dir}.png`);
    if (existsSync(f)) team.ai[dir] = `data:image/png;base64,${readFileSync(f).toString('base64')}`;
  }
  if (team.ai.left && !team.ai.right) warnings.push(`${team.abbr}: AI art for left only; right-facing named helmet uses the template`);
  const files = {};
  for (const dir of ['left', 'right']) {
    for (const plain of [false, true]) {
      const name = `${team.abbr}-${dir}${plain ? '-plain' : ''}`;
      writeFileSync(join(OUT, 'png', `${name}.png`), toPng(new Resvg(helmetSvg(team, team.art, dir, plain), { ...fontOpts(FONTS.decal), fitTo: { mode: 'width', value: OUT_SIZE } }).render()));
      files[`${dir}${plain ? 'Plain' : ''}`] = `/helmets/png/${name}.png`;
    }
  }
  manifest.teams[team.abbr] = {
    city: team.city, name: team.name,
    colors: { shell: team.shell, stripe: team.stripe, facemask: team.facemask, text: team.text, textStroke: team.textStroke },
    number: team.number,
    art: { left: team.ai.left ? 'ai' : 'template', right: team.ai.right ? 'ai' : 'template' },
    files,
  };
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

// Contact sheet: each team's named helmets, left and right, with sample numbers
// drawn the way the app should draw them.
const CELL = 200, COLS = 8;
const SAMPLES = ['1', '12', '88', '7'];
const cells = teams.flatMap((team, i) => ['left', 'right'].map((dir, j) => {
  const k = i * 2 + j;
  const x = (k % COLS) * CELL, y = Math.floor(k / COLS) * CELL;
  const svg = helmetSvg(team, team.art, dir, false).replace(/^<svg[^>]*>|<\/svg>\s*$/g, '');
  return `<g transform="translate(${x} ${y}) scale(${CELL / SIZE})">${svg}${numberSvg(team, dir, SAMPLES[k % SAMPLES.length])}</g>`;
}));
const rows = Math.ceil(cells.length / COLS);
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${COLS * CELL} ${rows * CELL}"><rect width="100%" height="100%" fill="#E9EBEF"/>${cells.join('')}</svg>`;
writeFileSync(join(PREVIEW, 'sheet.png'), new Resvg(sheet, fontOpts(FONTS.decal, FONTS.number)).render().asPng());

console.log(`✓ ${teams.length} teams → ${teams.length * 4} helmets in public/helmets/, sheet at scripts/helmets/preview/sheet.png`);
for (const w of warnings) console.log(`! ${w}`);
