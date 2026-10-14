// SEASON-LEAGUE PUSHES (v0.708.0): 🚑 a starter ruled out, 🩺 the night-before
// lineup check, ⚠ the 90-minute check, and the per-type switches they ride.
// Founder: "Night before + 90 min before kick", only when something is wrong.
// Pure rows only. Run from server/: npx tsx test/push-season.mjs
import { nightBeforeMs, starterIssue, seasonStatusRows, rosterQcNightRows, rosterQcKickRows,
  quietHours, nextRunMs, waiverRemindAt, waiverRemindRows, tradeDeadlineRows, contractLockRows, finalRows, lastDayStartMs, sweatRows,
  isBigPlay, bigPlayLine, bigPlayRows, slugToName, coinEarnedRows, coinAffordRow } from '../src/push.js';
import { coinReasonWord } from '../../packages/core/src/engine/contest.ts';
import { TeamMap } from '../../packages/core/src/data/teamCodes.ts';
import { pushKindOn, flipPushKind, PUSH_KINDS, plainText, leagueKindOn, pushAllowed } from '../../packages/core/src/data/pushKinds.ts';

let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };

// Week 7, 2026: PIT–CIN Thursday 8:15 PM ET, KC–LV and LA–SEA Sunday 1 PM / 4:25 PM ET. DEN on a bye.
const THU = Date.parse('2026-10-16T00:15:00Z'), SUN = Date.parse('2026-10-18T17:00:00Z'), SUN4 = Date.parse('2026-10-18T20:25:00Z');
const kicks = new TeamMap();
for (const [t, k] of [['PIT', THU], ['CIN', THU], ['KC', SUN], ['LV', SUN], ['LA', SUN4], ['SEA', SUN4]]) kicks.set(t, k);
const seat = (starters, extra = {}) => ({ league_id: 'L1', league_name: 'Turf Warriors', roster_id: 3, uid: 'u1', starters, empties: 0, ...extra });
const P = (slug, team, name = slug) => ({ slug, team, name });

ok('the eve is 8 PM ET the night before (a Thursday game → Wednesday)', new Date(nightBeforeMs(THU)).toISOString() === '2026-10-15T00:00:00.000Z');
ok('…and a Sunday 1 PM game → Saturday 8 PM ET', new Date(nightBeforeMs(SUN)).toISOString() === '2026-10-18T00:00:00.000Z');
ok('…across the DST change too (Nov 1 → Sat Oct 31 8 PM EDT)', new Date(nightBeforeMs(Date.parse('2026-11-01T18:00:00Z'))).toISOString() === '2026-11-01T00:00:00.000Z');

const status = new Map([['mahomes', 'O'], ['kelce', 'Q'], ['nacua', 'D']]);
ok('issues: a bye, OUT, doubtful; questionable is not one', starterIssue(P('sutton', 'DEN'), kicks, status) === 'on a bye'
  && starterIssue(P('mahomes', 'KC'), kicks, status) === 'OUT' && starterIssue(P('nacua', 'LAR'), kicks, status) === 'doubtful'
  && starterIssue(P('kelce', 'KC'), kicks, status) === null);

// 🚑 status
const s1 = [seat([P('mahomes', 'KC', 'Patrick Mahomes'), P('kelce', 'KC', 'Travis Kelce')])];
const st = seasonStatusRows(s1, new Map([['mahomes', 'O']]), kicks, 7, THU);
ok('🚑 a starter ruled OUT before his game pages his owner', st.length === 1 && st[0].kind === 'status' && st[0].title === '🚑 Patrick Mahomes is OUT' && /Turf Warriors lineup for week 7\. Swap him before Sun 1:00 PM ET/.test(st[0].body), st);
ok('🚑 …once per status (OUT after doubtful pages again)', st[0].dedupe_key === 'status:L1:7:mahomes:O:u1:3');
ok('🚑 nothing once his game has kicked off', seasonStatusRows(s1, new Map([['mahomes', 'O']]), kicks, 7, SUN + 60_000).length === 0);
ok('🚑 a player on your bench is not news', seasonStatusRows(s1, new Map([['someone', 'O']]), kicks, 7, THU).length === 0);

