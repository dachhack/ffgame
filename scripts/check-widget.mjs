// THE HOME-SCREEN WIDGET'S WORDS (v0.421.0), checked in Node.
//
// The widget is repainted headlessly and cannot be watched in a debugger on a
// Sunday, so the one function that decides what it says is pinned here: at
// each moment of a week — before the first lock, during a window, between
// windows, after the final — with the seat as home and as away, on a bye, and
// with no matchup row at all. The league-choice helpers that make the ▸ tap
// cycle are pinned too, because a widget that outlives its league must fall
// forward rather than draw a hole.
import { summarize, widgetLeagues, pickWidgetLeague, nextWidgetLeague, cacheGet, cacheSet, rememberSnapshot, recallSnapshot, recallLeagues, SWAP_MIN_GAIN, packRows, shownWidgetLeagues, widgetHiddenLeagues, setWidgetHiddenLeagues } from '../packages/core/src/data/widgetFeed';
import { classicSlots } from '../packages/core/src/engine/classic';
import { windowsForWeek, windowKickoffMs, LOCK_LEAD_MS, setRuntimeSlate } from '../packages/core/src/data/nflSlate';
import { alertCount, alertsSummary, spotLabel, fieldGames, minesByTeam, nextDownFrom, lineupReport } from '../packages/core/src/data/widgetExtras';
import { setLiveGameFeed, feedRowsToWeek } from '../packages/core/src/data/gameFeed';
import { takeTapLock, releaseTapLock } from '../apps/mobile/src/widget/inert';

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
  const s = summarize({ league, week: WEEK, matchup: null, state: [], teams, nowMs: kick(0), weekScheduled: true });
  ok('no matchup row in a scheduled week: a bye, opponent null, my name still shown', s.phase === 'bye' && s.them === null && s.me.name === 'Taco Time Titans' && /BYE/.test(s.line), s);
  // A BYE NEEDS EVIDENCE (v0.433.6). Founder: "Looks like it assumes your team
  // is on a bye if there is no data. Let's not do that."
  const none = summarize({ league, week: WEEK, matchup: null, state: [], teams, nowMs: kick(0) });
  ok('no matchup row and no word on the week: NOT a bye — no matchup', none.phase === 'idle' && none.them === null && /NO MATCHUP/.test(none.line) && !/BYE/.test(none.line), none);
  const unbuilt = summarize({ league, week: WEEK, matchup: null, state: [], teams, nowMs: kick(0), weekScheduled: false });
  ok('no matchup row in a week with no matchups at all: no matchup, not a bye', unbuilt.phase === 'idle' && /NO MATCHUP/.test(unbuilt.line), unbuilt);
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
    { slug: 'd', full: 'Dan Denver', team: 'DEN' },   // SUN 4PM: can fill that window's hole
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
  const expectHoles = wins.map((w, i) => [w.id, Math.max(0, cap(i) - filledIn(w.id))]).filter(([, n]) => n > 0);
  const gotHoles = b.fixes.filter((f) => f.kind === 'empty' || f.kind === 'none').map((f) => [f.win, Number(f.text.split(' ')[0])]);
  ok('empty slots are counted per window, capacity minus filled', JSON.stringify(gotHoles) === JSON.stringify(expectHoles), { gotHoles, expectHoles });
  // v0.500.0: a hole someone on the roster can fill is EMPTY; a hole in a
  // window nobody rostered plays in is NONE (SNF: KC/NYG, MNF: DET/BAL).
  const kindOf = (id) => b.fixes.filter((f) => f.win === id && (f.kind === 'empty' || f.kind === 'none')).map((f) => f.kind).join();
  ok('a hole the roster can fill is EMPTY', kindOf('late') === 'empty', kindOf('late'));
  ok('a hole nobody on the roster plays in is NONE', kindOf('snf') === 'none' && kindOf('mnf') === 'none', [kindOf('snf'), kindOf('mnf')]);
  ok('the NONE wording names the roster', b.fixes.filter((f) => f.kind === 'none').every((f) => /^\d+ slots? nobody on the roster can fill$/.test(f.text)), b.fixes.filter((f) => f.kind === 'none'));
  ok('the NONE cards match the NONE fixes', b.cards.filter((c) => c.status === 'none').map((c) => c.win).join() === 'snf,mnf', b.cards.filter((c) => c.status === 'none'));
  // An OUT man cannot fill a hole: rule Dan Denver out and SUN 4PM is NONE too.
  const outD = summarize({ league, week: WEEK, matchup: matchup('open'), state: [], teams, nowMs: pre, picks: broken, pool, injuries: { d: 'O' } });
  ok('a player ruled OUT is no candidate for a hole', outD.cards.find((c) => c.win === 'late').status === 'none', outD.cards.find((c) => c.win === 'late'));
  // No roster read at all is no claim: every hole stays EMPTY.
  const blind = summarize({ league, week: WEEK, matchup: matchup('open'), state: [], teams, nowMs: pre, picks: broken, pool: [], injuries: {} });
  ok('with no roster read, a hole is EMPTY, never NONE', !blind.cards.some((c) => c.status === 'none'), blind.cards.map((c) => c.status));
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

