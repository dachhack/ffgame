// THE SWAP MADE FOR YOU, AND THE RULED-OUT PUSH (v0.669.0). Pure plans against
// a canned board. Run from server/: npx tsx test/contest-subs.mjs
import { __setClientForTest } from '../src/supabase.js';
__setClientForTest({});

let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };

const { planSubs, AUTO_SUB_WINDOW_MS } = await import('../src/contestSubs.js');
const { contestConfigOf } = await import('../../packages/core/src/engine/contest.ts');
const { ruledOutRows } = await import('../src/push.js');

const KICK_1PM = Date.parse('2026-10-18T17:00:00Z');   // Sun 1:00 PM ET
const KICK_425 = Date.parse('2026-10-18T20:25:00Z');   // Sun 4:25 PM ET
const board = [
  { slug: 'burrow', name: 'Joe Burrow', pos: 'QB', team: 'CIN', salary: 7900, proj: 19.9 },
  { slug: 'dowdle', name: 'Rico Dowdle', pos: 'RB', team: 'PIT', salary: 3900, proj: 9.7 },
  { slug: 'shipley', name: 'Will Shipley', pos: 'RB', team: 'PHI', salary: 4200, proj: 10.5 },
  { slug: 'cmc', name: 'Christian McCaffrey', pos: 'RB', team: 'SF', salary: 9000, proj: 22 },
  { slug: 'bijan', name: 'Bijan Robinson', pos: 'RB', team: 'ATL', salary: 8500, proj: 20 },
  { slug: 'kamara', name: 'Alvin Kamara', pos: 'RB', team: 'NO', salary: 5000, proj: 12 },
];
const kicks = new Map([['CIN', KICK_1PM], ['PIT', KICK_1PM], ['PHI', Date.parse('2026-10-18T13:30:00Z')], ['SF', KICK_425], ['ATL', KICK_1PM], ['NO', KICK_1PM]]);
const league = { id: 'L1', name: 'Weekly Bullseye' };
const cfgOn = contestConfigOf({ contest: 'high', contest_format: 'h2h', budget: 20000, auto_sub: true, roster_slots: [{ pos: ['QB'] }, { pos: ['RB'] }, { pos: ['RB'] }] }, 'dfs');
const cfgOff = contestConfigOf({ contest: 'high', contest_format: 'h2h', budget: 20000, roster_slots: [{ pos: ['QB'] }, { pos: ['RB'] }, { pos: ['RB'] }] }, 'dfs');
const seats = new Map([[1, { app_user_id: 'u1', controller: 'human', team_name: 'Farmer Casey' }], [2, { app_user_id: null, controller: 'ai', team_name: 'Mud Dogs' }]]);
const squad = (rid) => ({ roster_id: rid, week: 6, starters_json: [{ slot: 'S1', player_slug: 'burrow', pos: 'QB' }, { slot: 'S2', player_slug: 'dowdle', pos: 'RB' }, { slot: 'S3', player_slug: 'shipley', pos: 'RB' }] });
const outs = new Set(['dowdle']);

ok('config: auto_sub reads from the settings, off by default', cfgOn.autoSub === true && cfgOff.autoSub === false);