// 🩺 the night check
const s2 = [seat([P('mahomes', 'KC', 'Patrick Mahomes'), P('sutton', 'DEN', 'Courtland Sutton'), P('pickens', 'PIT', 'George Pickens')], { empties: 1 })];
const eve = nightBeforeMs(THU);
ok('🩺 nothing before the eve of your first game', rosterQcNightRows(s2, kicks, status, 7, eve - 60_000).length === 0);
const n = rosterQcNightRows(s2, kicks, status, 7, eve + 60_000);
ok('🩺 at the eve: one push naming what is wrong', n.length === 1 && n[0].kind === 'rosterqc' && n[0].body === 'Patrick Mahomes is OUT, Courtland Sutton is on a bye, 1 empty spot. Your first game kicks off Thu 8:15 PM ET.', n[0]?.body);
ok('🩺 …once a week per seat', n[0].dedupe_key === 'rosterqc:night:L1:7:u1:3');
ok('🩺 a clean lineup gets nothing', rosterQcNightRows([seat([P('pickens', 'PIT')])], kicks, status, 7, eve + 60_000).length === 0);
ok('🩺 a seat whose first game is Sunday waits for Saturday night', rosterQcNightRows([seat([P('mahomes', 'KC')])], kicks, status, 7, eve + 60_000).length === 0
  && rosterQcNightRows([seat([P('mahomes', 'KC')])], kicks, status, 7, nightBeforeMs(SUN) + 60_000).length === 1);

// ⚠ the 90-minute check
const k = rosterQcKickRows(s2, kicks, status, 7, SUN - 80 * 60_000);
ok('⚠ 90 minutes out, a starter still OUT is called', k.length === 1 && k[0].title === '⚠ Patrick Mahomes is OUT — kickoff in 80 min' && k[0].dedupe_key === 'rosterqc:kick:L1:7:mahomes:u1:3', k);
ok('⚠ …not two hours out', rosterQcKickRows(s2, kicks, status, 7, SUN - 120 * 60_000).length === 0);
ok('⚠ the Rams under LAR find their LA kickoff', rosterQcKickRows([seat([P('nacua', 'LAR', 'Puka Nacua')])], kicks, status, 7, SUN4 - 30 * 60_000).length === 1);

// the switches
ok('switches: the new types start on; the live play-by-play ones start off', pushKindOn({}, 'status') && pushKindOn({}, 'rosterqc') && !pushKindOn({}, 'bigplay') && !pushKindOn({}, 'oppplay'));
ok('switches: a touched switch wins; an unknown type stays on', pushKindOn({ bigplay: true }, 'bigplay') && !pushKindOn({ status: false }, 'status') && pushKindOn({}, 'widget'));
ok('switches: flipping an untouched off-by-default type turns it on', flipPushKind({}, 'bigplay').bigplay === true && flipPushKind({}, 'status').status === false);
ok('switches: every type has words for the ⓘ', PUSH_KINDS.every((x) => x.label && x.info));

// ── part 2 (v0.708.1): ⏰ league timing and 🏁 results ──
const LG = { id: 'L1', name: 'Turf Warriors' };
const iso = (ms) => new Date(ms).toISOString();
ok('quiet hours are 9 PM – 9 AM ET', quietHours(Date.parse('2026-10-15T02:00:00Z')) && !quietHours(Date.parse('2026-10-15T00:30:00Z')) && quietHours(Date.parse('2026-10-15T12:30:00Z')) && !quietHours(Date.parse('2026-10-15T13:30:00Z')));
// Wednesday 3 AM ET runs (dow 3, minute 180). From Tue Oct 13 noon ET → Wed Oct 14 3 AM ET = 07:00Z.
const tueNoon = Date.parse('2026-10-13T16:00:00Z');
const run = nextRunMs(3, 180, tueNoon);
ok('the next Wednesday 3 AM ET run', iso(run) === '2026-10-14T07:00:00.000Z', iso(run));
ok('…and a week later once it has passed', iso(nextRunMs(3, 180, run + 60_000)) === '2026-10-21T07:00:00.000Z');
ok('a pre-noon run is flagged at 8 PM ET the evening before; a later one 3 hours ahead', iso(waiverRemindAt(run)) === '2026-10-14T00:00:00.000Z'
  && iso(waiverRemindAt(Date.parse('2026-10-14T23:00:00Z'))) === '2026-10-14T20:00:00.000Z');