// ── v0.503.0: the leagues the widget shows, picked in Settings ──
{
  const A = { id: 'A', name: 'A', rosterId: 1, gameMode: 'drip' }, B = { id: 'B', name: 'B', rosterId: 2, gameMode: 'classic' }, C3 = { id: 'C3', name: 'C', rosterId: 3, gameMode: 'drip' };
  ok('shown: nothing hidden shows every league', shownWidgetLeagues([A, B, C3], new Set()).map((l) => l.id).join() === 'A,B,C3');
  ok('shown: a hidden league is left out, order kept', shownWidgetLeagues([A, B, C3], new Set(['B'])).map((l) => l.id).join() === 'A,C3');
  ok('shown: hiding every league hides none (a widget must draw something)', shownWidgetLeagues([A, B], new Set(['A', 'B'])).length === 2);
  ok('shown: a stale hidden id (a league since left) is harmless', shownWidgetLeagues([A], new Set(['gone'])).map((l) => l.id).join() === 'A');
  ok('hidden: nothing stored reads as an empty set', widgetHiddenLeagues().size === 0);
  setWidgetHiddenLeagues(['B', 'B']);
  ok('hidden: the list round-trips through storage, deduplicated', [...widgetHiddenLeagues()].join() === 'B');
  cacheSet('leagues', [A, B, C3]);
  ok('hidden: the remembered list ▸ NEXT walks leaves the hidden league out', recallLeagues()?.map((l) => l.id).join() === 'A,C3', recallLeagues());
  setWidgetHiddenLeagues([]);
  ok('hidden: switched back on, it is back', recallLeagues()?.map((l) => l.id).join() === 'A,B,C3');
}

// ── THE CARDS (v0.433.9): every slot of every window, empties as the warning ──
// The check's slate carries one game per window, so every window holds one
// slot here: TNF live, SUN 1PM a player without a metric, SUN 4PM nobody (the
// warning), SNF set.
{
  const pool = [{ slug: 'a', full: 'Aaron Guy', team: 'BUF', pos: 'QB' }, { slug: 'x', full: 'Xavier Guy', team: 'ATL', pos: 'RB' }, { slug: 'z', full: 'Zed Guy', team: 'KC', pos: 'WR' },
    { slug: 'd', full: 'Dan Denver', team: 'DEN', pos: 'TE' }];   // benched: he could fill SUN 4PM
  const picks = [
    { game_window: wins[0].id, roster_slot: '1', player_slug: 'a', metric_id: 'pass_yd' },   // TNF: live
    { game_window: wins[1].id, roster_slot: '1', player_slug: 'x', metric_id: null },        // SUN 1PM: no metric
    { game_window: wins[3].id, roster_slot: '1', player_slug: 'z', metric_id: 'recyd' },     // SNF: set
  ];
  const images = { a: 'https://a.espncdn.com/i/headshots/nfl/players/full/1.png' };
  const st = [{ game_window: wins[0].id, home_score: 9.1, away_score: 0, slot_scores: [{ side: 'home', slot: '1', slug: 'a', metric: 'pass_yd', score: 9.1, hot: true }] }];
  const s = summarize({ league, week: WEEK, matchup: matchup(), state: st, teams, nowMs: kick(0) + 30 * 60_000, picks, pool, images, injuries: { z: 'Q' } });
  const card = (snap, i) => snap.cards.find((c) => c.win === wins[i].id);
  ok('cards: a pick carries his injury designation (v0.503.0)', card(s, 3).injury === 'Q' && card(s, 0).injury === null && card(s, 2).injury === null, [card(s, 3).injury, card(s, 0).injury]);
  ok('cards: one per slot of every window, in kickoff order', s.cards.length === wins.length && s.cards.map((c) => c.win).join() === wins.map((w) => w.id).join(), s.cards.map((c) => `${c.win}:${c.slot}`));
  ok('cards: a live pick carries its points, its hot streak, its name and its photo', card(s, 0).status === 'live' && card(s, 0).points === 9.1 && card(s, 0).hot && card(s, 0).name === 'A. Guy' && card(s, 0).image === images.a, card(s, 0));
  ok('cards: an open slot with nobody in it is EMPTY — the warning', card(s, 2).status === 'empty' && card(s, 2).slug === null && card(s, 2).name === '', card(s, 2));
  ok('cards: a player without a metric in an open window is UNSEALED', card(s, 1).status === 'unsealed' && card(s, 1).metric === null && card(s, 1).image === null, card(s, 1));
  ok('cards: a set pick names its metric', card(s, 3).status === 'set' && typeof card(s, 3).metric === 'string' && card(s, 3).metric.length > 0, card(s, 3));
  // A minute before the late window kicks: it has locked with nobody in it — MISSED; SNF still SET; the early pick is on the field.
  const locked = summarize({ league, week: WEEK, matchup: matchup(), state: st, teams, nowMs: kick(2) - 60_000, picks, pool, images });
  ok('cards: a window that locked with nobody in it is MISSED, a set pick elsewhere stays SET', card(locked, 2).status === 'missed' && card(locked, 3).status === 'set', [card(locked, 2), card(locked, 3)]);
  // A minute before SNF kicks: the SNF pick is SEALED, no points yet.
  const sealed = summarize({ league, week: WEEK, matchup: matchup(), state: st, teams, nowMs: kick(3) - 60_000, picks, pool, images });
  ok('cards: once its window locks a pick is SEALED with no points', card(sealed, 3).status === 'sealed' && card(sealed, 3).points === null, card(sealed, 3));
  const fin = summarize({ league, week: WEEK, matchup: matchup('final'), state: st, teams, nowMs: kick(4) + 5 * 3_600_000, picks, pool, images });
  ok('cards: at the final a scored pick is FINAL with its points', card(fin, 0).status === 'final' && card(fin, 0).points === 9.1, card(fin, 0));
  // v0.500.0: each pick carries his own game's kickoff and his metric id.
  ok('cards: a pick carries his game\'s kickoff', card(s, 3).kick === kick(3) && card(s, 2).kick === null, [card(s, 3).kick, card(s, 2).kick]);
  ok('cards: a pick carries his metric id', card(s, 0).metricId === 'pass_yd' && card(s, 1).metricId === null, [card(s, 0).metricId, card(s, 1).metricId]);
  const fgPicks = picks.map((p) => (p.player_slug === 'a' ? { ...p, metric_id: 'fg' } : p));
  ok('cards: a Field General is marked by his metric id', card(summarize({ league, week: WEEK, matchup: matchup(), state: st, teams, nowMs: kick(0) + 30 * 60_000, picks: fgPicks, pool, images }), 0).metricId === 'fg');
  ok('cards: a classic seat (not assessable) has none', summarize({ league: { ...league, gameMode: 'classic' }, week: WEEK, matchup: matchup(), state: st, teams, nowMs: kick(0) }).cards.length === 0);
}

