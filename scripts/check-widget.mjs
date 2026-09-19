// THE HOME-SCREEN WIDGET'S WORDS (v0.421.0), checked in Node.
//
// The widget is repainted headlessly and cannot be watched in a debugger on a
// Sunday, so the one function that decides what it says is pinned here: at
// each moment of a week — before the first lock, during a window, between
// windows, after the final — with the seat as home and as away, on a bye, and
// with no matchup row at all. The league-choice helpers that make the ▸ tap
// cycle are pinned too, because a widget that outlives its league must fall
// forward rather than draw a hole.
import { summarize, widgetLeagues, pickWidgetLeague, nextWidgetLeague, cacheGet, cacheSet, rememberSnapshot, recallSnapshot, recallLeagues } from '../packages/core/src/data/widgetFeed';
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

const league = { id: 'L', name: 'Sunday Scaries', rosterId: 4, gameMode: 'drip' };
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

// ── v0.422.0: the window strip, who is still to play, hot slots ──
{
  const stateHot = [
    { game_window: wins[0].id, home_score: 12.4, away_score: 3.9, slot_scores: [{ side: 'home', slot: '1', slug: 'a', metric: 'm', score: 12.4, hot: true }, { side: 'away', slot: '1', slug: 'b', metric: 'm', score: 3.9 }] },
    { game_window: wins[1].id, home_score: 30.15, away_score: 41.05, slot_scores: [{ side: 'home', slot: '1', slug: 'c', metric: 'm', score: 30.15, hot: true }, { side: 'away', slot: '1', slug: 'd', metric: 'm', score: 20 }, { side: 'away', slot: '2', slug: 'e', metric: 'm', score: 21.05 }] },
  ];
  const picks = [
    { game_window: wins[0].id, roster_slot: '1', player_slug: 'a', metric_id: 'm' },
    { game_window: wins[1].id, roster_slot: '1', player_slug: 'c', metric_id: 'm' },
    { game_window: wins[1].id, roster_slot: '2', player_slug: 'f', metric_id: 'm' },
    { game_window: wins[2].id, roster_slot: '1', player_slug: 'g', metric_id: 'm' },
  ];
  // inside the second window: TNF final, SUN 1PM live, the rest sealed
  const s = summarize({ league, week: WEEK, matchup: matchup(), state: stateHot, teams, nowMs: kick(1) + 30 * 60_000, picks, pool: [], injuries: {} });
  ok('strip: one entry per window, in kickoff order, with each side\'s bank', s.windows.length === wins.length && s.windows[0].me === 12.4 && s.windows[0].them === 3.9 && s.windows[1].me === 30.2 && s.windows[1].them === 41.1, s.windows.slice(0, 2));
  ok('strip: phases read final / live / setup down the week', s.windows[0].phase === 'final' && s.windows[1].phase === 'live' && s.windows[2].phase === 'setup', s.windows.map((w) => w.phase));
  ok('hot counts MY hot slots only', s.hot === 2, s.hot);
  ok('yet to play: mine from my picks, theirs revealed where kicked and assumed full where sealed',
    s.left.me.playing === 2 && s.left.me.waiting === 1 && s.left.them.playing === 2 && s.left.them.waiting === wins.slice(2).reduce((n, w) => n + w.slots, 0), s.left);
  ok('away seat reads hot from the other side', summarize({ league: { ...league, rosterId: 7 }, week: WEEK, matchup: matchup(), state: stateHot, teams, nowMs: kick(1) + 60_000, picks: [], pool: [], injuries: {} }).hot === 0);
  ok('a classic seat (no picks readable) is not assessable and has no yet-to-play', (() => { const c = summarize({ league, week: WEEK, matchup: matchup(), state: stateHot, teams, nowMs: kick(1) + 60_000 }); return !c.assessable && c.left === null && c.lead === 'score' && c.windows.length === wins.length; })());
}