ok('⏰ waivers: nothing before the evening', waiverRemindRows(LG, ['u1'], run, waiverRemindAt(run) - 60_000).length === 0);
const wr = waiverRemindRows(LG, ['u1', 'u2'], run, waiverRemindAt(run) + 60_000);
ok('⏰ waivers: every member, once per run', wr.length === 2 && wr[0].kind === 'timing' && wr[0].title === '⏰ Turf Warriors: waivers run Wed 3:00 AM ET' && wr[0].dedupe_key === 'timing:waivers:L1:2026-10-14:u1', wr[0]);
ok('⏰ trade deadline: only in the deadline week', tradeDeadlineRows(LG, ['u1'], 9, 10).length === 0 && tradeDeadlineRows(LG, ['u1'], 10, 10)[0]?.body === "Trades close when week 10's games are over." && tradeDeadlineRows(LG, ['u1'], 10, null).length === 0);
const cdl = Date.parse('2026-10-16T23:00:00Z');
ok('⏰ contracts: inside the last day, not the last hour', contractLockRows(LG, ['u1'], cdl, cdl - 20 * 3_600_000).length === 1
  && contractLockRows(LG, ['u1'], cdl, cdl - 30 * 3_600_000).length === 0 && contractLockRows(LG, ['u1'], cdl, cdl - 30 * 60_000).length === 0);
const names = new Map([[1, 'Bank Roll'], [2, 'Super Crisp']]);
const owners = new Map([['L1:1', 'u1'], ['L1:2', 'u2']]);
const fin = finalRows(LG, { id: 'M1', week: 6, home_roster_id: 1, away_roster_id: 2, home_final: 154.3, away_final: 184.2 }, names, owners, false);
ok('🏁 final: each side told, from its own side', fin.length === 2 && fin[0].title === '🏁 Turf Warriors: Lost week 6' && fin[0].body === 'Bank Roll 154.30 – 184.20 Super Crisp'
  && fin[1].title === '🏁 Turf Warriors: Won week 6' && fin[1].body === 'Super Crisp 184.20 – 154.30 Bank Roll', fin);
ok('🏁 final: a lower-wins league reads it the other way', finalRows(LG, { id: 'M2', week: 6, home_roster_id: 1, away_roster_id: 2, home_final: 32.6, away_final: 36.9 }, names, owners, true)[0].title === '🏁 Turf Warriors: Won week 6');
// The sweat: Sunday slate, then MNF (Mon Oct 19 8:15 PM ET = Oct 20 00:15Z)
const MNF = Date.parse('2026-10-20T00:15:00Z');
const wkKicks = new TeamMap();
for (const [t, k] of [['KC', SUN], ['LV', SUN], ['DAL', MNF], ['NYG', MNF]]) wkKicks.set(t, k);
ok('the last game day starts with its first kickoff', lastDayStartMs([SUN, SUN, MNF, MNF]) === MNF && lastDayStartMs([]) === null);
const seatsByRid = new Map([[1, { uid: 'u1', starters: [P('lamb', 'DAL', 'CeeDee Lamb'), P('mahomes', 'KC', 'Patrick Mahomes')] }], [2, { uid: 'u2', starters: [P('pacheco', 'KC', 'Isiah Pacheco')] }]]);
const M = { id: 'M3', week: 7, home_roster_id: 1, away_roster_id: 2 };
ok('🏈 sweat: not before half an hour out', sweatRows(LG, M, { home: 98.4, away: 112.6 }, seatsByRid, names, wkKicks, MNF, MNF - 40 * 60_000).length === 0);
const sw = sweatRows(LG, M, { home: 98.4, away: 112.6 }, seatsByRid, names, wkKicks, MNF, MNF - 20 * 60_000);
ok('🏈 sweat: the score and who is still to play, both sides', sw.length === 2 && sw[0].title === '🏈 Turf Warriors: Monday night'
  && sw[0].body === 'Bank Roll 98.40 – 112.60 Super Crisp. Still to play — yours: CeeDee Lamb (DAL); theirs: 0.'
  && sw[1].body === 'Super Crisp 112.60 – 98.40 Bank Roll. Still to play — yours: nobody; theirs: 1.', sw);
