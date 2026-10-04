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

console.log(fails ? `\n${fails} FAILED` : '\nall sport league I/O checks passed');
process.exit(fails ? 1 : 0);
