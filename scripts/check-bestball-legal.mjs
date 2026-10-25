// THE ROSTER HAS TO BE LEGAL (0360): an illegal roster's best-ball spots don't
// fill. Pinned here because the worker and both boards read the one flag
// (ClassicSide.bestballOff), and a board that filled while the worker didn't
// would show points the final will never have.
import { readFileSync } from 'node:fs';
import { resolveClassicMatchup, classicLineup } from '../packages/core/src/engine/classic';
import { installRealWeek } from '../packages/core/src/data/realPbp';
import { clearLeagueScoring } from '../packages/core/src/engine/leagueScoring';
import { clearLeagueFlags, clearLeagueAdjustments } from '../packages/core/src/data/commish';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};
const WEEK = 1;
installRealWeek(WEEK, JSON.parse(readFileSync(new URL('../public/pbp/w1.json', import.meta.url))));
clearLeagueScoring(); clearLeagueFlags(); clearLeagueAdjustments();
const ZERO = { games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0 };
const mk = (id, pos, team) => ({ id, name: id, full: id, pos, team, stats: { ...ZERO } });
const RB = mk('saquon-barkley', 'RB', 'PHI');
const WR = mk('ja-marr-chase', 'WR', 'CIN');
const QB = mk('josh-allen', 'QB', 'BUF');

// QB started by hand; FLEX is best ball; the roster has a back and a receiver for it.
const side = (off) => ({ picks: [{ slot: 'QB', player: QB }, { slot: 'FLEX', player: WR }], roster: [QB, RB, WR], hasLineup: true, bestball: ['FLEX'], bestballOff: off });
const legal = resolveClassicMatchup(side(false), { picks: [], hasLineup: true }, WEEK, { ppr: 1 });
const illegal = resolveClassicMatchup(side(true), { picks: [], hasLineup: true }, WEEK, { ppr: 1 });
const flexOf = (r) => r.slots.find((x) => x.side === 'home' && x.slot === 'FLEX');
ok('legal: the best-ball FLEX fills from the roster', !!flexOf(legal)?.slug, legal.slots);
ok('illegal: the FLEX stays empty', !flexOf(illegal), illegal.slots);
ok('illegal: the stored pick in a best-ball spot is still ignored, not promoted', !classicLineup(side(true), WEEK, { ppr: 1 }).some((p) => p.slot === 'FLEX'));
ok('illegal: the hand-set QB still scores', illegal.slots.some((x) => x.slot === 'QB' && x.slug === QB.id));
ok('illegal scores less by exactly the fill', Math.abs(legal.home - illegal.home - (flexOf(legal)?.score ?? 0)) < 0.051, { legal: legal.home, illegal: illegal.home });
ok('the flag is per side: the other side is untouched', legal.away === illegal.away);

// BEST BALL GOES OFF ONLY FOR A REAL OVERFLOW (0523, v0.733.1). Founder, on a
// healed player stuck on IR switching a team's best ball off: "healthy guys
// in IR shouldn't block the best ball action". A stash problem still freezes
// the lineup (`issues`), but the best-ball switch reads `bestball_off`.
const sql0523 = readFileSync(new URL('../supabase/migrations/0523_best_ball_needs_a_real_overflow.sql', import.meta.url), 'utf8');
ok('0523: league_illegal_rosters (the worker\'s best-ball read) lists only overflow seats',
  /function league_illegal_rosters[\s\S]*?roster_bestball_off\(m\.league_id, m\.sleeper_roster_id\)/.test(sql0523));
ok('0523: roster_bestball_off never asks about IR/OUT/taxi designations',
  !/ir_tags|out_tags|max_exp|injury_status/.test(sql0523.slice(sql0523.indexOf('function roster_bestball_off'), sql0523.indexOf('function league_roster_issues'))));
for (const f of ['../apps/mobile/src/ui/ClassicBoard.tsx', '../src/screens/ClassicBoard.tsx']) {
  const src = readFileSync(new URL(f, import.meta.url), 'utf8');
  ok(`${f.split('/').slice(-3).join('/')}: the best-ball fill switches on bestball_off, not every issue`,
    /const off = \(rid[^\n]*!!bbOff\[String\(rid\)\]/.test(src) && /setBbOff\(r\.bestball_off \?\? r\.issues/.test(src));
}

// THE BANNER IS YOURS ONLY (v0.712.6, founder: "I don't need the full alerts
// for when the opposing team doesn't have a legal roster. That's their
// problem"). Both boards still compute either side's issue (best ball reads
// it), but the banner returns before drawing anything that isn't yours.
for (const f of ['apps/mobile/src/ui/ClassicBoard.tsx', 'src/screens/ClassicBoard.tsx']) {
  const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  ok(`${f}: the illegal-roster banner skips the opponent`, /const mineSide = i === 0 && !browsing;[\s\S]{0,300}if \(!mineSide\) return null;/.test(src));
}

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log('\nbestball-legal: all ok');
