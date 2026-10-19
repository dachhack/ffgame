// Plays stay face down with their cards (v0.730.2).
//
// Founder, over a Weekly Cointest matchup with every card still on its back
// but "TEAM ⚡ UP" under both squads and "⚡ UP" on both RB1s: "Don't show
// that opponent or other teams have power ups applied until cards flip over."
// The rule is core's; both ContestMatchup builders must ask it.
// Run: npx tsx scripts/check-contest-play-reveal.mjs
import { readFileSync } from 'node:fs';
import { contestSpotPlayShown, contestSquadPlaysShown, contestGhostShown } from '../packages/core/src/engine/contest.ts';

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); if (!c) fails++; };
const spot = (o) => contestSpotPlayShown({ mineSpot: false, theirs: false, seated: true, slug: null, locked: false, ...o });

// ── the screenshot: their RB1 sealed, a play on it ───────────────────────
ok(!spot({ mineSpot: false, theirs: false, slug: null }), "the opponent's play on a face-down card is hidden");
ok(spot({ mineSpot: false, theirs: false, slug: 'bijan-robinson' }), 'it shows once that card turns');
ok(!spot({ mineSpot: false, seated: false, slug: null }) && !spot({ mineSpot: false, seated: false, theirs: true, slug: null }), 'another matchup: nothing shows on a face-down card');
// ── mine ──────────────────────────────────────────────────────────────────
ok(spot({ mineSpot: true, theirs: false, slug: null }) && spot({ mineSpot: true, theirs: false, slug: 'x' }), 'my own play on my spot always shows');
ok(spot({ mineSpot: false, theirs: true, seated: true, slug: null }), 'my Spy/Jinx aimed at their sealed spot shows to me');
// ── theirs aimed at me ────────────────────────────────────────────────────
ok(!spot({ mineSpot: true, theirs: true, slug: 'x', locked: false }), "their Jinx on my spot stays hidden before my player's kickoff");
ok(spot({ mineSpot: true, theirs: true, slug: 'x', locked: true }), 'and shows when his card turns for them (kickoff)');
// ── team plays ────────────────────────────────────────────────────────────
ok(contestSquadPlaysShown({ mine: true, slugs: [null, null] }), 'my team plays always show');
ok(!contestSquadPlaysShown({ mine: false, slugs: [null, undefined, null] }), "another squad's team plays hide while all its cards are down");
ok(contestSquadPlaysShown({ mine: false, slugs: [null, 'x'] }), 'and show once any of its cards turns');
ok(!spot({ ghost: true, started: false }) && spot({ ghost: true, started: true }) && spot({ mineSpot: true, ghost: true, started: false }), "another squad's phantom chip shows from the first kickoff, like its card (and the server, 0508)");
// ── the phantom ───────────────────────────────────────────────────────────
ok(contestGhostShown({ mine: true, started: false }) && !contestGhostShown({ mine: false, started: false }) && contestGhostShown({ mine: false, started: true }), "another squad's phantom stays on its back until the first kickoff");

for (const f of ['src/screens/ContestMatchup.tsx', 'apps/mobile/src/screens/ContestMatchup.tsx']) {
  const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  ok(src.includes("ghost: pl.id === 'ghost', started: !!st.started"), `${f}: the phantom's chip follows its card`);
  ok(`${f} asks core before drawing a play`.length > 0 && src.includes('contestSpotPlayShown({') && src.includes('contestSquadPlaysShown({') && src.includes('contestGhostShown({') && !src.includes('playAt(s, r)'),
    `${f}: spot chips, team chip and phantom all go through the reveal rule`);
}


// ── the server's twin (0508) names the same moments ───────────────────────
{
  const sql = readFileSync(new URL('../supabase/migrations/0508_contest_plays_face_down.sql', import.meta.url), 'utf8');
  const f2 = (re, msg) => ok(re.test(sql), msg);
  f2(/create or replace function _contest_visible_plays/, '0508 defines _contest_visible_plays');
  f2(/'home_plays', _contest_visible_plays\(/, 'contest_matchup sends home_plays through it');
  f2(/else _contest_visible_plays\(p_league, wk, m\.away_roster_id/, '…and away_plays');
  f2(/plays := _contest_visible_plays\(p_league, p_week, rid, opp, lg\.season, false\)/, 'contest_plays filters another seat the same way');
  f2(/'sealed', not open_,/, "contest_plays' sealed flag never says whether anything was held back");
}

// ── WHAT THE POWER-UPS DID (v0.730.19): "Did my power ups apply? Any way we can show the difference power ups make?"
{
  const { contestPlayEffect, signedPts } = await import('../packages/core/src/engine/contest.ts');
  // The founder's screen: his Josh Allen 18.3 → 21.2; their Bijan's Double or Nothing 7.3 → 0; a +15 Hail Mary banked.
  const rows = [
    { side: 'home', slot: 'QB', slug: 'josh-allen', score: 21.2, play: 'garbage-time', raw: 18.3 },
    { side: 'home', slot: 'RB1', slug: 'bijan-robinson', score: 7.3 },
    { side: 'home', slot: 'PLAY', slug: null, score: 15, play: 'hail-mary' },
    { side: 'away', slot: 'RB1', slug: 'bijan-robinson', score: 0, play: 'double-or-nothing', raw: 7.3 },
    { side: 'away', slot: 'QB', slug: 'josh-allen', score: 18.3, play: 'underdog', raw: 18.3 },   // a play that changed nothing (yet)
  ];
  const nm = (s) => ({ 'josh-allen': 'Josh Allen', 'bijan-robinson': 'Bijan Robinson' })[s] ?? s;
  const mine = contestPlayEffect(rows, 'home', { nameOf: nm });
  ok(mine.net === 17.9 && mine.parts.length === 2, `my side: Allen +2.9 and Hail Mary +15 = +17.9 (got ${mine.net}, ${mine.parts.length} parts)`);
  ok(mine.parts[0].label.includes('Josh Allen') && Math.abs(mine.parts[0].delta - 2.9) < 1e-9, 'the spot part names its player and its difference');
  const theirs = contestPlayEffect(rows, 'away', { nameOf: nm });
  ok(theirs.net === -7.3 && theirs.parts.length === 1, `their side: Double or Nothing missed, −7.3; an unchanged play is left out (got ${theirs.net})`);
  const sealed = contestPlayEffect(rows, 'away', { shown: () => false });
  ok(sealed.parts.length === 0 && sealed.net === 0, 'a sealed side shows nothing');
  ok(signedPts(2.9) === '+2.9' && signedPts(-7.3) === '−7.3' && signedPts(0) === '0.0', 'signed one decimal');
  for (const f of ['apps/mobile/src/screens/ContestMatchup.tsx', 'src/screens/ContestMatchup.tsx']) {
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    ok(src.includes('contestPlayEffect(m.state?.slots ?? [], s,') && src.includes('label={`⚡ ${signedPts(e.net)}`}'), `${f}: the scoreboard carries the power-up net`);
  }
  const phone = readFileSync(new URL('../apps/mobile/src/screens/ContestMatchup.tsx', import.meta.url), 'utf8');
  ok(/x\.side === s && x\.slot === 'PLAY'\)\) \{ pts \+= b\.score/.test(phone), 'phone: an event bonus counts in the points, as on the web');
}

if (fails) { console.log(`\n${fails} PLAY-REVEAL ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL PLAY-REVEAL ASSERTIONS PASSED');
