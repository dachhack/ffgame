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

if (fails) { console.log(`\n${fails} PLAY-REVEAL ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL PLAY-REVEAL ASSERTIONS PASSED');