// ── THE STANDING (v0.500.0): my record and place, off the league table ──
{
  const table = [
    { roster_id: 7, team: 'Beach Day Ballers', wins: 3, losses: 0, ties: 0, pf: 300, pa: 200 },
    { roster_id: 4, team: 'Taco Time Titans', wins: 2, losses: 1, ties: 0, pf: 280, pa: 250 },
    { roster_id: 9, team: 'Third Wheel', wins: 0, losses: 3, ties: 0, pf: 150, pa: 300 },
  ];
  const s = summarize({ league, week: WEEK, matchup: matchup(), state, teams, nowMs: kick(0) + 30 * 60_000, standings: table });
  ok('standing: my record and my place in the table, out of how many', JSON.stringify(s.standing) === JSON.stringify({ wins: 2, losses: 1, ties: 0, place: 2, of: 3 }), s.standing);
  ok('standing: no table, no claim', summarize({ league, week: WEEK, matchup: matchup(), state, teams, nowMs: kick(0) }).standing === null);
  ok('standing: a seat missing from the table has none', summarize({ league: { ...league, rosterId: 99 }, week: WEEK, matchup: null, state: [], teams, nowMs: kick(0), standings: table }).standing === null);
}

// ── ROWS OF WINDOWS (v0.500.0): fit side by side, else a new row, never cut ──
{
  const j = (x) => JSON.stringify(x);
  ok('rows: windows that fit share a row, in order', j(packRows([50, 100, 60], 300, 6)) === j([[0, 1, 2]]), packRows([50, 100, 60], 300, 6));
  ok('rows: the gap counts — a window that fits only without it starts a new row', j(packRows([100, 100], 204, 6)) === j([[0], [1]]) && j(packRows([100, 100], 206, 6)) === j([[0, 1]]));
  ok('rows: a window that will not fit starts the next row, and later ones follow it', j(packRows([80, 210, 70, 140, 70], 300, 6)) === j([[0, 1], [2, 3, 4]]), packRows([80, 210, 70, 140, 70], 300, 6));
  ok('rows: order is kept — no window jumps back to fill an earlier gap', j(packRows([200, 150, 50], 300, 6)) === j([[0], [1, 2]]), packRows([200, 150, 50], 300, 6));
  ok('rows: a window wider than a row takes a row of its own', j(packRows([80, 400, 80], 300, 6)) === j([[0], [1], [2]]), packRows([80, 400, 80], 300, 6));
  ok('rows: nothing to pack, no rows', j(packRows([], 300, 6)) === '[]');
}

