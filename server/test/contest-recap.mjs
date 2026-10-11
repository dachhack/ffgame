// THE WEEK'S RESULT CARD AND THE LOCK REMINDER (v0.668.1). The ranking, the
// card's words and the reminder rows are pure; the posting runs against an
// in-memory double. Run from server/: npx tsx test/contest-recap.mjs
import { __setClientForTest } from '../src/supabase.js';

let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };

// ── the double ──────────────────────────────────────────────────────────────
const WEEK = 6;
const L = { id: 'L1', name: 'Kickoff Bullseye', kind: 'dfs', season: '2026', contest_week: null, settings_json: { contest: 'bullseye', contest_format: 'h2h', budget: 50000 } };
const T = {
  league: [L],
  matchup: [
    { id: 'm1', league_id: 'L1', week: 6, status: 'final', home_roster_id: 1, away_roster_id: 2, home_final: 142.3, away_final: 131, home_tb: 0.4, away_tb: 2.1 },
    { id: 'm2', league_id: 'L1', week: 6, status: 'final', home_roster_id: 3, away_roster_id: 4, home_final: 120, away_final: 150.5, home_tb: 3, away_tb: 1 },
    { id: 'm0', league_id: 'L1', week: 5, status: 'final', home_roster_id: 1, away_roster_id: 3, home_final: 100, away_final: 90, home_tb: null, away_tb: null },
  ],
  league_membership: [
    { league_id: 'L1', sleeper_roster_id: 1, team_name: 'Farmer Casey', app_user_id: 'u1', controller: 'human', enrolled: true },
    { league_id: 'L1', sleeper_roster_id: 2, team_name: 'Mud Dogs', app_user_id: null, controller: 'ai', enrolled: false },
    { league_id: 'L1', sleeper_roster_id: 3, team_name: 'Blitz Brigade', app_user_id: 'u3', controller: 'human', enrolled: true },
    { league_id: 'L1', sleeper_roster_id: 4, team_name: 'Red Zone', app_user_id: 'u4', controller: 'human', enrolled: true },
  ],
  league_message: [],
  nfl_slate: [
    { season: '2026', week: 6, kickoff: '2026-10-12T17:00:00Z' }, { season: '2026', week: 6, kickoff: '2026-10-13T00:20:00Z' },
    { season: '2026', week: 7, kickoff: '2026-10-16T00:15:00Z' }, { season: '2026', week: 7, kickoff: '2026-10-19T17:00:00Z' },
  ],
  push_outbox: [],
};
const inserts = [];
function builder(name, preds = [], order = null) {
  const rows = () => { let r = (T[name] ?? []).filter((x) => preds.every((p) => p(x))); if (order) r = [...r].sort((a, b) => (a[order.col] < b[order.col] ? -1 : 1) * (order.asc ? 1 : -1)); return r; };
  const api = {
    select: () => api,
    eq: (c, v) => builder(name, [...preds, (r) => (c.includes('->>') ? String(r.txn?.[c.split('->>')[1]]) === String(v) : String(r[c]) === String(v))], order),
    in: (c, vs) => builder(name, [...preds, (r) => vs.includes(r[c])], order),
    lte: (c, v) => builder(name, [...preds, (r) => r[c] <= v], order),
    not: (c) => builder(name, [...preds, (r) => r[c] != null], order),
    order: (col, o = {}) => builder(name, preds, { col, asc: o.ascending !== false }),
    limit: () => api,
    then: (res, rej) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
    insert: (row) => { inserts.push({ table: name, row }); (T[name] ??= []).push({ id: T[name].length + 1, ...row }); return Promise.resolve({ error: null }); },
    upsert: (list) => { inserts.push({ table: name, rows: list }); return Promise.resolve({ error: null }); },
    update: (patch) => ({ eq: (c, v) => { for (const r of (T[name] ?? []).filter((x) => String(x[c]) === String(v))) Object.assign(r, patch); return Promise.resolve({ error: null }); } }),
  };
  return api;
}
__setClientForTest({ from: (t) => builder(t) });

const R = await import('../src/contestRecap.js');
const { contestConfigOf } = await import('../../packages/core/src/engine/contest.ts');
const cfg = contestConfigOf(L.settings_json, L.kind);
const seats = new Map(T.league_membership.map((m) => [m.sleeper_roster_id, m]));

