// Guard for NAME RESOLUTION (v0.345.0) — who a name off a field belongs to.
//
// The 2026 identity audit measured the gap this closes. Of Sleeper's 647
// rookies, 646 carry NO espn_id, so the entire class resolves by NAME; in one
// real preseason game (WSH@DET, 2026-08-22) only 27 of 93 participants resolved
// by id and 4 names were ambiguous — two of them resolving to the WRONG man:
//
//   · DET DL Chris Smith's tackles → a TEAMLESS RB namesake (fantasy position
//     outranked being on a roster).
//   · WAS rookie CB Fred Davis II → RETIRED TE Fred Davis (normName strips the
//     "II", and the inactive TE's fantasy position won the tie).
//
// Two rules fix it, and this pins both: name lookups prefer the LIVING, and
// where the caller knows which club the name just appeared for, that fact beats
// any ranking. Slug MINTING is deliberately untouched — stored picks, rosters
// and bakes mean the historic holder by a slug — so the fixtures assert the
// resolution and the minting separately.
//
// Fixture, not the live directory: a probe that fetches 12MB of Sleeper would
// fail on their outage rather than on our regression. The shapes are copied
// from the real entries named above.
// Run: npx tsx scripts/check-name-resolve.mjs
import { buildPlayerIndex } from '../server/src/playerIndex.js';

let fails = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}`);
  if (!cond) fails++;
};

const P = (o) => ({ active: false, team: null, search_rank: 9999999, espn_id: null, gsis_id: null, ...o });
const DIRECTORY = {
  // — the two real misattributions —
  '1001': P({ full_name: 'Chris Smith', position: 'DL', team: 'DET', active: true, years_exp: 3 }),
  '1002': P({ full_name: 'Chris Smith', position: 'RB', team: null, active: true, years_exp: 1 }),
  '1003': P({ full_name: 'Fred Davis II', position: 'CB', team: 'WAS', active: true, years_exp: 0 }),
  '1004': P({ full_name: 'Fred Davis', position: 'TE', team: null, active: false, years_exp: 6 }),
  // — a live namesake pair on two different clubs: only the team can settle it —
  '1005': P({ full_name: 'Mike Williams', position: 'WR', team: 'NYJ', active: true, search_rank: 120 }),
  '1006': P({ full_name: 'Mike Williams', position: 'WR', team: 'KC', active: true, search_rank: 300 }),
  // — a star, and a stale duplicate of him: the 0199.4 case, still must hold —
  '1007': P({ full_name: 'Josh Allen', position: 'QB', team: 'BUF', active: true, search_rank: 4 }),
  '1008': P({ full_name: 'Josh Allen', position: 'LB', team: 'JAX', active: true, search_rank: 210 }),
  // — Sleeper spells the Rams LAR; the feeds now say LA (v0.344.0) —
  '1009': P({ full_name: 'Puka Nacua', position: 'WR', team: 'LAR', active: true, search_rank: 12 }),
  // — id-bearing player, to prove the id path still wins —
  '1010': P({ full_name: 'Drake Maye', position: 'QB', team: 'NE', active: true, search_rank: 30, espn_id: 4431452 }),
};

const idx = await buildPlayerIndex(DIRECTORY);

// ── 1. THE TWO MISATTRIBUTIONS ────────────────────────────────────────────
{
  const smith = idx.slugForName('Chris Smith');
  ok(idx.metaForSlug(smith)?.pos === 'DL',
    `THE POINT: a name resolves to the man ON A ROSTER, not the teamless namesake with the fantasier position (got ${smith})`);
  const davis = idx.slugForName('Fred Davis II');
  ok(idx.metaForSlug(davis)?.team === 'WAS',
    `a rookie whose suffix normName strips does not resolve to the retired namesake (got ${davis})`);
}

// ── 2. THE TEAM SETTLES WHAT RANKING CANNOT ───────────────────────────────
// Two live receivers, same name, different clubs. Ranking must pick one; only
// the caller's team makes it the RIGHT one.
{
  const jet = idx.slugForName('Mike Williams', 'NYJ');
  const chief = idx.slugForName('Mike Williams', 'KC');
  ok(idx.metaForSlug(jet)?.team === 'NYJ' && idx.metaForSlug(chief)?.team === 'KC',
    'THE POINT: two live namesakes resolve by the club the name appeared for — a fact, not a ranking');
  ok(jet !== chief, 'and they are genuinely two different players, not one slug answering twice');
  ok(idx.slugForName('Mike Williams') === jet,
    'with no team known, the better-ranked live candidate still answers');
  ok(idx.slugForName('Mike Williams', 'DEN') === jet,
    'a team NOBODY with that name plays for falls back to the ranking rather than returning nothing');
}

// ── 3. THE RAMS SPELLING (v0.344.0's two vocabularies) ────────────────────
{
  ok(idx.slugForName('Puka Nacua', 'LA') === 'puka-nacua',
    "the feed's LA finds a directory that says LAR");
  ok(idx.slugForName('Puka Nacua', 'LAR') === 'puka-nacua', "and LAR still finds him too");
}

// ── 4. MINTING IS UNTOUCHED ───────────────────────────────────────────────
// The QB owns `josh-allen` because stored picks and bakes mean the QB by it.
// That is slugRank's job and it must NOT follow the new liveRank.
{
  ok(idx.metaForSlug('josh-allen')?.pos === 'QB',
    'the star still OWNS the clean slug — resolution changed, minting did not');
  ok(idx.slugForName('Josh Allen', 'JAX') === 'josh-allen-lb',
    'and the linebacker resolves to his own suffixed slug when the name comes off JAX');
  ok(idx.metaForSlug('chris-smith')?.pos === 'RB',
    'the RB keeps the clean chris-smith slug he was minted (a stored pick still means him)');
}

// ── 5. THE ID PATH IS UNCHANGED ───────────────────────────────────────────
{
  ok(idx.slugForEspnId(4431452) === 'drake-maye', 'an espn_id still resolves directly');
  ok(idx.slugForEspnId(999999) === null, 'an unknown id resolves to nothing rather than guessing a name');
}

// ── 6. NOTHING RESOLVES OUT OF THIN AIR ───────────────────────────────────
{
  ok(idx.slugForName('Nobody Here') === null, 'an unknown name is null, with or without a team');
  ok(idx.slugForName('Nobody Here', 'DET') === null, 'including when a team is supplied');
  ok(idx.nameCount('Chris Smith') === 2 && idx.nameCount('Puka Nacua') === 1,
    'nameCount reports how many men share a name (1 = no namesake can be confused for him)');
}

console.log(fails ? `\n${fails} PROBE FAIL(s)` : '\nALL NAME-RESOLVE ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
