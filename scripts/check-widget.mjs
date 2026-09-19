// THE HOME-SCREEN WIDGET'S WORDS (v0.421.0), checked in Node.
//
// The widget is repainted headlessly and cannot be watched in a debugger on a
// Sunday, so the one function that decides what it says is pinned here: at
// each moment of a week — before the first lock, during a window, between
// windows, after the final — with the seat as home and as away, on a bye, and
// with no matchup row at all. The league-choice helpers that make the ▸ tap
// cycle are pinned too, because a widget that outlives its league must fall
// forward rather than draw a hole.
import { summarize, widgetLeagues, pickWidgetLeague, nextWidgetLeague } from '../packages/core/src/data/widgetFeed';
import { windowsForWeek, windowKickoffMs, LOCK_LEAD_MS, setRuntimeSlate } from '../packages/core/src/data/nflSlate';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};

const WEEK = 3;
// The baked slate carries no kickoff clocks (the app installs them from
// nfl_slate at runtime, as widgetSnapshot does); stand one up for week 3 —
// Thu 8:15 PM, Sun 1:00 / 4:25 / 8:20 PM, Mon 8:15 PM ET, in September 2026.
const et = (day, h, m) => Date.parse(`2026-09-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-04:00`);
setRuntimeSlate(WEEK, [
  { away: 'MIA', home: 'BUF', aScore: 0, hScore: 0, win: 'tnf', kickoff: et(24, 20, 15) },
  { away: 'ATL', home: 'CAR', aScore: 0, hScore: 0, win: 'early', kickoff: et(27, 13, 0) },
  { away: 'DEN', home: 'LAC', aScore: 0, hScore: 0, win: 'late', kickoff: et(27, 16, 25) },
  { away: 'KC', home: 'NYG', aScore: 0, hScore: 0, win: 'snf', kickoff: et(27, 20, 20) },
  { away: 'DET', home: 'BAL', aScore: 0, hScore: 0, win: 'mnf', kickoff: et(28, 20, 15) },
]);
const wins = windowsForWeek(WEEK);
const kick = (i) => windowKickoffMs(WEEK, wins[i].id);
ok('the baked slate knows week 3 kickoffs', wins.length >= 3 && kick(0) != null && kick(1) != null, wins.map((w) => w.id));

const league = { id: 'L', name: 'Sunday Scaries', rosterId: 4 };
const teams = { 4: { team_name: 'Taco Time Titans' }, 7: { team_name: 'Beach Day Ballers' } };
const matchup = (status = 'live') => ({ id: 'M', league_id: 'L', week: WEEK, status, lock_at: null, home_roster_id: 4, away_roster_id: 7, home_coin: null, away_coin: null });
const state = [
  { game_window: wins[0].id, home_score: 12.4, away_score: 3.9 },
  { game_window: wins[1].id, home_score: 30.15, away_score: 41.05 },
];