// ── CLASSIC (v0.433.2): projected finals and the spots that want attention ──
// Founder: "For classic leagues, let's show predicted score rather than
// current… empty starting spots, starting spots with out/bye players, and
// starters where a player that is projected to score 2+ more points is on the
// bench and could replace."
{
  const cl = { id: 'C', name: 'Kickoff League', rosterId: 4, gameMode: 'classic' };
  const slots = classicSlots({ QB: 1, RB: 2, WR: 1, FLEX: 1 });   // QB, RB1, RB2, WR, FLEX
  const slotOf = (type) => slots.find((d) => d.slot === type).slot;
  // Teams on the week-3 runtime slate above: BUF/MIA (TNF), ATL/CAR (early),
  // DEN/LAC (late), KC/NYG (SNF), DET/BAL (MNF). PIT is not on it: a bye.
  const P = (slug, full, pos, team) => ({ slug, full, pos, team });
  const roster = [
    P('josh-allen', 'Josh Allen', 'QB', 'BUF'),
    P('eli-heidenreich', 'Eli Heidenreich', 'RB', 'ATL'),
    P('kenny-gainwell', 'Kenny Gainwell', 'RB', 'DEN'),
    P('bijan-robinson', 'Bijan Robinson', 'RB', 'ATL'),
    P('aj-brown', 'AJ Brown', 'WR', 'KC'),
    P('george-pickens', 'George Pickens', 'WR', 'PIT'),
    P('jaxon-smith-njigba', 'Jaxon Smith-Njigba', 'WR', 'DET'),
    P('travis-kelce', 'Travis Kelce', 'TE', 'KC'),
  ];
  const proj = { 'josh-allen': 21.6, 'eli-heidenreich': 0.6, 'kenny-gainwell': 11.9, 'bijan-robinson': 22.2, 'aj-brown': 15.3, 'george-pickens': 12.1, 'jaxon-smith-njigba': 14.4, 'travis-kelce': 12.5 };
  const injuries = { 'aj-brown': 'IR' };
  // The caller's slateAwareProj zeroes a bye and a ruled-out man; the check's
  // stand-in does the same from the fixture.
  const projOf = (p) => (injuries[p.id] === 'IR' || p.team === 'PIT' ? 0 : proj[p.id] ?? 0);
  const pick = (slot, slug) => ({ game_window: 'wk', roster_slot: slot, player_slug: slug, metric_id: null, locked: false });
  const myPicks = [pick(slotOf('QB'), 'josh-allen'), pick(slotOf('RB1'), 'eli-heidenreich'), pick(slotOf('WR'), 'aj-brown'), pick(slotOf('FLEX'), 'george-pickens')];   // RB2 has no row
  const theirRoster = [P('lamar-jackson', 'Lamar Jackson', 'QB', 'BAL'), P('derrick-henry', 'Derrick Henry', 'RB', 'BAL'), P('rico-dowdle', 'Rico Dowdle', 'RB', 'CAR'), P('drake-london', 'Drake London', 'WR', 'ATL'), P('bucky-irving', 'Bucky Irving', 'RB', 'MIA')];
  const theirProj = { 'lamar-jackson': 20, 'derrick-henry': 18, 'rico-dowdle': 10, 'drake-london': 13, 'bucky-irving': 12 };
  const projBoth = (p) => (theirProj[p.id] != null ? theirProj[p.id] : projOf(p));
  const cteams = { 4: { team_name: 'Steelers' }, 7: { team_name: 'Ravens' } };
  const cmatch = (status = 'open') => ({ ...matchup(status), league_id: 'C' });
  const classic = (over = {}) => ({ slots, bestball: [], picks: myPicks, roster, theirPicks: [], theirRoster, projOf: projBoth, ...over });

  // Before anything kicks off.
  const pre = summarize({ league: cl, week: WEEK, matchup: cmatch(), state: [], teams: cteams, injuries, nowMs: kick(0) - LOCK_LEAD_MS - 3_600_000, classic: classic() });
  ok('classic: the scores are projected', pre.projected === true && pre.themLive === false, pre);
  ok('classic: my projected final sums the starters — QB 21.6 + RB1 0.6 + RB2 empty 0 + WR on IR 0 + FLEX on bye 0', pre.me.score === 22.2, pre.me.score);
  ok('classic: an opponent with no rows is fielded from their roster (QB 20 + RB 18 + RB 12 + WR 13 + FLEX 10)', pre.them.score === 73, pre.them.score);
  ok('classic: not assessable, no flip — the fixes live on the score card', pre.assessable === false && pre.lead === 'score');
  const byKind = Object.fromEntries(pre.fixes.map((f) => [f.kind, f]));
  ok('classic: the empty RB 2 is a fix, with the best bench back to start', byKind.empty?.winLabel === 'RB 2' && /empty · start B\. Robinson 22\.2/.test(byKind.empty?.text), byKind.empty);
  ok('classic: the IR receiver is a fix, with the bench receiver to start', byKind.injury?.winLabel === 'WR' && /A\. Brown is IR · start J\. Smith-Njigba 14\.4/.test(byKind.injury?.text), byKind.injury);
  ok('classic: the bye flex is a fix; the next best bench man (Kelce, the WR is spoken for) is suggested', byKind.bye?.winLabel === 'FLEX' && /G\. Pickens is on BYE · start T\. Kelce 12\.5/.test(byKind.bye?.text), byKind.bye);
  ok('classic: Heidenreich at RB 1 gets the 2+ swap, Gainwell (Robinson already promised to RB 2)', byKind.swap?.winLabel === 'RB 1' && /K\. Gainwell 11\.9 over E\. Heidenreich 0\.6/.test(byKind.swap?.text), byKind.swap);
  ok('classic: a bench man is suggested once', new Set(pre.fixes.map((f) => f.text.match(/start (\S+ \S+)|^(\S+ \S+) \d/)?.[0])).size === pre.fixes.length, pre.fixes.map((f) => f.text));
  ok('classic: the yet-to-play line counts starters with a game (QB, RB1, WR — not the bye)', pre.left?.me.waiting === 3 && pre.left?.me.playing === 0, pre.left);
  ok('SWAP_MIN_GAIN is two points', SWAP_MIN_GAIN === 2);

  // A swap that does not clear the margin is not suggested.
  const close = summarize({ league: cl, week: WEEK, matchup: cmatch(), state: [], teams: cteams, injuries, nowMs: kick(0) - LOCK_LEAD_MS - 3_600_000,
    classic: classic({ picks: [pick(slotOf('QB'), 'josh-allen'), pick(slotOf('RB1'), 'bijan-robinson'), pick(slotOf('RB2'), 'kenny-gainwell'), pick(slotOf('WR'), 'jaxon-smith-njigba'), pick(slotOf('FLEX'), 'travis-kelce')], projOf: (p) => (p.id === 'george-pickens' ? 13.9 : projBoth(p)) }) });
  ok('classic: a bench man 1.4 better than the flex is not a swap; a set lineup has no fixes', close.fixes.length === 0, close.fixes);
  ok('classic: …and projects the five starters', close.me.score === 82.6, close.me.score);

  // Thursday night: Allen (BUF) is on the field with 9.1 on the board, projection 21.6 → max; Robinson still to come.
  const liveState = [{ game_window: 'wk', home_score: 9.1, away_score: 0, slot_scores: [{ side: 'home', slot: slotOf('QB'), slug: 'josh-allen', metric: null, score: 9.1 }] }];
  const live = summarize({ league: cl, week: WEEK, matchup: cmatch('live'), state: liveState, teams: cteams, injuries, nowMs: kick(0) + 30 * 60_000, classic: classic() });
  ok('classic live: a man on the field is worth the larger of his points and his projection', live.me.score === 22.2 && live.phase === 'live', live.me.score);
  ok('classic live: the QB is playing, the others still to come', live.left?.me.playing === 1 && live.left?.me.waiting === 2, live.left);
  // Sunday evening: TNF long done (9.1 banks), the early game (Heidenreich, ATL) is on and he has 4.0.
  const sunState = [{ game_window: 'wk', home_score: 13.1, away_score: 0, slot_scores: [
    { side: 'home', slot: slotOf('QB'), slug: 'josh-allen', metric: null, score: 9.1 },
    { side: 'home', slot: slotOf('RB1'), slug: 'eli-heidenreich', metric: null, score: 4.0 }] }];
  const sun = summarize({ league: cl, week: WEEK, matchup: cmatch('live'), state: sunState, teams: cteams, injuries, nowMs: kick(1) + 30 * 60_000, classic: classic() });
  ok('classic Sunday: a finished game banks its points (9.1, not 21.6) and a live man his max (4.0 over 0.6)', sun.me.score === 13.1, sun.me.score);
  ok('classic Sunday: a starter on the field is never a swap (Heidenreich is locked in)', !sun.fixes.some((f) => f.kind === 'swap'), sun.fixes);
  ok('classic Sunday: the empty RB 2 still suggests a man whose game has not kicked (Gainwell, DEN late) — not Robinson, who is playing', /start K\. Gainwell/.test(sun.fixes.find((f) => f.kind === 'empty')?.text ?? ''), sun.fixes);

  // Final: the points are the points.
  const fin = summarize({ league: cl, week: WEEK, matchup: cmatch('final'), state: sunState, teams: cteams, injuries, nowMs: kick(4) + 5 * 3_600_000, classic: classic() });
  ok('classic final: every starter is done, the total is the live total, and the line says FINAL', fin.me.score === 13.1 && fin.phase === 'final' && /^FINAL/.test(fin.line), fin);

  // No opponent roster readable: their score stays live, and the card says so.
  const noOpp = summarize({ league: cl, week: WEEK, matchup: cmatch('live'), state: liveState, teams: cteams, injuries, nowMs: kick(0) + 30 * 60_000, classic: classic({ theirRoster: null }) });
  ok('classic: an unreadable opponent keeps the live total and is flagged', noOpp.themLive === true && noOpp.them.score === 0, noOpp);

  // v0.501.0 — the classic card: live totals beside the projections, done /
  // live / up counts per team, the win bar, and the teams' avatars.
  ok('classic card: the live totals ride along with the projections', sun.actual?.me === 13.1 && sun.actual?.them === 0 && sun.me.score === 13.1, sun.actual);
  ok('classic card: done / live / up by team (QB done, RB1 on the field, WR still to come)', sun.left?.me.done === 1 && sun.left?.me.playing === 1 && sun.left?.me.waiting === 1, sun.left);
  ok('classic card: before kickoff nobody is done', pre.left?.me.done === 0 && pre.left?.them.done === 0, pre.left);
  ok('classic card: the win chance is the board\'s — 22.2 projected against 73 is long odds, never 0', pre.winPct > 0 && pre.winPct < 0.2, pre.winPct);
  ok('classic card: the win chance moves with the margin (swap the sides, the odds flip)',
    Math.abs(summarize({ league: { ...cl, rosterId: 7 }, week: WEEK, matchup: cmatch(), state: [], teams: cteams, injuries, nowMs: kick(0) - LOCK_LEAD_MS - 3_600_000,
      classic: classic({ picks: [], roster: theirRoster, theirPicks: myPicks, theirRoster: roster }) }).winPct - (1 - pre.winPct)) < 1e-9);
  ok('classic card: at the final the win bar is the result', fin.winPct === 1, fin.winPct);
  ok('classic card: no opponent lineup, no win bar', noOpp.winPct === undefined, noOpp.winPct);
  const faces = summarize({ league: cl, week: WEEK, matchup: cmatch(), state: [], teams: { 4: { team_name: 'Steelers', avatar: 'https://sleepercdn.com/avatars/s' }, 7: { team_name: 'Ravens', avatar: null } }, injuries, nowMs: kick(0), classic: classic() });
  // v0.503.0 — the lineup as cards: every starting spot, who is in it (or
  // projected to it, for a best-ball spot), his projection, his points once
  // he plays, his injury tag, and a bye.
  const cc = (snap, slot) => snap.cards.find((c) => c.slot === slotOf(slot));
  ok('lineup cards: one per starting spot, in the league\'s order, labelled', pre.cards.map((c) => c.winLabel).join() === 'QB,RB 1,RB 2,WR,FLEX', pre.cards.map((c) => c.winLabel));
  ok('lineup cards: a starter before kickoff is SET with his projection and no points', cc(pre, 'QB').status === 'set' && cc(pre, 'QB').name === 'J. Allen' && cc(pre, 'QB').proj === 21.6 && cc(pre, 'QB').points === null, cc(pre, 'QB'));
  ok('lineup cards: an empty spot is EMPTY', cc(pre, 'RB2').status === 'empty' && cc(pre, 'RB2').slug === null, cc(pre, 'RB2'));
  ok('lineup cards: the IR receiver carries his tag', cc(pre, 'WR').injury === 'IR', cc(pre, 'WR'));
  ok('lineup cards: the flex on a bye is marked BYE', cc(pre, 'FLEX').bye === true && cc(pre, 'QB').bye === false, cc(pre, 'FLEX'));
  ok('lineup cards: on the field he is LIVE with his points', cc(live, 'QB').status === 'live' && cc(live, 'QB').points === 9.1, cc(live, 'QB'));
  ok('lineup cards: at the final an empty spot reads MISSED', cc(fin, 'RB2').status === 'missed' && cc(fin, 'QB').status === 'final', [cc(fin, 'RB2').status, cc(fin, 'QB').status]);
  const bbSnap = summarize({ league: cl, week: WEEK, matchup: cmatch(), state: [], teams: cteams, injuries, nowMs: kick(0) - LOCK_LEAD_MS - 3_600_000,
    classic: classic({ bestball: [slotOf('FLEX')], picks: myPicks.filter((p) => p.roster_slot !== slotOf('FLEX')) }) });
  ok('lineup cards: a best-ball spot shows who it projects to (the best of the rest: Robinson 22.2)', cc(bbSnap, 'FLEX').bestball === true && cc(bbSnap, 'FLEX').slug === 'bijan-robinson' && cc(bbSnap, 'FLEX').proj === 22.2, cc(bbSnap, 'FLEX'));
  ok('lineup cards: a regular spot is not best-ball', cc(bbSnap, 'QB').bestball === false);
  ok('classic card: each team carries its own avatar, or none', faces.me.avatar === 'https://sleepercdn.com/avatars/s' && faces.them.avatar === null, [faces.me.avatar, faces.them.avatar]);

  // Golf: better is lower-but-not-zero, an empty spot pays the fill.
  const gslots = slots.map((d) => ({ ...d, zeroPts: 10 }));
  const golf = summarize({ league: cl, week: WEEK, matchup: cmatch(), state: [], teams: cteams, injuries, nowMs: kick(0) - LOCK_LEAD_MS - 3_600_000,
    classic: classic({ slots: gslots, golf: true, picks: [pick(slotOf('QB'), 'josh-allen'), pick(slotOf('RB1'), 'bijan-robinson'), pick(slotOf('RB2'), 'kenny-gainwell'), pick(slotOf('WR'), 'jaxon-smith-njigba')] }) });
  ok('golf: the empty flex pays the 10-point fill', golf.me.score === 21.6 + 22.2 + 11.9 + 14.4 + 10, golf.me.score);
  ok('golf: the empty flex takes the LOWEST bench man above zero (Heidenreich 0.6, not Kelce 12.5) — and once promised he is nobody\'s swap', golf.fixes.length === 1 && /empty · start E\. Heidenreich 0\.6/.test(golf.fixes[0]?.text ?? ''), golf.fixes);
  const golf2 = summarize({ league: cl, week: WEEK, matchup: cmatch(), state: [], teams: cteams, injuries, nowMs: kick(0) - LOCK_LEAD_MS - 3_600_000,
    classic: classic({ slots: gslots, golf: true, picks: [pick(slotOf('QB'), 'josh-allen'), pick(slotOf('RB1'), 'bijan-robinson'), pick(slotOf('RB2'), 'kenny-gainwell'), pick(slotOf('WR'), 'jaxon-smith-njigba'), pick(slotOf('FLEX'), 'travis-kelce')] }) });
  ok('golf: with the flex filled, Heidenreich 0.6 is the swap for Robinson 22.2 — lower is better', /E\. Heidenreich 0\.6 over B\. Robinson 22\.2/.test(golf2.fixes.find((f) => f.kind === 'swap' && f.winLabel === 'RB 1')?.text ?? ''), golf2.fixes);

  // A drip league is untouched.
  const drip = summarize({ league, week: WEEK, matchup: matchup(), state, teams, nowMs: kick(0) + 30 * 60_000, classic: classic() });
  ok('a drip league ignores a classic input: live totals, not projected', drip.projected === undefined && drip.me.score === 42.6, drip);
}

