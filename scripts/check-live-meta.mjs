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
  slugMeta, setSlugMetaOverrides, clearSlugMetaOverrides, slugSleeperId, stripSlugTag, liveTeamFor,
} from '../packages/core/src/data/slugMeta.ts';
import { BAKED_SLUGS } from '../packages/core/src/data/bakedSlugs.ts';
import { PLAYER_BIO } from '../packages/core/src/data/playerBio.ts';
import { setTeamOverrides, clearTeamOverrides } from '../packages/core/src/data/playerTeam.ts';
import { BAKED_PBP_SEASON } from '../packages/core/src/data/realPbp.ts';

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

// ── 7. FIRST-NAME VARIANTS (v0.368.7, founder: "hibner is a TE") ───────────
// The directory bake files BAL TE `matt-hibner`; the live feed slugged him
// `matthew-hibner`, which nothing knew, so the box score defaulted him to WR.
// The variant fallback runs only when the exact slug resolves nowhere — an
// overlay entry for the exact slug still wins outright.
clearSlugMetaOverrides();
ok(slugMeta('matthew-hibner').pos === 'TE',
  `an unknown Matthew resolves through the bake's Matt (got ${slugMeta('matthew-hibner').pos})`);
ok(slugMeta('matthew-hibner').team === slugMeta('matt-hibner').team,
  'and carries the variant\'s team, live overrides included');
ok(slugMeta('matthew-zzz-nobody').pos === 'WR' && slugMeta('matthew-zzz-nobody').team === '',
  'a variant that matches nobody still degrades to the neutral default');
setSlugMetaOverrides(poolMetaRows([{ slug: 'matthew-hibner', pos: 'RB', team: 'KC' }]));
ok(slugMeta('matthew-hibner').pos === 'RB',
  'an exact-slug overlay beats the variant fallback (it only fills true unknowns)');

// ── 8. THE NAMESAKE TAG NEVER REACHES A NAME (v0.369.4) ────────────────────
// The worker mints `josh-johnson-qb` / `-<sleeperId>` for namesakes, and every
// prettifier title-cased the whole slug — the founder's "Josh Johnson Qb".
ok(stripSlugTag('josh-johnson-qb') === 'josh-johnson', 'a position tag strips for display');
ok(stripSlugTag('aj-green-cb') === 'aj-green' && stripSlugTag('some-guy-8122') === 'some-guy',
  'CB and sleeper-id tags strip too');
ok(stripSlugTag('bal-k') === 'bal-k' && stripSlugTag('atl-dst') === 'atl-dst',
  'team units keep their tag — the head must still hold a first + last name');
ok(stripSlugTag('ha-ha-clinton-dix') === 'ha-ha-clinton-dix' && stripSlugTag('justin-watson') === 'justin-watson',
  'ordinary names, hyphenated surnames included, are untouched');

// ── 7. liveTeamFor (v0.388.5): the one team rule for every live surface ─────
// A baked player who has MOVED since the bake: picked from the data, not
// hardcoded, so a re-bake that agrees with the directory can't invalidate it.
clearSlugMetaOverrides(); clearTeamOverrides();
const moved = Object.keys(BAKED_SLUGS).find((sl) => {
  const bio = PLAYER_BIO[sl];
  return bio?.team && BAKED_SLUGS[sl]?.team && bio.team !== BAKED_SLUGS[sl].team;
});
const LIVE = BAKED_PBP_SEASON + 1, BAKE = BAKED_PBP_SEASON;
ok(!!moved, `the directory knows at least one baked player who moved (${moved ?? 'none'})`);
if (moved) {
  const was = slugMeta(moved).team, now = PLAYER_BIO[moved].team;
  ok(liveTeamFor(moved, '', LIVE) === now,
    `${moved}: a live season answers the directory's current team (${now}), not the bake's (${was})`);
  ok(liveTeamFor(moved, was, LIVE) === now,
    `…and beats a STALE pool row still carrying the bake's team — the Doubs case`);
  ok(liveTeamFor(moved, '', BAKE) === was,
    `${moved}: the bake's own season still answers the bake's team — the 2025 replay is untouched`);
  ok(liveTeamFor(moved, 'XX', BAKE) === 'XX',
    'in the bake season the pool row still wins over the bake, as before');
  setTeamOverrides([{ slug: moved, team: 'ZZ' }]);
  ok(liveTeamFor(moved, was, LIVE) === 'ZZ', "the worker's override beats the directory in a live season");
  ok(liveTeamFor(moved, was, BAKE) === was, '…but never in the bake season');
  clearTeamOverrides();
}
ok(liveTeamFor('fresh-rookie-nobody-knows', 'KC', LIVE) === 'KC',
  'a rookie neither bake knows still takes the pool row team in a live season');
ok(liveTeamFor('fresh-rookie-nobody-knows', '', LIVE) === '',
  'unknown-and-teamless stays empty rather than inventing a team');
ok(liveTeamFor('bal-k', 'XX', LIVE) === 'BAL' && liveTeamFor('atl-dst', '', LIVE) === 'ATL',
  'K/DST answer from the team-keyed slug on every path');
ok(liveTeamFor(moved ?? 'x', 'lar', LIVE) !== 'LAR' || liveTeamFor('unknown-guy', 'lar', LIVE) === 'LA',
  'pool row teams are normalised to the slate\'s codes (LAR → LA)');

// ── 8. poolMetaRows takes the season, and the overlay follows the rule ────
if (moved) {
  clearSlugMetaOverrides();
  setSlugMetaOverrides(poolMetaRows([{ slug: moved, pos: BAKED_SLUGS[moved].pos, team: BAKED_SLUGS[moved].team }], LIVE));
  ok(slugMeta(moved).team === PLAYER_BIO[moved].team,
    'a live-season overlay carries the current team even from a stale row');
  clearSlugMetaOverrides();
  setSlugMetaOverrides(poolMetaRows([{ slug: moved, pos: BAKED_SLUGS[moved].pos, team: BAKED_SLUGS[moved].team }]));
  ok(slugMeta(moved).team === BAKED_SLUGS[moved].team,
    'with no season given the overlay behaves exactly as before');
}

clearSlugMetaOverrides();
console.log(fails ? `\n${fails} PROBE FAIL(s)` : '\nALL LIVE-META ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
