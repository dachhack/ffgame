// The worker's sport-league I/O against a chainable fake database: a game
// starts → the seats' starters on its teams lock; lines arrive → the matchup
// is scored and, once the period is over, stamped final. Run from server/:
// `npx tsx test/sports-league-io.mjs`.
import { __setClientForTest } from '../src/supabase.js';
import { lockStartedGames, resolveSportLeagues } from '../src/sportLeague.js';

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); if (!c) fails++; };

// ── a tiny in-memory Supabase ────────────────────────────────────────────────
const tables = {
  league: [{ id: 'L1', sport: 'nba', season: '2026', provider: 'native', settings_json: { sport: { format: 'points', categories: [], scoring: {}, period_start: '2026-10-19', weeks: 4, bench: 3, ir: 3 } } }],
  matchup: [{ id: 'M1', league_id: 'L1', week: 301, status: 'scheduled', home_roster_id: 1, away_roster_id: 2, lock_at: null, home_final: null, away_final: null }],
  sealed_pick: [
    { matchup_id: 'M1', app_user_id: 'U1', game_window: 'wk', roster_slot: 'S1', player_slug: 'nba-1' },
    { matchup_id: 'M1', app_user_id: 'U1', game_window: 'wk', roster_slot: 'S2', player_slug: 'nba-2' },
    { matchup_id: 'M1', app_user_id: 'U2', game_window: 'wk', roster_slot: 'S1', player_slug: 'nba-3' },
  ],
  league_pool: [{ league_id: 'L1', slug: 'nba-1', team: 'BOS' }, { league_id: 'L1', slug: 'nba-2', team: 'LAL' }, { league_id: 'L1', slug: 'nba-3', team: 'NYK' }],
  sport_slot_lock: [],
  sport_game: [],
  matchup_state: [],
  draft: [{ league_id: 'L1', status: 'complete' }],
};
const membership = { U1: 1, U2: 2 };
const lines = { 'nba-1': { pts: 20, reb: 5, ast: 5, stl: 1, blk: 1, tov: 2 }, 'nba-3': { pts: 10, reb: 10, ast: 2, stl: 0, blk: 0, tov: 1 } };

function query(table) {
  const rows = tables[table];
  const filters = [];
  let op = 'select', payload = null, opts = null, page = null;
  const q = {
    select() { return q; },
    eq(k, v) { filters.push((r) => r[k] === v); return q; },
    in(k, vs) { filters.push((r) => vs.includes(r[k])); return q; },
    lte(k, v) { filters.push((r) => r[k] <= v); return q; },
    gte(k, v) { filters.push((r) => r[k] >= v); return q; },
    order() { return q; },
    range(from, to) { page = [from, to]; return q; },
    update(p) { op = 'update'; payload = p; return q; },
    upsert(p, o) { op = 'upsert'; payload = p; opts = o; return q; },
    then(res) {
      const match = (r) => filters.every((f) => f(r));
      if (op === 'select') { const all = rows.filter(match); return res({ data: page ? all.slice(page[0], page[1] + 1) : all, error: null }); }
      if (op === 'update') { for (const r of rows) if (match(r)) Object.assign(r, payload); return res({ data: null, error: null }); }
      const keys = (opts?.onConflict ?? '').split(',');
      for (const p of Array.isArray(payload) ? payload : [payload]) {
        const i = rows.findIndex((r) => keys.every((k) => r[k] === p[k]));
        if (i < 0) rows.push({ ...p }); else if (!opts?.ignoreDuplicates) rows[i] = { ...rows[i], ...p };
      }
      return res({ data: null, error: null });
    },
  };
  return q;
}
const fake = {
  from: query,
  rpc(name, args) {
    if (name === 'sport_league_day_lines_svc') {
      // every rostered player's game on the dates: the fixture's day rows
      const data = (tables.day_rows ?? []).filter((r) => r.league_id === args.p_league_id && r.game_date >= args.p_from && r.game_date <= args.p_to);
      return Promise.resolve({ data, error: null });
    }
    if (name === 'sport_bb_write_svc') {
      tables.sport_slot_lock = tables.sport_slot_lock.filter((k) => !(k.matchup_id === args.p_matchup && k.app_user_id === args.p_user && k.game_date === args.p_date && args.p_slots.includes(k.roster_slot)));
      for (const r of args.p_rows) tables.sport_slot_lock.push({ matchup_id: args.p_matchup, app_user_id: args.p_user, game_date: args.p_date, roster_slot: r.roster_slot, player_slug: r.player_slug, game_id: r.game_id });
      return Promise.resolve({ data: args.p_rows.length, error: null });
    }
    if (name !== 'sport_matchup_lines_svc') throw new Error(`unexpected rpc ${name}`);
    const data = tables.sport_slot_lock.filter((k) => k.matchup_id === args.p_matchup).map((k) => ({
      app_user_id: k.app_user_id, roster_id: membership[k.app_user_id], game_date: k.game_date, roster_slot: k.roster_slot,
      player_slug: k.player_slug, game_id: k.game_id, status: 'live', line: lines[k.player_slug] ?? null,
    }));
    return Promise.resolve({ data, error: null });
  },
};
__setClientForTest(fake);