// ── v0.505.0: the ALERTS (1×1) and FIELDS widgets ──
{
  // Alerts: warnings are what cost points left alone; a bench upgrade is advice.
  const drip = { leagueId: 'D', leagueName: 'Drip One', rosterId: 4, projected: undefined, alarm: { lockMs: 2000 },
    cards: [{ status: 'empty' }, { status: 'none' }, { status: 'unsealed' }, { status: 'set' }, { status: 'live' }],
    fixes: [{ kind: 'empty' }, { kind: 'none' }, { kind: 'metric' }, { kind: 'injury' }, { kind: 'bye' }] };
  ok('alerts: drip counts each empty / none / unsealed slot once, plus out and bye starters', alertCount(drip) === 5, alertCount(drip));
  const classicSnap = { leagueId: 'C', leagueName: 'Classic', rosterId: 2, projected: true, alarm: { lockMs: 1000 },
    cards: [{ status: 'empty' }], fixes: [{ kind: 'empty' }, { kind: 'injury' }, { kind: 'bye' }, { kind: 'swap' }, { kind: 'swap' }] };
  ok('alerts: classic counts empty, out and bye spots — never an upgrade', alertCount(classicSnap) === 3, alertCount(classicSnap));
  const clean = { leagueId: 'Z', leagueName: 'Clean', rosterId: 1, cards: [{ status: 'set' }], fixes: [], alarm: { lockMs: 500 } };
  const sum = alertsSummary([clean, classicSnap, drip]);
  ok('alerts: the total sums every league', sum.total === 8, sum);
  ok('alerts: only leagues with warnings are listed, most first', sum.leagues.map((l) => l.leagueId).join() === 'D,C', sum.leagues);
  ok('alerts: the deadline is the soonest lock among leagues WITH warnings (not the clean one)', sum.lockMs === 1000, sum.lockMs);
  ok('alerts: all clean reads zero with no deadline', alertsSummary([clean]).total === 0 && alertsSummary([clean]).lockMs === null);
  const holes = summarize({ league, week: WEEK, matchup: matchup('open'), state: [], teams, nowMs: kick(0) - LOCK_LEAD_MS - 3_600_000,
    picks: [], pool: [{ slug: 'a', full: 'Aaron Guy', team: 'BUF', pos: 'QB' }], injuries: {} });
  ok('alerts: a real drip snapshot with nothing picked counts every slot', alertCount(holes) === wins.reduce((n, w) => n + w.slots, 0), alertCount(holes));

  // Fields: the ball's spot in the offense's words.
  ok('fields: in his own half the spot is his', spotLabel('KC', 'BUF', 70) === 'KC 30');
  ok('fields: across midfield it is theirs', spotLabel('KC', 'BUF', 34) === 'BUF 34');
  ok('fields: midfield is the 50', spotLabel('KC', 'BUF', 50) === '50');

  // Fields: the week's games — live first, then to come by kickoff, then final.
  const P = (c, tm, yl2, hs, as, txt, extra = {}) => ({ c, drv: 0, tm, dn: 1, dist: 10, yl: yl2 + 5, yl2, ty: 'Rush', txt, hs, as, ...extra });
  setLiveGameFeed(WEEK, feedRowsToWeek([
    { key: 'MIA@BUF', away: 'MIA', home: 'BUF', state: 'post', plays: [P(3590, 'BUF', 60, 31, 17, 'Kneel')] },
    { key: 'ATL@CAR', away: 'ATL', home: 'CAR', state: 'in', plays: [P(1200, 'ATL', 80, 0, 7, 'Kick'), P(1500, 'CAR', 34, 3, 7, 'C.Hubbard left end for 9 yards')],
      status: { name: 'STATUS_IN_PROGRESS', short: '5:00 - 2nd' } },
    { key: 'KC@NYG', away: 'KC', home: 'NYG', state: 'in', plays: [P(2000, 'KC', 12, 7, 14, 'P.Mahomes pass to T.Kelce for 12 yards, TOUCHDOWN', { sc: 1 })] },
  ]));
  const mine = minesByTeam([{ cards: [
    { slug: 'kelce', team: 'KC', name: 'T. Kelce', points: 14.2, status: 'live' },
    { slug: 'hub', team: 'CAR', name: 'C. Hubbard', points: 6, status: 'live' },
    { slug: 'kelce', team: 'KC', name: 'T. Kelce', points: 14.2, status: 'live' },   // same man, second league
    { slug: null, team: 'DET', name: '', status: 'empty' },
  ] }, { cards: [{ slug: 'lamar', team: 'BAL', name: 'L. Jackson', points: null, proj: 22.1, status: 'set' }] }]);
  ok('fields: my players by team, each once, empties skipped', mine.get('KC')?.length === 1 && mine.get('CAR')?.[0].name === 'C. Hubbard' && !mine.has('DET') && mine.get('BAL')?.[0].proj === 22.1, [...mine.keys()]);
  // v0.506.0 — only the week on show, only the picked league; state and injury ride along.
  const snapsWk = [
    { leagueId: 'A', week: WEEK, cards: [{ slug: 'p1', team: 'KC', name: 'P. One', points: null, proj: 12.3, status: 'set', injury: 'Q' }, { slug: 'p2', team: 'KC', name: 'P. Two', points: 20.1, status: 'final' }] },
    { leagueId: 'B', week: WEEK, cards: [{ slug: 'p3', team: 'KC', name: 'P. Three', points: 4, status: 'live' }] },
    { leagueId: 'C', week: WEEK + 1, cards: [{ slug: 'p4', team: 'KC', name: 'P. Four', points: null, proj: 9, status: 'set' }] },
  ];
  const kcNames = (m) => (m.get('KC') ?? []).map((x) => x.name).join();
  ok('fields stars: a snapshot of another week is left off this week\'s games (the "P" on week 2 bug)', kcNames(minesByTeam(snapsWk, { week: WEEK })) === 'P. One,P. Two,P. Three', kcNames(minesByTeam(snapsWk, { week: WEEK })));
  ok('fields stars: a picked league stars only its players', kcNames(minesByTeam(snapsWk, { week: WEEK, leagueId: 'B' })) === 'P. Three');
  ok('fields stars: no league picked stars every league', kcNames(minesByTeam(snapsWk, { week: WEEK, leagueId: null })).split(',').length === 3);
  const kcm = minesByTeam(snapsWk, { week: WEEK }).get('KC');
  ok('fields stars: each carries his state — projected, final, live — and his injury tag', kcm.map((x) => x.state).join() === 'pre,final,live' && kcm[0].injury === 'Q' && kcm[0].proj === 12.3, kcm);
  const games = fieldGames(WEEK, mine);
  ok('fields: every game on the slate is listed', games.length === 5, games.map((g) => g.key));
  ok('fields: live games first, then the ones to come by kickoff, then finals', games.map((g) => g.state).join() === 'live,live,pre,pre,final', games.map((g) => `${g.key}:${g.state}`));
  const car = games.find((g) => g.key === 'ATL@CAR'), kc = games.find((g) => g.key === 'KC@NYG'), buf = games.find((g) => g.key === 'MIA@BUF'), bal = games.find((g) => g.key === 'DET@BAL');
  ok('fields: a live game carries the score, who has the ball and where', car.hs === 3 && car.as === 7 && car.poss === 'CAR' && car.toGo === 34, car);
  ok('fields: ESPN\'s own clock words win over the play clock', car.clock === '5:00 - 2nd', car.clock);
  ok('fields: without them, the last play\'s quarter clock', kc.clock === 'Q3 11:40', kc.clock);
  ok('fields: a scoring play is flagged', kc.big === 'score' && car.big === null);
  ok('fields: my players ride with their game, from either side', kc.mine.map((m) => m.name).join() === 'T. Kelce' && car.mine[0].name === 'C. Hubbard' && bal.mine[0].name === 'L. Jackson');
  ok('fields: a final reads FINAL with no ball', buf.clock === 'FINAL' && buf.poss === null && buf.hs === 31, buf);
  ok('fields: a game to come has its kickoff and no score', bal.state === 'pre' && bal.kickoff === kick(4) && bal.clock === null && bal.last === null, bal);
}