ok('🏈 sweat: a matchup nobody plays in tonight gets nothing', sweatRows(LG, M, { home: 1, away: 2 }, new Map([[1, { uid: 'u1', starters: [P('mahomes', 'KC')] }], [2, { uid: 'u2', starters: [] }]]), names, wkKicks, MNF, MNF - 20 * 60_000).length === 0);

// ── part 3 (v0.708.2): live big plays ──
const R = (player_slug, k, y = 0, td = 0) => ({ player_slug, k, y, td });
ok('big: a TD of any kind, or 20+ yards on a pass, run, catch or return', isBigPlay(R('kelce', 'rec', 4, 1)) && isBigPlay(R('pacheco', 'rush', 22)) && isBigPlay(R('kc-dst', 'dst_td', 0, 1))
  && !isBigPlay(R('pacheco', 'rush', 19)) && !isBigPlay(R('butker', 'fg', 52)) && !isBigPlay(R('punter', 'punt', 60)));
const nm = (x) => ({ mahomes: 'Patrick Mahomes', kelce: 'Travis Kelce', pacheco: 'Isiah Pacheco', lamb: 'CeeDee Lamb' })[x] ?? x;
ok('big: the throw and the catch read as one play', bigPlayLine([R('mahomes', 'pass', 35, 1), R('kelce', 'rec', 35, 1)], nm) === 'TD! Patrick Mahomes → Travis Kelce, 35-yd catch');
ok('big: a run reads as a run', bigPlayLine([R('pacheco', 'rush', 22)], nm) === 'Isiah Pacheco, 22-yd run');
const play = (pid, rows, game_id = 'G1') => ({ game_id, pid, rows });
const it = (mine, opp, wantMine = true, wantOpp = false) => new Map([['u1', { mine: new Map(mine.map((x) => [x, ['Turf Warriors']])), opp: new Map(opp.map((x) => [x, ['Turf Warriors']])), wantMine, wantOpp }]]);
let sent = new Map();
const b1 = bigPlayRows([play(1, [R('mahomes', 'pass', 35, 1), R('kelce', 'rec', 35, 1)])], it(['kelce'], []), nm, sent);
ok('big: one play, one push, on your switch', b1.length === 1 && b1[0].kind === 'bigplay' && b1[0].title === '🏈 TD! Patrick Mahomes → Travis Kelce, 35-yd catch' && b1[0].body === 'In your Turf Warriors lineup.', b1);
ok('big: your opponent’s play is nothing with that switch off', bigPlayRows([play(2, [R('lamb', 'rec', 40)])], it([], ['lamb']), nm, new Map()).length === 0);
const o1 = bigPlayRows([play(2, [R('lamb', 'rec', 40)])], it([], ['lamb'], true, true), nm, new Map());
ok('big: …and on its own switch when it is on', o1.length === 1 && o1[0].kind === 'oppplay' && o1[0].title.startsWith('👀 CeeDee Lamb, 40-yd catch') && /opponent/.test(o1[0].body), o1);
const roll = bigPlayRows([play(3, [R('pacheco', 'rush', 25)]), play(4, [R('kelce', 'rec', 21)])], it(['pacheco', 'kelce'], []), nm, new Map());
ok('big: plays that land together roll into one push', roll.length === 1 && roll[0].title === '🏈 2 big plays' && roll[0].body === 'Isiah Pacheco, 25-yd run · Travis Kelce, 21-yd catch', roll);
sent = new Map();
let capN = 0;
for (let i = 10; i < 15; i++) capN += bigPlayRows([play(i, [R('pacheco', 'rush', 25)])], it(['pacheco'], []), nm, sent).length;
ok('big: at most 3 pushes for one player in one game', capN === 3);
ok('big: …a new game starts the count again', bigPlayRows([play(20, [R('pacheco', 'rush', 25)], 'G2')], it(['pacheco'], []), nm, sent).length === 1);
ok('big: nobody who wants it, nothing', bigPlayRows([play(30, [R('kelce', 'rec', 30)])], it(['kelce'], [], false, false), nm, new Map()).length === 0);