// ── ranking ─────────────────────────────────────────────────────────────────
const ranked = R.rankWeek(cfg, T.matchup.filter((m) => m.week === 6), seats);
ok('rank: the biggest ring first; both sides of a head-to-head count', ranked.map((r) => r.team).join(',') === 'Red Zone,Farmer Casey,Mud Dogs,Blitz Brigade', ranked.map((r) => r.team));
ok('rank: a CPU seat is marked, a winner knows it won', ranked.find((r) => r.team === 'Mud Dogs').cpu && ranked.find((r) => r.team === 'Farmer Casey').won === true && ranked.find((r) => r.team === 'Blitz Brigade').won === false);
const golfCfg = contestConfigOf({ contest: 'golf', contest_format: 'board' }, 'dfs');
const gRanked = R.rankWeek(golfCfg, [{ home_roster_id: 1, away_roster_id: 1, home_final: 40, away_final: 40 }, { home_roster_id: 3, away_roster_id: 3, home_final: 25, away_final: 25 }], seats);
ok('rank: golf, the lowest first; a board league counts each self-pair once', gRanked.length === 2 && gRanked[0].team === 'Blitz Brigade' && gRanked[0].opp === null);
const tied = R.rankWeek(golfCfg, [{ home_roster_id: 1, away_roster_id: 1, home_final: 40, away_final: 40 }, { home_roster_id: 3, away_roster_id: 3, home_final: 40, away_final: 40 }], seats);
ok('rank: a tie shares the rank', tied[0].rank === 1 && tied[1].rank === 1);