// ── a game starts on the period's first day ──────────────────────────────────
const games = [
  { gameId: 'g1', gameDate: '2026-10-19', status: 'live', startUtc: '2026-10-19T23:30:00Z', home: 'BOS', away: 'NYK' },
  { gameId: 'g2', gameDate: '2026-10-19', status: 'pre', startUtc: '2026-10-20T02:30:00Z', home: 'LAL', away: 'GSW' },
];
// A league still drafting is left alone.
tables.draft[0].status = 'live';
ok((await lockStartedGames('nba', games, Date.parse('2026-10-20T00:00:00Z'))) === 0 && tables.matchup[0].status === 'scheduled', 'a league mid-draft locks nothing and stays scheduled');
tables.draft[0].status = 'complete';
const locked = await lockStartedGames('nba', games, Date.parse('2026-10-20T00:00:00Z'));
ok(locked === 2, `two slot-days locked (${locked}): the BOS and NYK starters, not the LAL one`);
ok(tables.sport_slot_lock.every((k) => k.game_date === '2026-10-19' && k.game_id === 'g1') && tables.sport_slot_lock.map((k) => k.player_slug).sort().join() === 'nba-1,nba-3', 'locks name the game and the day');
ok(tables.matchup[0].status === 'live' && tables.matchup[0].lock_at === '2026-10-19T23:30:00Z', 'the period went live at the first start');
const again = await lockStartedGames('nba', games, Date.parse('2026-10-20T00:00:00Z'));
ok(again === 0 && tables.sport_slot_lock.length === 2, 'a second pass locks nothing new');

// ── mid-period resolve ───────────────────────────────────────────────────────
let c = await resolveSportLeagues('nba', new Date('2026-10-20T15:00:00Z'));
ok(c.matchups === 1 && c.finals === 0, 'one live matchup scored, none final mid-period');
const st = tables.matchup_state[0];
ok(st && st.game_window === 'wk' && st.home_score === 20 + 6 + 7.5 + 3 + 3 - 2 && st.away_score === 10 + 12 + 3 - 1, `matchup_state ${st?.home_score} – ${st?.away_score}`);
ok(tables.matchup[0].status === 'live' && tables.matchup[0].home_final == null, 'no final yet');

// ── the period ends ──────────────────────────────────────────────────────────
tables.sport_game.push({ sport: 'nba', season: '2026', game_id: 'g9', game_date: '2026-10-25', status: 'live' });
c = await resolveSportLeagues('nba', new Date('2026-10-26T15:00:00Z'));
ok(c.finals === 0 && tables.matchup[0].status === 'live', 'a game from inside the period still live holds the final');
tables.sport_game[0].status = 'final';
c = await resolveSportLeagues('nba', new Date('2026-10-26T15:00:00Z'));
ok(c.finals === 1 && tables.matchup[0].status === 'final' && tables.matchup[0].home_final === st.home_score && tables.matchup[0].away_final === st.away_score, "the day after, with its games done, the matchup is final with the state's score");