// ── v0.422.0: the lineup assessment ──
{
  // Teams from the synthetic slate above — everyone but Bye Guy has a game.
  const pool = [
    { slug: 'a', full: 'Josh Jacobs', team: 'BUF' }, { slug: 'b', full: 'Tyreek Hill', team: 'MIA' },
    { slug: 'c', full: 'CeeDee Lamb', team: 'CAR' }, { slug: 'x', full: 'Bye Guy', team: 'NYJ' },
  ];
  const pre = kick(0) - LOCK_LEAD_MS - 2 * 3_600_000; // two hours before the first lock
  const cap = (i) => wins[i].slots;
  // a full, sealed, healthy lineup
  const full = wins.flatMap((w, i) => Array.from({ length: cap(i) }, (_, k) => ({ game_window: w.id, roster_slot: String(k + 1), player_slug: k === 0 ? 'a' : 'c', metric_id: 'm' })));
  const ready = summarize({ league, week: WEEK, matchup: matchup('open'), state: [], teams, nowMs: pre, picks: full, pool, injuries: {} });
  ok('a full, sealed, healthy lineup is READY: no fixes', ready.assessable && ready.fixes.length === 0, ready.fixes);
  ok('…and before the first lock the LINEUP view still leads (there is nothing to score yet)', ready.lead === 'lineup', ready.lead);
  ok('the alarm names the first open window with zero empty', ready.alarm && ready.alarm.win === wins[0].id && ready.alarm.empty === 0, ready.alarm);

  // holes, an unsealed metric, an OUT starter, a bye starter
  const broken = [
    { game_window: wins[0].id, roster_slot: '1', player_slug: 'a', metric_id: null },      // TNF: no metric
    { game_window: wins[1].id, roster_slot: '1', player_slug: 'b', metric_id: 'm' },       // SUN 1PM: OUT
    { game_window: wins[1].id, roster_slot: '2', player_slug: 'x', metric_id: 'm' },       // SUN 1PM: bye
    // SUN 1PM slot 3 empty; every later window empty
  ];
  const b = summarize({ league, week: WEEK, matchup: matchup('open'), state: [], teams, nowMs: pre, picks: broken, pool, injuries: { b: 'O', c: 'Q' } });
  const kinds = b.fixes.map((f) => `${f.win}:${f.kind}`);
  ok('an unsealed metric is a fix in its window', kinds.includes(`${wins[0].id}:metric`), kinds);
  ok('an OUT starter is a fix, by short name', b.fixes.some((f) => f.kind === 'injury' && f.text === 'T. Hill is OUT'), b.fixes.filter((f) => f.kind === 'injury'));
  ok('QUESTIONABLE is not a fix (noise on a Sunday)', !b.fixes.some((f) => f.text.includes('QUESTIONABLE')));
  ok('a starter on bye is a fix', b.fixes.some((f) => f.kind === 'bye' && f.text === 'B. Guy is on BYE'), b.fixes.filter((f) => f.kind === 'bye'));
  // Expected empties per window: capacity minus what `broken` filled there.
  const filledIn = (id) => broken.filter((p) => p.game_window === id && p.player_slug).length;
  const expectEmpty = wins.map((w, i) => [w.id, Math.max(0, cap(i) - filledIn(w.id))]).filter(([, n]) => n > 0);
  const gotEmpty = b.fixes.filter((f) => f.kind === 'empty').map((f) => [f.win, Number(f.text.split(' ')[0])]);
  ok('empty slots are counted per window, capacity minus filled', JSON.stringify(gotEmpty) === JSON.stringify(expectEmpty), { gotEmpty, expectEmpty });
  ok('the empty-slot wording pluralises', b.fixes.filter((f) => f.kind === 'empty').every((f) => /^\d+ empty slots?$/.test(f.text) && (f.text.startsWith('1 ') ? f.text.endsWith('slot') : f.text.endsWith('slots'))));
  ok('the LINEUP view leads while there is something to fix', b.lead === 'lineup');
  ok('the alarm carries the first open window\'s empties', b.alarm.win === wins[0].id && b.alarm.empty === cap(0) - 1, b.alarm);

  // once every window is locked the assessment stops nagging
  const late = summarize({ league, week: WEEK, matchup: matchup(), state: [], teams, nowMs: kick(wins.length - 1) + 60_000, picks: broken, pool, injuries: { b: 'O' } });
  ok('locked windows cannot be fixed: no fixes, no alarm, SCORE leads', late.fixes.length === 0 && late.alarm === null && late.lead === 'score', { fixes: late.fixes, alarm: late.alarm, lead: late.lead });
  // mid-week: TNF locked, SUN still open with a hole → lineup leads even though the week is 'live'
  const mid = summarize({ league, week: WEEK, matchup: matchup(), state: [{ game_window: wins[0].id, home_score: 10, away_score: 2 }], teams, nowMs: kick(0) + 4 * 3_600_000, picks: broken, pool, injuries: {} });
  ok('between windows with a hole still open, LINEUP leads', mid.phase === 'live' && mid.lead === 'lineup' && !mid.fixes.some((f) => f.win === wins[0].id), { lead: mid.lead, wins: [...new Set(mid.fixes.map((f) => f.win))] });
  ok('a final matchup always leads with the score', summarize({ league, week: WEEK, matchup: matchup('final'), state: [], teams, nowMs: pre, picks: broken, pool, injuries: {} }).lead === 'score');
}