// A human, auto-sub on, 15 minutes before Dowdle's kickoff: swapped.
const t15 = KICK_1PM - 15 * 60_000;
const p1 = planSubs({ league, cfg: cfgOn, board, entries: [squad(1)], seats, kicks, outs, card: null, now: t15 });
ok('human in the window: Dowdle out, the best affordable unlocked RB in', p1.length === 1 && p1[0].out[0].slug === 'dowdle' && p1[0].in.length === 1 && p1[0].in[0].slug === 'kamara', p1);
ok('the swap keeps the rest of the squad', p1[0].starters_json.map((r) => r.player_slug).join() === 'burrow,kamara,shipley', p1[0].starters_json);
ok('the plan names the owner for the push', p1[0].uid === 'u1' && p1[0].cpu === false);
// Two hours out: still his to make.
const p2 = planSubs({ league, cfg: cfgOn, board, entries: [squad(1)], seats, kicks, outs, card: null, now: KICK_1PM - 2 * 3_600_000 });
ok('human outside the window: nothing yet', p2.length === 0, p2);
// After kickoff: too late.
const p3 = planSubs({ league, cfg: cfgOn, board, entries: [squad(1)], seats, kicks, outs, card: null, now: KICK_1PM + 60_000 });
ok('after his kickoff: nothing (his spot banks what it banks)', p3.length === 0, p3);
// Auto-sub off: a human is left alone, a CPU seat is still fixed.
const p4 = planSubs({ league, cfg: cfgOff, board, entries: [squad(1), squad(2)], seats, kicks, outs, card: null, now: KICK_1PM - 2 * 3_600_000 });
ok('auto-sub off: the human is left alone, the CPU seat is swapped any time before kickoff', p4.length === 1 && p4[0].roster_id === 2 && p4[0].cpu === true && p4[0].uid === null, p4);
// The replacement must not have kicked off: at 4:00 PM only the 4:25 men are open.
const t4pm = Date.parse('2026-10-18T20:00:00Z');
const outsLate = new Set(['shipley']);   // ruled out, game already played → nothing to do
const p5 = planSubs({ league, cfg: cfgOn, board, entries: [squad(1)], seats, kicks, outs: outsLate, card: null, now: t4pm });
ok('a man whose game has been played is not swapped', p5.length === 0, p5);
const lateBoard = board.map((b) => (b.slug === 'dowdle' ? { ...b, team: 'SF' } : b));   // pretend Dowdle plays at 4:25
const cfgRich = contestConfigOf({ contest: 'high', contest_format: 'h2h', budget: 25000, auto_sub: true, roster_slots: [{ pos: ['QB'] }, { pos: ['RB'] }, { pos: ['RB'] }] }, 'dfs');
const p6 = planSubs({ league, cfg: cfgRich, board: lateBoard, entries: [squad(1)], seats, kicks, outs, card: null, now: KICK_425 - 10 * 60_000 });
const p6tight = planSubs({ league, cfg: cfgOn, board: lateBoard, entries: [squad(1)], seats, kicks, outs, card: null, now: KICK_425 - 10 * 60_000 });
ok('a locked kept pick still counts against the cap: under $20k nobody unlocked is affordable, so no swap', p6tight.length === 0, p6tight);
ok('the replacement comes only from games not yet kicked off', p6.length === 1 && p6[0].in[0].slug === 'cmc', p6);
ok('the window is twenty minutes', AUTO_SUB_WINDOW_MS === 20 * 60_000);

// ── the ruled-out push ──────────────────────────────────────────────────────
const names = new Map([['L1', 'Weekly Bullseye'], ['L2', 'Golf Sundays']]);
const auto = new Map([['L1', true], ['L2', false]]);
const rows = ruledOutRows({ slug: 'dowdle', name: 'Rico Dowdle', status: 'O' }, 6, KICK_1PM,
  [{ league_id: 'L1', app_user_id: 'u1' }, { league_id: 'L2', app_user_id: 'u1' }, { league_id: 'L2', app_user_id: null }], names, auto);
ok('push: one per squad holding him with an owner', rows.length === 2 && rows.every((r) => r.app_user_id === 'u1'), rows);
ok('push: names him, the league, the week and his kickoff', rows[0].title === '⚠ Rico Dowdle is OUT' && /Weekly Bullseye squad for week 6\. Swap him before Sun 1:00 PM ET/.test(rows[0].body), rows[0]);
ok('push: says what happens if you don’t — by the league’s auto-sub', /swapped for you just before kickoff/.test(rows[0].body) && /his spot scores nothing/.test(rows[1].body), rows.map((r) => r.body));
ok('push: deduped per league-week-player-user', rows[0].dedupe_key === 'ruled-out:L1:6:dowdle:u1' && rows[1].dedupe_key === 'ruled-out:L2:6:dowdle:u1');
const ir = ruledOutRows({ slug: 'x', name: 'X', status: 'IR' }, 6, KICK_1PM, [{ league_id: 'L1', app_user_id: 'u1' }], names, auto);
ok('push: IR reads as on IR', ir[0].title === '⚠ X is on IR');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
