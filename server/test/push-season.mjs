// SEASON-LEAGUE PUSHES (v0.708.0): 🚑 a starter ruled out, 🩺 the night-before
// lineup check, ⚠ the 90-minute check, and the per-type switches they ride.
// Founder: "Night before + 90 min before kick", only when something is wrong.
// Pure rows only. Run from server/: npx tsx test/push-season.mjs
import { nightBeforeMs, starterIssue, seasonStatusRows, rosterQcNightRows, rosterQcKickRows } from '../src/push.js';
import { TeamMap } from '../../packages/core/src/data/teamCodes.ts';
import { pushKindOn, flipPushKind, PUSH_KINDS } from '../../packages/core/src/data/pushKinds.ts';

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

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