// ── best ball (0436): a spot that fills itself each night ────────────────────
// S1 is a manual PG spot, S2 a best-ball UTIL. Seat 1 (U1) starts nba-1 at
// S1 by hand; nba-1 and nba-2 both play on the 20th; nba-2 (the only free
// man) fills S2. On the 21st nba-7 posts 30 and nba-2 posts 5: S2 moves.
tables.league[0].settings_json.roster_slots = [{ pos: ['PG', 'SG', 'SF', 'PF', 'C'], label: 'S1' }, { pos: ['PG', 'SG', 'SF', 'PF', 'C'], label: 'UTIL', bb: true }];
tables.matchup.push({ id: 'M2', league_id: 'L1', week: 302, status: 'live', home_roster_id: 1, away_roster_id: 2, lock_at: null, home_final: null, away_final: null });
tables.sealed_pick.push({ matchup_id: 'M2', app_user_id: 'U1', game_window: 'wk', roster_slot: 'S1', player_slug: 'nba-1' });
tables.sealed_pick.push({ matchup_id: 'M2', app_user_id: 'U1', game_window: 'wk', roster_slot: 'S2', player_slug: 'nba-7' }); // a stale pick in a bb spot: ignored
tables.day_rows = [
  { league_id: 'L1', roster_id: 1, app_user_id: 'U1', player_slug: 'nba-1', team: 'BOS', eligible: ['PG'], exp: 5, game_id: 'h1', game_date: '2026-10-26', status: 'final', played: true, line: { pts: 20 } },
  { league_id: 'L1', roster_id: 1, app_user_id: 'U1', player_slug: 'nba-2', team: 'LAL', eligible: ['SF'], exp: 2, game_id: 'h2', game_date: '2026-10-26', status: 'final', played: true, line: { pts: 12 } },
  { league_id: 'L1', roster_id: 1, app_user_id: 'U1', player_slug: 'nba-7', team: 'MIA', eligible: ['C'], exp: 0, game_id: 'h3', game_date: '2026-10-26', status: 'pre', played: null, line: null },
  { league_id: 'L1', roster_id: 2, app_user_id: 'U2', player_slug: 'nba-3', team: 'NYK', eligible: ['PG'], exp: 1, game_id: 'h1', game_date: '2026-10-26', status: 'final', played: true, line: { pts: 9 } },
];
lines['nba-2'] = { pts: 12 }; lines['nba-7'] = { pts: 30 };
c = await resolveSportLeagues('nba', new Date('2026-10-27T03:00:00Z'));
const bbLocks = () => tables.sport_slot_lock.filter((k) => k.matchup_id === 'M2' && k.roster_slot === 'S2');
ok(c.filled === 2 && bbLocks().length === 2 && bbLocks().find((k) => k.app_user_id === 'U1')?.player_slug === 'nba-2' && bbLocks().find((k) => k.app_user_id === 'U2')?.player_slug === 'nba-3', `the night's fill: U1's UTIL takes nba-2 (nba-1 is started by hand, nba-7 has not played), U2's takes nba-3 (${c.filled} seat-days)`);
const ms = tables.matchup_state.find((x) => x.matchup_id === 'M2');
// (the fake's lines are per player, not per day: nba-3's line is the fixture's 24-point one)
ok(ms && ms.home_score === 12 && ms.away_score === 10 + 12 + 3 - 1, `the fill scores: ${ms?.home_score} – ${ms?.away_score} (the manual S1 never locked — its game was not polled here)`);
// The late game posts: nba-7 (30) beats nba-2 (12) for the UTIL spot.
tables.day_rows[2] = { ...tables.day_rows[2], status: 'final', played: true, line: { pts: 30 } };
c = await resolveSportLeagues('nba', new Date('2026-10-27T05:00:00Z'));
ok(c.filled === 1 && bbLocks().find((k) => k.app_user_id === 'U1')?.player_slug === 'nba-7' && bbLocks().length === 2, 'the late game posts and the UTIL moves to the 30-point man; the other seat is left as it was');
c = await resolveSportLeagues('nba', new Date('2026-10-27T06:00:00Z'));
ok(c.filled === 0, 'nothing changed, nothing written');
// Two days on, the 26th is settled: a stat correction no longer moves it.
tables.day_rows[2] = { ...tables.day_rows[2], line: { pts: 2 } };
c = await resolveSportLeagues('nba', new Date('2026-10-29T05:00:00Z'));
ok(c.filled === 0 && bbLocks().find((k) => k.app_user_id === 'U1')?.player_slug === 'nba-7', 'a day older than yesterday keeps its fill');

// ── season points (0436): the table, points only ─────────────────────────────
tables.league[0].settings_json.sport.format = 'season';
tables.sport_roto = [];
tables.league_membership = [{ league_id: 'L1', sleeper_roster_id: 1 }, { league_id: 'L1', sleeper_roster_id: 2 }, { league_id: 'L1', sleeper_roster_id: 3 }];
fake.rpc = ((orig) => (name, args) => {
  if (name === 'sport_league_lines_svc') {
    const data = tables.sport_slot_lock.filter((k) => ['M1', 'M2'].includes(k.matchup_id)).map((k) => ({ roster_id: membership[k.app_user_id], week: 301, game_date: k.game_date, player_slug: k.player_slug, line: lines[k.player_slug] ?? null }));
    return Promise.resolve({ data, error: null });
  }
  return orig(name, args);
})(fake.rpc);
c = await resolveSportLeagues('nba', new Date('2026-10-29T05:00:00Z'));
const table = tables.sport_roto.sort((a, b) => a.roster_id - b.roster_id);
ok(c.roto === 3 && table.length === 3 && table[0].points === (20 + 6 + 7.5 + 3 + 3 - 2) + 30 && table[1].points === (10 + 12 + 3 - 1) * 2 && table[2].points === 0 && Object.keys(table[0].cats).length === 0, `season table: ${table.map((t) => `${t.roster_id} ${t.points}`).join(', ')}`);

console.log(fails ? `\n${fails} FAILED` : '\nall sport league I/O checks passed');
process.exit(fails ? 1 : 0);
