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
//   --players a,b,c       only these slugs (comma-separated)
//   --limit N             stop after N players (after skip-existing filtering)
//   --concurrency N       parallel requests (default 3)
//   --model <id>          Gemini model (default gemini-2.5-flash-image)
//   --out <dir>           output root (default scripts/fantasy-avatars/out)
//   --force               regenerate even if the output PNG already exists
//   --dry-run             list what would be generated, no downloads/API calls

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

const STYLES = {
  dragonborn: 'as a fearsome dragonborn warrior — scaled draconic skin, small horns, glowing eyes',
  orc: 'as a battle-hardened orc — green-grey skin, tusks, tribal war paint',
  elf: 'as a regal high elf — pointed ears, luminous skin, silver circlet',
  dwarf: 'as a stout dwarven champion — braided beard, rune-etched armor',
  wizard: 'as an arcane wizard — wide-brimmed hat, crackling magical energy',
  knight: 'as an armored paladin knight — polished plate armor, heraldic colors',
  vampire: 'as an elegant vampire lord — pale skin, crimson eyes, high collar',
  werewolf: 'as a mid-transformation werewolf — fur, amber eyes, elongated jaw',
  robot: 'as a chrome battle android — panel seams, glowing circuit lines',
  zombie: 'as a gridiron zombie — weathered undead skin, glowing eyes, torn jersey',
};

// The wrapper around the style clause. Keeps team colors so avatars still read
// as "your player", and asks for a clean bust on transparent-friendly ground.
const promptFor = (clause) =>
  `Transform this NFL player headshot into a stylized fantasy character portrait: ${clause}. ` +
  `Keep the pose, framing, and jersey/team colors recognizable from the original photo. ` +
  `Render as a detailed pixel-art style bust portrait on a plain dark background, ` +
  `head and shoulders only, centered, no text or watermarks.`;

// ---- CLI ------------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name) => args.includes(`--${name}`);

const style = flag('style') ?? 'dragonborn';
const customPrompt = flag('prompt');
const onlyPlayers = flag('players')?.split(',').map((s) => s.trim()).filter(Boolean);
const limit = flag('limit') ? Number(flag('limit')) : Infinity;
const concurrency = flag('concurrency') ? Number(flag('concurrency')) : 3;
const model = flag('model') ?? 'gemini-2.5-flash-image';
const outRoot = flag('out') ?? path.join(HERE, 'out');
const force = has('force');
const dryRun = has('dry-run');

const clause = customPrompt ?? STYLES[style];
if (!clause) {
  console.error(`Unknown style "${style}". Presets: ${Object.keys(STYLES).join(', ')}`);
  console.error('Or pass --prompt "<style clause>" with your own --style name for the folder.');
  process.exit(1);
}
const prompt = promptFor(clause);

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey && !dryRun) {
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

const outDir = path.join(outRoot, style);
await mkdir(outDir, { recursive: true });
if (!force) {
  const before = queue.length;
  queue = queue.filter((p) => !existsSync(path.join(outDir, `${p.slug}.png`)));
  if (before !== queue.length) console.log(`Skipping ${before - queue.length} already-generated (use --force to redo).`);
}
queue = queue.slice(0, limit);

console.log(`Style "${style}" → ${outDir}`);
console.log(`Prompt: ${prompt}\n`);
console.log(`${queue.length} player(s) queued${Number.isFinite(limit) ? ` (limit ${limit})` : ''}, concurrency ${concurrency}, model ${model}`);

if (dryRun) {
  for (const p of queue) console.log(`  would generate: ${p.slug}  (${p.url})`);
  process.exit(0);
}

// ---- Generation ------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchHeadshot(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`headshot HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get('content-type')?.split(';')[0] || 'image/png';
  return { data: buf.toString('base64'), mime };
}

async function callGemini(headshot) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: headshot.mime, data: headshot.data } },
            { text: prompt },
          ],
        }],
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 300)}`);
    err.retryable = res.status === 429 || res.status >= 500;
    throw err;
  }
  const json = await res.json();
  const cand = json.candidates?.[0];
  const img = cand?.content?.parts?.find((p) => p.inlineData?.data || p.inline_data?.data);
  if (img) return Buffer.from((img.inlineData ?? img.inline_data).data, 'base64');
  // No image back — usually a policy refusal on identifiable people.
  const why = cand?.finishReason || json.promptFeedback?.blockReason ||
    cand?.content?.parts?.map((p) => p.text).filter(Boolean).join(' ').slice(0, 200) ||
    'no image in response';
  const err = new Error(why);
  err.refused = true;
  throw err;
}

const results = [];
async function generateOne(p) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const headshot = await fetchHeadshot(p.url);
      const png = await callGemini(headshot);
      await writeFile(path.join(outDir, `${p.slug}.png`), png);
      console.log(`  ok      ${p.slug}`);
      return { slug: p.slug, status: 'ok' };
    } catch (e) {
      if (e.refused) {
        console.warn(`  REFUSED ${p.slug} — ${e.message}`);
        return { slug: p.slug, status: 'refused', reason: e.message };
      }
      if (attempt < 3 && (e.retryable || e.code === 'ECONNRESET' || e.name === 'TypeError')) {
        const wait = 2000 * 2 ** (attempt - 1);
        console.warn(`  retry   ${p.slug} in ${wait / 1000}s — ${e.message}`);
        await sleep(wait);
        continue;
      }
      console.error(`  ERROR   ${p.slug} — ${e.message}`);
      return { slug: p.slug, status: 'error', reason: e.message };
    }
  }
}

let cursor = 0;
async function worker() {
  while (cursor < queue.length) {
    const p = queue[cursor++];
    results.push(await generateOne(p));
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));

// ---- Manifest & summary -----------------------------------------------------
const manifestPath = path.join(outDir, 'manifest.json');
let manifest = {};
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { /* first run */ }
for (const r of results) manifest[r.slug] = { status: r.status, ...(r.reason ? { reason: r.reason } : {}) };
await writeFile(manifestPath, JSON.stringify({ style, model, prompt, players: manifest }, null, 2));

const tally = results.reduce((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {});
console.log(`\nDone: ${tally.ok ?? 0} ok, ${tally.refused ?? 0} refused, ${tally.error ?? 0} error`);
console.log(`Manifest: ${manifestPath}`);
if (tally.refused) console.log('Refusals are usually Gemini declining identifiable-person edits; try rewording the prompt.');