ok('big: a name from a bare slug, never the slug itself', slugToName('aaron-rodgers') === 'Aaron Rodgers' && slugToName('kc-dst') === 'KC Defense');
// ── no icons (v0.708.2, founder: "Don't use the icons for alerts or in the alert settings. Just the drip icon in the alert.") ──
ok('no icons: a title loses its emoji and keeps its words', plainText('🏈 TD! Patrick Mahomes → Travis Kelce, 35-yd catch') === 'TD! Patrick Mahomes → Travis Kelce, 35-yd catch'
  && plainText('⚠ Lineup locks 1:00 PM ET') === 'Lineup locks 1:00 PM ET' && plainText('🗓 Turf Warriors: squads lock Thu') === 'Turf Warriors: squads lock Thu'
  && plainText('Set them on 📜 CONTRACTS') === 'Set them on CONTRACTS' && plainText('◎40 earned') === '◎40 earned', [plainText('Set them on 📜 CONTRACTS')]);
ok('no icons: not one setting label carries an emoji', PUSH_KINDS.every((k) => plainText(k.label) === k.label), PUSH_KINDS.map((k) => k.label));

// ── per league and overall (v0.708.3, founder: "Let's do per league settings and overall") ──
ok('league: an untouched league follows overall', leagueKindOn({}, 'status') && leagueKindOn(null, 'bigplay') && pushAllowed({}, {}, 'status') && !pushAllowed({}, {}, 'bigplay'));
ok('league: a type off in this league is off here, whatever overall says', !pushAllowed({ status: true }, { status: false }, 'status') && pushAllowed({ status: true }, { result: false }, 'status'));
ok('league: muted silences every type in it', !leagueKindOn({ muted: true, status: true }, 'status') && !pushAllowed({ chat: true }, { muted: true }, 'chat'));
ok('league: the league cannot switch on what is off overall', !pushAllowed({ bigplay: false }, { bigplay: true }, 'bigplay') && pushAllowed({ bigplay: true }, { bigplay: true }, 'bigplay'));

// ── part 4 (v0.708.4): drip coin ──
const L2 = new Map([['C1', 'Weekly Cointest']]);
const own2 = new Map([['C1:4', 'u1'], ['C1:5', 'u2']]);
const ledger = [
  { id: 10, league_id: 'C1', roster_id: 4, delta: 40, reason: 'built' },
  { id: 11, league_id: 'C1', roster_id: 4, delta: 25, reason: 'loss' },
  { id: 12, league_id: 'C1', roster_id: 4, delta: -80, reason: 'play' },
  { id: 13, league_id: 'C1', roster_id: 5, delta: 200, reason: 'seed' },
];
const ce = coinEarnedRows(ledger, new Map([['C1:4', 185]]), L2, own2, coinReasonWord);
ok('coin: a settle batch is one push per team, with the reasons and the wallet', ce.length === 1 && ce[0].kind === 'coin' && ce[0].title === '◎65 earned in Weekly Cointest'
  && ce[0].body === 'built your squad, a loss · wallet ◎185.' && ce[0].dedupe_key === 'coin:earned:C1:4:11', ce);
ok('coin: spending and the starting seed are not news', !ce.some((r) => r.app_user_id === 'u2'));
const offered = [{ name: 'Underdog', price: 35 }, { name: 'Double or Nothing', price: 80 }, { name: 'Ghost Player', price: 75 }];
const LC = { id: 'C1', name: 'Weekly Cointest' };
const af = coinAffordRow(LC, 7, 4, 'u1', 120, offered, false, THU, nightBeforeMs(THU) + 60_000);
ok('coin: the evening before, a wallet that covers a play hears about the dearest one', af?.title === '◎120 to spend in Weekly Cointest'
  && af?.body === 'Enough for Double or Nothing (◎80) and 2 more. Plays go in before Thu 8:15 PM ET.' && af?.dedupe_key === 'coin:afford:C1:7:4:u1', af);
ok('coin: not before the evening, not after kickoff', coinAffordRow(LC, 7, 4, 'u1', 120, offered, false, THU, nightBeforeMs(THU) - 60_000) === null && coinAffordRow(LC, 7, 4, 'u1', 120, offered, false, THU, THU + 1) === null);
ok('coin: not once a play is in, nor when nothing is affordable', coinAffordRow(LC, 7, 4, 'u1', 120, offered, true, THU, nightBeforeMs(THU) + 60_000) === null
  && coinAffordRow(LC, 7, 4, 'u1', 20, offered, false, THU, nightBeforeMs(THU) + 60_000) === null);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