// ── v0.508.0: down, distance, the ball, and an opened game ──
{
  const pl = (o) => ({ c: 100, drv: 0, tm: 'KC', dn: 1, dist: 10, yl: 75, yl2: 75, ty: 'Rush', txt: '', hs: 0, as: 0, ...o });
  ok('next down: a short gain is the next down with what is left', nextDownFrom(pl({ dn: 1, dist: 10, yl: 75, yl2: 72 })) === '2nd & 7');
  ok('next down: gaining the distance is a first down', nextDownFrom(pl({ dn: 3, dist: 4, yl: 40, yl2: 33 })) === '1st & 10');
  ok('next down: a first down inside the ten is 1st & Goal', nextDownFrom(pl({ dn: 2, dist: 8, yl: 15, yl2: 6 })) === '1st & Goal');
  ok('next down: short of the line with the goal nearer than the sticks reads Goal', nextDownFrom(pl({ dn: 1, dist: 10, yl: 8, yl2: 5 })) === '2nd & Goal');
  ok('next down: a change of possession is 1st & 10 for the new side', nextDownFrom(pl({ tm2: 'BUF', dn: 4, dist: 5, yl: 40, yl2: 70 })) === '1st & 10');
  ok('next down: stopped on fourth, it is theirs from the other end', nextDownFrom(pl({ dn: 4, dist: 2, yl: 40, yl2: 39 })) === '1st & 10');
  ok('next down: a kickoff (no down) is 1st & 10', nextDownFrom(pl({ dn: 0, yl: 65, yl2: 75 })) === '1st & 10');
  ok('next down: a score has no next snap to describe', nextDownFrom(pl({ sc: 1 })) === null && nextDownFrom(null) === null);

  const P2 = (c, tm, yl, yl2, dn, dist, txt, extra = {}) => ({ c, drv: 0, tm, dn, dist, yl, yl2, ty: 'Rush', txt, hs: 3, as: 7, ...extra });
  setLiveGameFeed(WEEK, feedRowsToWeek([
    { key: 'ATL@CAR', away: 'ATL', home: 'CAR', state: 'in', plays: [P2(1000, 'CAR', 75, 70, 1, 10, 'first'), P2(1100, 'CAR', 70, 64, 2, 5, 'second, TD later', {}), P2(1200, 'CAR', 64, 60, 1, 10, 'third'), P2(1300, 'CAR', 60, 52, 2, 6, 'fourth')],
      status: { name: 'STATUS_IN_PROGRESS', short: '8:20 - 2nd', sit: { dd: '3rd & 1', spot: 'ATL 48', poss: 'CAR', ytg: 48 },
        leaders: [{ team: 'CAR', cat: 'pass', name: 'B. Young', line: '12/18, 140 YDS' }, { team: 'ATL', cat: 'rush', name: 'B. Robinson', line: '9 CAR, 61 YDS' }] } },
    { key: 'KC@NYG', away: 'KC', home: 'NYG', state: 'in', plays: [P2(2000, 'KC', 40, 36, 2, 9, 'short gain')] },
  ]));
  const gs = fieldGames(WEEK);
  const car = gs.find((g) => g.key === 'ATL@CAR'), kc = gs.find((g) => g.key === 'KC@NYG'), bal = gs.find((g) => g.key === 'DET@BAL');
  ok('situation: the worker\'s down, distance and spot win', car.dd === '3rd & 1' && car.spot === 'ATL 48' && car.poss === 'CAR' && car.toGo === 48, [car.dd, car.spot, car.poss, car.toGo]);
  ok('situation: without it, worked out from the last play', kc.dd === '3rd & 5' && kc.spot === null && kc.poss === 'KC' && kc.toGo === 36, [kc.dd, kc.poss, kc.toGo]);
  ok('opened game: the last three plays, newest first, with their clocks', car.recent.map((p) => p.txt).join('|') === 'fourth|third|second, TD later' && car.recent[0].clock === 'Q2 8:20', car.recent);
  ok('opened game: the leaders ride along', car.leaders.length === 2 && car.leaders[0].line === '12/18, 140 YDS');
  ok('a game not yet kicked off has no situation, plays or leaders', bal.dd === null && bal.recent.length === 0 && bal.leaders.length === 0, bal);
}