// ── before the first lock ──
{
  const s = summarize({ league, week: WEEK, matchup: matchup('open'), state: [], teams, nowMs: kick(0) - LOCK_LEAD_MS - 3_600_000 });
  ok('pre-week: phase pre, both names, zero scores', s.phase === 'pre' && s.me.name === 'Taco Time Titans' && s.them.name === 'Beach Day Ballers' && s.me.score === 0, s);
  ok('pre-week: the line promises the first lock', /^Locks /.test(s.line) && /\d/.test(s.line), s.line);
}
// ── inside the first window ──
{
  const s = summarize({ league, week: WEEK, matchup: matchup(), state, teams, nowMs: kick(0) + 30 * 60_000 });
  ok('live: phase live and the window named', s.phase === 'live' && s.line === `LIVE · ${wins[0].label}`, s.line);
  ok('live: scores are the SUM over windows, home side as me', s.me.score === 42.6 && s.them.score === 45, [s.me.score, s.them.score]);
  ok('live: rounded to a tenth', Number.isInteger(s.me.score * 10) && Number.isInteger(s.them.score * 10));
}
// ── away seat: the same rows read from the other side ──
{
  const away = { ...league, rosterId: 7 };
  const s = summarize({ league: away, week: WEEK, matchup: matchup(), state, teams, nowMs: kick(0) + 30 * 60_000 });
  ok('away seat: me is the away team and the scores swap', s.me.name === 'Beach Day Ballers' && s.me.score === 45 && s.them.score === 42.6, s);
}
// ── between windows: the first is final, the next not yet locked ──
{
  const now = kick(1) - LOCK_LEAD_MS - 20 * 60_000; // 20 min before the second window's lock
  const s = summarize({ league, week: WEEK, matchup: matchup(), state, teams, nowMs: now });
  ok('between windows: still the live week, naming the next lock', s.phase === 'live' && s.line.startsWith(`${wins[1].label} locks `), s.line);
}
// ── final ──
{
  const w = summarize({ league, week: WEEK, matchup: matchup('final'), state: [{ game_window: wins[0].id, home_score: 100, away_score: 80 }], teams, nowMs: kick(0) + 7 * 86_400_000 });
  ok('final: W with the score', w.phase === 'final' && w.line === 'FINAL · W 100–80', w.line);
  const l = summarize({ league, week: WEEK, matchup: matchup('final'), state: [{ game_window: wins[0].id, home_score: 80, away_score: 100 }], teams, nowMs: kick(0) });
  ok('final: L reads from my side', l.line === 'FINAL · L 80–100', l.line);
  const t = summarize({ league, week: WEEK, matchup: matchup('final'), state: [], teams, nowMs: kick(0) });
  ok('final: a 0–0 is a T, not a crash', t.line === 'FINAL · T 0–0', t.line);
}
// ── bye / no row ──
{
  const s = summarize({ league, week: WEEK, matchup: null, state: [], teams, nowMs: kick(0) });
  ok('no matchup row: a bye, opponent null, my name still shown', s.phase === 'bye' && s.them === null && s.me.name === 'Taco Time Titans' && /BYE/.test(s.line), s);
}
// ── missing names never blank the picture ──
{
  const s = summarize({ league, week: WEEK, matchup: matchup(), state, teams: {}, nowMs: kick(0) + 60_000 });
  ok('unknown names fall to "Your team" / "Opponent"', s.me.name === 'Your team' && s.them.name === 'Opponent', s);
}

// ── which league the widget shows ──
{
  const enr = [
    { league_id: 'a', sleeper_roster_id: 1, league: { name: 'A' } },
    { league_id: 'mock', sleeper_roster_id: 2, league: { name: 'Mock', is_mock: true } },
    { league_id: 'old', sleeper_roster_id: 3, archived: true, league: { name: 'Old' } },
    { league_id: 'b', sleeper_roster_id: 5, league: { name: 'B' } },
  ];
  const ls = widgetLeagues(enr);
  ok('mocks and archived leagues never reach a home screen', ls.map((l) => l.id).join(',') === 'a,b', ls);
  ok('the stored choice wins while it is still a league you are in', pickWidgetLeague(ls, 'b').id === 'b');
  ok('a stored league you left falls forward to the first', pickWidgetLeague(ls, 'old').id === 'a');
  ok('no choice = the first', pickWidgetLeague(ls, null).id === 'a');
  ok('no leagues = null, not a crash', pickWidgetLeague([], 'a') === null && nextWidgetLeague([], 'a') === null);
  ok('▸ cycles and wraps', nextWidgetLeague(ls, 'a').id === 'b' && nextWidgetLeague(ls, 'b').id === 'a');
  ok('▸ from an unknown league starts at the first', nextWidgetLeague(ls, 'zzz').id === 'a');
}

if (fails) { console.log(`\n${fails} WIDGET ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL WIDGET ASSERTIONS PASSED');
