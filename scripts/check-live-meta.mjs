// Guard for the LIVE league's slug-meta overlay — the one the web's drip
// screens read through `slugMeta` for a team logo and an injury badge.
//
// Why an assertion and not a screen check: a wrong answer here does not error.
// A 2026 player the 2025 bake has never heard of resolves to `{ pos: 'WR',
// team: '' }`, and an empty team reads as a BYE on the board — a player who is
// playing, rendered as a player who is not. That is indistinguishable from a
// real bye by eye, which is why the app's boards carried this fix from 0200.1
// while the web's live screens quietly did without it until v0.337.2.
//
// The trap this file mostly exists for is the SECOND one: `slugMeta` consults
// the overlay BEFORE the bake, so an override is authoritative. The ESPN shape
// of `starters_json` is `{ slug, full, pos }` with NO team, so mapping a row
// straight into the overlay installs `team: ''` and MASKS the bake — taking a
// player who rendered correctly and turning him into a bye. The fix must only
// ever add information.
// Run: npx tsx scripts/check-live-meta.mjs
import { poolMetaRows } from '../packages/core/src/data/liveBoard.ts';
import {
  slugMeta, setSlugMetaOverrides, clearSlugMetaOverrides, slugSleeperId,
} from '../packages/core/src/data/slugMeta.ts';
import { BAKED_SLUGS } from '../packages/core/src/data/bakedSlugs.ts';

let fails = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}`);
  if (!cond) fails++;
};

// A slug the bake DOES know, to test masking against. Picked from the bake
// itself rather than hardcoded, so a re-bake can't silently invalidate this.
const bakedSlug = Object.keys(BAKED_SLUGS).find((s) => BAKED_SLUGS[s]?.team && BAKED_SLUGS[s]?.pos);
const bakedTeam = slugMeta(bakedSlug).team;
const bakedPos = slugMeta(bakedSlug).pos;

// ── 1. The Sleeper shape: slug + pos + team + id all present ───────────────
clearSlugMetaOverrides();
setSlugMetaOverrides(poolMetaRows([
  { player_slug: 'fake-rookie-rb', pos: 'RB', team: 'KC', sleeper_id: '99999' },
]));
ok(slugMeta('fake-rookie-rb').pos === 'RB', 'unbaked rookie takes the pool row position (not the WR fallback)');
ok(slugMeta('fake-rookie-rb').team === 'KC', 'unbaked rookie takes the pool row team (not the empty fallback)');
ok(slugSleeperId('fake-rookie-rb') === '99999', 'sleeper_id rides along on the same pass');

// ── 2. THE MASKING TRAP: an ESPN row carries pos but NO team ───────────────
// Mapped straight through this would install team:'' and beat the bake.
clearSlugMetaOverrides();
setSlugMetaOverrides(poolMetaRows([{ slug: bakedSlug, full: 'x', pos: bakedPos }]));
ok(slugMeta(bakedSlug).team === bakedTeam,
  `teamless ESPN row does NOT mask the baked team for ${bakedSlug} (still ${bakedTeam || "''"})`);

// ── 3. A teamless row for a slug NOTHING knows stays empty, not wrong ──────
clearSlugMetaOverrides();
setSlugMetaOverrides(poolMetaRows([{ slug: 'nobody-at-all', pos: 'TE' }]));
ok(slugMeta('nobody-at-all').pos === 'TE', 'position still installs when the row has no team');
ok(slugMeta('nobody-at-all').team === '', 'unknown-and-teamless resolves empty rather than inventing a team');

// ── 4. Rows that cannot contribute are dropped, not crashed on ─────────────
clearSlugMetaOverrides();
let threw = null;
try {
  setSlugMetaOverrides(poolMetaRows([
    {}, { slug: '' }, { slug: null, pos: 'RB' }, { player_slug: 'has-slug-only' },
  ]));
} catch (e) { threw = e; }
ok(!threw, `slug-less rows are skipped rather than throwing${threw ? ` (threw: ${threw.message})` : ''}`);
ok(poolMetaRows([{}, { slug: '' }]).length === 0, 'slug-less rows produce no override at all');

// ── 5. The overlay MERGES across reads (two rosters, two calls) ────────────
clearSlugMetaOverrides();
setSlugMetaOverrides(poolMetaRows([{ slug: 'a-player', pos: 'RB', team: 'SF' }]));
setSlugMetaOverrides(poolMetaRows([{ slug: 'b-player', pos: 'WR', team: 'DAL' }]));
ok(slugMeta('a-player').team === 'SF' && slugMeta('b-player').team === 'DAL',
  'a second install does not evict the first (both rosters resolve)');

// ── 6. Team codes are normalised to the slate's, as the bake's are ─────────
clearSlugMetaOverrides();
setSlugMetaOverrides(poolMetaRows([{ slug: 'rams-guy', pos: 'WR', team: 'LAR' }]));
ok(slugMeta('rams-guy').team === 'LA', 'LAR normalises to LA so the slug slate-gates to a real game');

clearSlugMetaOverrides();
console.log(fails ? `\n${fails} PROBE FAIL(s)` : '\nALL LIVE-META ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
