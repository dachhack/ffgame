// WATCHING A MATCHUP YOU ARE NOT IN (v0.739.0) — the board a league-mate gets.
//
// Founder: "I think we need a way for players to browse to other matchups
// happening in the league this week … Full board after kickoff." A member
// reads only the worker's published window rows (0532). This pins core's
// watchBoard: both sides' players come out of those rows, paired by roster
// slot; a Ghost or a Bye Steal is a score and not a player; the headline is
// the sum of the rows; a window with no row is not on the board (it is
// sealed), and the migration opens matchup_state and nothing else.
// Run: tsx scripts/check-matchup-watch.mjs
import { readFileSync } from 'node:fs';
import { watchBoard, watchSealedWindows } from '../packages/core/src/data/matchupWatch';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};

const order = ['tnf', 'early', 'late', 'snf', 'mnf'];
const states = [
  { game_window: 'early', home_score: 30.2, away_score: 0.6, slot_scores: [
    { side: 'away', slot: '1', slug: 'b-two', metric: 'recyd', score: 0.6 },
    { side: 'home', slot: '0', slug: 'a-one', metric: 'passyd', score: 12.5, hot: true },
    { side: 'home', slot: '1', slug: 'a-two', metric: 'rush', score: 3.7 },
    { side: 'home', slot: '2', slug: null, metric: 'ghost', score: 14 },
  ] },
  { game_window: 'tnf', home_score: 0, away_score: 13.1, slot_scores: [
    { side: 'home', slot: '0', slug: 'nyg-dst', metric: 'earn', score: 0 },
    { side: 'away', slot: '0', slug: 's-diggs', metric: 'recyd', score: 8.1, nuked: true },
  ] },
];
const b = watchBoard(states, order);
ok('windows come out in the week\'s own order', b.windows.map((w) => w.win).join() === 'tnf,early', b.windows.map((w) => w.win));
ok('the headline is the sum of the window rows', b.home === 30.2 && b.away === 13.7, [b.home, b.away]);
const tnf = b.windows[0], early = b.windows[1];
ok('a spot pairs both sides by roster slot', tnf.spots.length === 1 && tnf.spots[0].home?.slug === 'nyg-dst' && tnf.spots[0].away?.slug === 's-diggs', tnf.spots);
ok('each side carries its metric and its published score', tnf.spots[0].away?.metric === 'recyd' && tnf.spots[0].away?.score === 8.1 && tnf.spots[0].home?.score === 0);
ok('hot and nuked ride the cell', early.spots[0].home?.hot === true && tnf.spots[0].away?.nuked === true);
ok('a spot one side left empty is null on that side', early.spots[0].away === null && early.spots[1].away?.slug === 'b-two', early.spots);
ok('spots sort by slot', early.spots.map((s) => s.slot).join() === '0,1,2', early.spots.map((s) => s.slot));
ok('a Ghost scores and is not a player', early.spots[2].home?.phantom === 'ghost' && early.spots[2].home?.slug === null && early.spots[2].home?.score === 14, early.spots[2]);
ok('a window that published nothing is not on the board — it is listed as sealed',
  watchSealedWindows(states, order).join() === 'late,snf,mnf' && !b.windows.some((w) => w.win === 'late'));
ok('nothing published at all is an empty board, 0–0', watchBoard(null, order).windows.length === 0 && watchBoard([], order).home === 0);
ok('a window the slate does not know still shows, last', watchBoard([...states, { game_window: 'zzz', home_score: 1, away_score: 2 }], order).windows.at(-1).win === 'zzz');

// ── the server opens the published rows and nothing else ──
const sql = readFileSync(new URL('../supabase/migrations/0532_league_mates_watch_a_matchup.sql', import.meta.url), 'utf8')
  .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
ok('0532 re-creates matchup_state_read with the participant and admin doors kept',
  /create policy matchup_state_read on matchup_state[\s\S]*is_matchup_participant\(matchup_id\)[\s\S]*is_admin\(\)[\s\S]*matchup_state_open_to_league\(matchup_id\)/.test(sql));
ok('the league door is members only and never a sealed league', /is_league_member\(m\.league_id\)[\s\S]*not _league_sealed\(m\.league_id\)/.test(sql));
ok('0532 touches no pick and no power-up', !/sealed_pick|applied_state/.test(sql));

if (fails) { console.log(`\n${fails} MATCHUP-WATCH ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL MATCHUP-WATCH ASSERTIONS PASSED');