// ── v0.509.0: a drip lineup at a glance, for the app's league list ──
{
  const snap = { assessable: true, alarm: { lockMs: 123 }, cards: ['set', 'sealed', 'live', 'final', 'empty', 'empty', 'none', 'unsealed', 'missed'].map((status) => ({ status })), fixes: [] };
  const r = lineupReport(snap);
  ok('lineup report: set counts set, sealed, playing and done', r.set === 4 && r.total === 9, r);
  ok('lineup report: unset, nobody-available, no-metric and missed each counted apart', r.unset === 2 && r.none === 1 && r.noMetric === 1 && r.missed === 1, r);
  ok('lineup report: the next lock rides along', r.lockMs === 123);
  ok('lineup report: none for a classic league (its projections say it)', lineupReport({ ...snap, projected: true }) === null);
  ok('lineup report: none without picks read', lineupReport({ ...snap, assessable: false }) === null && lineupReport({ ...snap, cards: [] }) === null);
}

// ── v0.507.0: one tap at a time ──
{
  const t0 = 1_900_000_000_000;
  ok('tap lock: the first tap takes it', takeTapLock(77, t0) === true);
  ok('tap lock: a second tap while it is held is dropped', takeTapLock(77, t0 + 800) === false);
  ok('tap lock: another widget is not blocked', takeTapLock(78, t0 + 800) === true);
  releaseTapLock(77);
  ok('tap lock: released, the next tap is answered', takeTapLock(77, t0 + 900) === true);
  ok('tap lock: a lock left by a task that died is ignored after 20 s', takeTapLock(77, t0 + 900 + 20_001) === true);
  releaseTapLock(77); releaseTapLock(78);
}

if (fails) { console.log(`\n${fails} WIDGET ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL WIDGET ASSERTIONS PASSED');