// ── the card ────────────────────────────────────────────────────────────────
const body = R.recapBody(cfg, 6, ranked, { leader: 'Farmer Casey', total: 242.3, weeks: 2, record: '2–0' }, { week: 7, lockMs: Date.parse('2026-10-16T00:15:00Z') });
ok('card: opens with the week and the contest', body.startsWith('🏁 WEEK 6 RESULT · 🎯 BULLSEYE'), body);
ok('card: the podium, with the tie-break and the CPU tag', body.includes('🥇 Red Zone — 150.5 ring (tie-break 1 off)') && body.includes('🥉 Mud Dogs — 131 ring (tie-break 2.1 off) · CPU'), body);
ok('card: the field, and the head-to-head results', body.includes('4 squads · 1 CPU') && body.includes('Head-to-head: Red Zone beat Blitz Brigade 150.5–120 · Farmer Casey beat Mud Dogs 142.3–131'), body);
ok('card: the season leader and the next lock', body.includes('Season: Farmer Casey leads at 2–0 (242.3 ring) after 2 weeks.') && /Week 7's board is up — squads lock Thu 8:15 PM ET\./.test(body), body);
const gBody = R.recapBody(golfCfg, 6, gRanked, null, null);
ok('card: golf speaks in pts and has no head-to-head line', gBody.includes('🥇 Blitz Brigade — 25 pts') && !gBody.includes('Head-to-head') && !gBody.includes('Season:'), gBody);

// ── posting: once, with pushes, then never again ───────────────────────────
let n = await R.postContestRecaps(6, '2026', { force: true, now: Date.parse('2026-10-14T12:00:00Z') });
ok('post: one card for the league', n === 1 && T.league_message.length === 1 && T.league_message[0].kind === 'txn' && T.league_message[0].txn.kind === 'contest_recap' && T.league_message[0].txn.week === 6, T.league_message);
ok('post: the card carries the head-to-head leader by record', /Season: Farmer Casey leads at 2–0 \(242\.3 ring\) after 2 weeks\./.test(T.league_message[0].body), T.league_message[0].body);
const pushed = inserts.find((i) => i.table === 'push_outbox')?.rows ?? [];
ok('post: a push per human with a squad, with their place', pushed.length === 3 && pushed.some((p) => p.app_user_id === 'u4' && p.title === '🏁 Week 6: 1st of 4 in Kickoff Bullseye') && pushed.some((p) => p.app_user_id === 'u3' && /Red Zone beat you/.test(p.body)), pushed.map((p) => p.title));
ok('post: pushes are deduped per league-week-user', pushed.every((p) => /^contest-recap:L1:6:u\d$/.test(p.dedupe_key)));
n = await R.postContestRecaps(6, '2026', { force: true, now: Date.parse('2026-10-14T12:05:00Z') });
ok('post: a second pass posts nothing', n === 0 && T.league_message.length === 1);
// A fresh process finds the card in the chat and still posts nothing.
const R2 = await import('../src/contestRecap.js?fresh=1').catch(() => null);
if (R2) { n = await R2.postContestRecaps(6, '2026', { force: true, now: Date.parse('2026-10-14T12:10:00Z') }); ok('post: after a restart the chat card is the record', n === 0 && T.league_message.length === 1); }
// A week with a matchup still live posts nothing.
T.matchup.push({ id: 'm9', league_id: 'L1', week: 7, status: 'live', home_roster_id: 1, away_roster_id: 2, home_final: null, away_final: null });
n = await R.postContestRecaps(7, '2026', { force: true, now: Date.parse('2026-10-21T12:00:00Z') });
ok('post: an unfinished week posts nothing', n === 0 && T.league_message.length === 1);

// ── after a re-score, the card is rebuilt in place (0474) ───────────────────
T.matchup.find((m) => m.id === 'm2').away_final = 160;   // Red Zone's corrected final
let re = await R.repostContestRecap(L, 6);
ok('repost: the card in chat is replaced, not doubled', re === 'rebuilt' && T.league_message.length === 1 && /🥇 Red Zone — 160 ring/.test(T.league_message[0].body), T.league_message.map((m) => m.body));
ok('repost: no pushes the second time', (inserts.filter((i) => i.table === 'push_outbox').length) === 1);
re = await R.repostContestRecap(L, 7);
ok('repost: an unfinished week has no card to rebuild', re === null && T.league_message.length === 1);
// ── a voided week (0474) ────────────────────────────────────────────────────
T.week_void = [{ league_id: 'L1', week: 5 }];
re = await R.repostContestRecap(L, 6);
ok('void: a voided week drops out of the season line', re === 'rebuilt' && /after 1 week\./.test(T.league_message[0].body) && !/2 weeks/.test(T.league_message[0].body), T.league_message[0].body);
T.week_void = [{ league_id: 'L1', week: 6 }];
T.league_message.length = 0;
const R3 = await import('../src/contestRecap.js?fresh=2').catch(() => null);
if (R3) { n = await R3.postContestRecaps(6, '2026', { force: true, now: Date.parse('2026-10-14T12:20:00Z') }); ok('void: a voided week gets no card', n === 0 && T.league_message.length === 0); }
T.week_void = [];
// ── a bracket week (0476) is not the season's ──
T.matchup.push({ id: 'p1', league_id: 'L1', week: 4, status: 'final', home_roster_id: 1, away_roster_id: 3, home_final: 200, away_final: 10, is_playoff: true });
re = await R.repostContestRecap(L, 6);
// (the void case above emptied the chat, so this repost posts a fresh card)
ok('playoffs: a playoff final stays out of the season line', re === 'posted' && /leads at 2–0 \(242\.3 ring\) after 2 weeks/.test(T.league_message[0].body), { re, body: T.league_message[0].body });
T.matchup = T.matchup.filter((m) => m.id !== 'p1');

// ── the lock reminder ───────────────────────────────────────────────────────
const P = await import('../src/push.js');
const kick = Date.parse('2026-10-16T00:15:00Z');
ok('lock: the last call fires 55–65 min before the first kickoff (a contest player locks at kickoff)', P.contestLockBand(kick, kick - 60 * 60_000) === 'last' && P.contestLockBand(kick, kick - 70 * 60_000) === null);
ok('lock: the day-before fires 24h ± 5 min before the first kickoff', P.contestLockBand(kick, kick - 24 * 3_600_000) === 'day' && P.contestLockBand(kick, kick - 24 * 3_600_000 - 10 * 60_000) === null);
const rows = P.contestLockRows(L, 7, 'last', kick, T.league_membership, new Set([3]));
ok('lock: humans without a squad get the push; the CPU seat and the one who built don’t', rows.map((r) => r.app_user_id).sort().join() === 'u1,u4', rows.map((r) => r.app_user_id));
ok('lock: the last call names the lock time and the head-to-head CPU rule', rows[0].title === '⚠ Squads lock Thu 8:15 PM ET' && /CPU builds one for you/.test(rows[0].body) && rows[0].kind === 'lineup' && rows[0].dedupe_key === 'contest-lock:last:L1:7:u1', rows[0]);
const boardRows = P.contestLockRows({ ...L, settings_json: { contest: 'high', contest_format: 'board' } }, 7, 'day', kick, T.league_membership, new Set());
ok('lock: a leaderboard seat is told a missing squad scores nothing, the day before', /scores nothing/.test(boardRows[0].body) && boardRows[0].title.startsWith('🗓 Kickoff Bullseye: squads lock') && boardRows[0].dedupe_key.startsWith('contest-lock:day:'), boardRows[0]);
const zeroRows = P.contestLockRows({ ...L, settings_json: { ...L.settings_json, late_entry: 'zero', entry_deadline: 'first' } }, 7, 'last', kick, T.league_membership, new Set());
ok('lock: the reminder follows the league’s no-show rule and the deadline (v0.673.0)', /scores zero — entries close at the first kickoff/.test(zeroRows[0].body) && !/CPU builds/.test(zeroRows[0].body), zeroRows[0].body);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