// ── which league the widget shows ──
{
  const enr = [
    { league_id: 'a', sleeper_roster_id: 1, league: { name: 'A', game_mode: 'classic' }, pick_user_id: 'owner' },
    { league_id: 'mock', sleeper_roster_id: 2, league: { name: 'Mock', is_mock: true } },
    { league_id: 'old', sleeper_roster_id: 3, archived: true, league: { name: 'Old' } },
    { league_id: 'b', sleeper_roster_id: 5, league: { name: 'B' } },
  ];
  const ls = widgetLeagues(enr);
  ok('mocks and archived leagues never reach a home screen', ls.map((l) => l.id).join(',') === 'a,b', ls);
  ok('game mode and the seat owner ride along; unset mode reads as drip', ls[0].gameMode === 'classic' && ls[0].pickUserId === 'owner' && ls[1].gameMode === 'drip', ls);
  ok('the stored choice wins while it is still a league you are in', pickWidgetLeague(ls, 'b').id === 'b');
  ok('a stored league you left falls forward to the first', pickWidgetLeague(ls, 'old').id === 'a');
  ok('no choice = the first', pickWidgetLeague(ls, null).id === 'a');
  ok('no leagues = null, not a crash', pickWidgetLeague([], 'a') === null && nextWidgetLeague([], 'a') === null);
  ok('▸ cycles and wraps', nextWidgetLeague(ls, 'a').id === 'b' && nextWidgetLeague(ls, 'b').id === 'a');
  ok('▸ from an unknown league starts at the first', nextWidgetLeague(ls, 'zzz').id === 'a');
}

// ── v0.422.1: the cache that makes a tap instant ──
{
  const t0 = 1_800_000_000_000;
  cacheSet('k', { a: 1 }, t0);
  ok('a fresh entry is served', JSON.stringify(cacheGet('k', 60_000, t0 + 30_000)) === '{"a":1}');
  ok('an entry past its lifetime is not', cacheGet('k', 60_000, t0 + 61_000) === null);
  ok('an entry from the future (clock went backwards) is not trusted', cacheGet('k', 60_000, t0 - 120_000) === null);
  ok('a miss is null, not undefined', cacheGet('nope', 60_000, t0) === null);
  cacheSet('n', null, t0);
  ok('a cached null reads as a miss (so the loader runs again)', cacheGet('n', 60_000, t0) === null);
  cacheSet('z', 0, t0);
  ok('a cached zero is a hit', cacheGet('z', 60_000, t0) === 0);
  const league2 = { id: 'L2', name: 'Other', rosterId: 1, gameMode: 'drip' };
  const snap = summarize({ league: league2, week: WEEK, matchup: null, state: [], teams: {}, nowMs: kick(0) });
  rememberSnapshot({ leagues: [league, league2], snapshot: snap });
  ok('the remembered picture comes back by league', recallSnapshot('L2')?.snapshot.leagueName === 'Other' && recallSnapshot('L2')?.leagues.length === 2);
  ok('a league never drawn has no picture', recallSnapshot('L9') === null);
  ok('the leagues list is remembered only by the feed (nothing wrote it here)', recallLeagues() === null);
}

if (fails) { console.log(`\n${fails} WIDGET ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL WIDGET ASSERTIONS PASSED');
