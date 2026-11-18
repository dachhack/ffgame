// THE OFFENSE TRUE-UP (v0.740.0): the live feed's passes, rushes and catches
// against nflverse's play-by-play, a day after the games.
//
// Founder, on a Josh Allen touchdown the app never had: "Let's reconcile the
// scoring and play by play to see if we are missing anything." This pins the
// two pure halves — what the books say a play was (offenseOfRow /
// extractOffense) and what the feed needs to agree (planOffense): a missing
// play is written, a play on the wrong man is moved, wrong yards are set, a
// play the books call "No Play" is removed, nothing is written twice, and a
// man the directory cannot resolve is left as the live feed had him.
// Run: `npx tsx test/trueup-offense.mjs` from server/.
import { extractOffense, planOffense } from '../src/poll/trueup.js';

let fails = 0;
const ok = (c, msg, got) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}${!c && got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); if (!c) fails++; };

const COLS = ['play_id', 'game_id', 'week', 'posteam', 'play_type', 'qtr', 'time', 'two_point_attempt', 'passer_player_id', 'passer_player_name',
  'receiver_player_id', 'receiver_player_name', 'rusher_player_id', 'rusher_player_name', 'complete_pass', 'passing_yards', 'receiving_yards',
  'rushing_yards', 'yards_gained', 'pass_touchdown', 'rush_touchdown', 'td_player_id', 'interception', 'sack', 'first_down_pass', 'first_down_rush', 'desc'];
const line = (o) => COLS.map((c) => { const v = String(o[c] ?? ''); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }).join(',');
const G = '2026_10_BUF_NYJ';
const base = { game_id: G, week: 10, posteam: 'BUF', qtr: 1, time: '02:50' };
const csv = [COLS.join(','),
  line({ ...base, play_id: 737, play_type: 'run', rusher_player_id: 'QB1', rusher_player_name: 'J.Allen', rushing_yards: 1, yards_gained: 1, rush_touchdown: 1, td_player_id: 'QB1', first_down_rush: 1 }),
  line({ ...base, play_id: 151, play_type: 'pass', passer_player_id: 'QB1', passer_player_name: 'J.Allen', receiver_player_id: 'WR1', receiver_player_name: 'K.Shakir', complete_pass: 1, passing_yards: 13, receiving_yards: 13, yards_gained: 13 }),
  line({ ...base, play_id: 198, play_type: 'pass', passer_player_id: 'QB1', passer_player_name: 'J.Allen', receiver_player_id: 'WR1', receiver_player_name: 'K.Shakir', complete_pass: 0 }),
  line({ ...base, play_id: 3324, play_type: 'pass', passer_player_id: 'QB1', passer_player_name: 'J.Allen', complete_pass: 0, interception: 1, desc: 'pass, "INTERCEPTED"' }),
  line({ ...base, play_id: 3643, play_type: 'pass', passer_player_id: 'QB1', passer_player_name: 'J.Allen', sack: 1, yards_gained: -8 }),
  line({ ...base, play_id: 2125, play_type: 'qb_kneel', rusher_player_id: 'QB1', rusher_player_name: 'J.Allen', rushing_yards: -1, yards_gained: -1 }),
  line({ ...base, play_id: 2886, play_type: 'pass', passer_player_id: 'QB1', passer_player_name: 'J.Allen', receiver_player_id: 'WR2', receiver_player_name: 'D.Moore', complete_pass: 1, passing_yards: 45, receiving_yards: 45, pass_touchdown: 1, td_player_id: 'WR2' }),
  line({ ...base, play_id: 1861, play_type: 'no_play', desc: 'G.Smith pass to I.Williams for 45 yards. Penalty, offsetting - No Play.' }),
  line({ ...base, play_id: 900, play_type: 'run', two_point_attempt: 1, rusher_player_id: 'QB1', rusher_player_name: 'J.Allen', yards_gained: 2 }),
  line({ ...base, play_id: 50, play_type: 'kickoff' }),
  line({ ...base, play_id: 4000, week: 9, game_id: '2026_09_BUF_KC', play_type: 'run', rusher_player_id: 'QB1', rusher_player_name: 'J.Allen', rushing_yards: 5 }),
].join('\n');

const plays = extractOffense(csv, new Set([10]));
const at = (pid) => plays.find((p) => p.pid === pid);
ok(plays.length === 10 && !at(4000), 'only the asked weeks; every play of them, kickoffs and no-plays too', plays.map((p) => p.pid));
ok(at(737).lines.length === 1 && at(737).lines[0].k === 'rush' && at(737).lines[0].y === 1 && at(737).lines[0].td === 1, 'a rushing touchdown is the rusher\'s', at(737).lines);
ok(at(737).c === 730, 'the game clock is the feed\'s (Q1 2:50 → 730s)', at(737).c);
ok(at(151).lines.map((l) => `${l.k}:${l.y}`).join() === 'pass:13,rec:13' && at(151).lines[1].ca === 1, 'a completion is a pass line and a catch', at(151).lines);
ok(at(198).lines.length === 1 && at(198).lines[0].y === 0 && at(198).lines[0].ic === 1, 'an incompletion is the passer\'s attempt and nobody\'s catch', at(198).lines);
ok(at(3324).lines[0].to === 1 && at(3324).lines[0].y === 0, 'an interception is a turnover on the pass line (a quoted, comma\'d description parses)', at(3324).lines);
ok(at(3643).lines[0].sk === 1 && at(3643).lines[0].y === 0, 'a sack is a dropback worth no passing yards', at(3643).lines);
ok(at(2125).lines[0].k === 'rush' && at(2125).lines[0].y === -1, 'a kneel-down is a −1 carry, as the books keep it', at(2125).lines);
ok(at(2886).lines[0].td === 1 && at(2886).lines[1].td === 1, 'a touchdown pass pays both ends', at(2886).lines);
ok(at(1861).lines.length === 0 && at(900).lines.length === 0, 'a "No Play" and a two-point try carry no offensive line', [at(1861).lines, at(900).lines]);

// ── the plan ──
const slug = { QB1: 'josh-allen', WR1: 'khalil-shakir', WR2: 'dj-moore' };
const resolve = (gsis) => slug[gsis] ?? null;
let id = 1;
const row = (pid, player_slug, k, y, td = 0, extra = {}) => ({ id: id++, pid, c: 100, t: 7, player_slug, k, y, td, to: null, ...extra });
const feed = [
  // 737 (the rushing TD) is missing altogether
  row(151, 'josh-allen', 'pass', 13), row(151, 'khalil-shakir', 'rec', 13),
  row(198, 'josh-allen', 'pass', 0),
  row(3324, 'josh-allen', 'pass', 0),                       // the interception, with no turnover on it
  row(3643, 'josh-allen', 'pass', 0),
  row(2125, 'josh-allen', 'rush', -1),
  row(2886, 'josh-allen', 'pass', 40, 1), row(2886, 'tyler-bass', 'rec', 45, 1),   // short five yards; the catch on the kicker
  row(1861, 'geno-smith', 'pass', 45), row(1861, 'isaiah-williams', 'rec', 45),    // the books call it No Play
  row(900, 'josh-allen', 'tp_rush', 0),                     // not ours
  row(7777, 'james-cook', 'rush', 4),                       // an id the books do not have: left alone
];
const plan = planOffense(plays, feed, resolve);
const byId = new Map(feed.map((r) => [r.id, r]));
const removed = plan.remove.map((i) => `${byId.get(i).pid}:${byId.get(i).player_slug}:${byId.get(i).k}`).sort();
ok(plan.insert.some((r) => r.pid === 737 && r.player_slug === 'josh-allen' && r.k === 'rush' && r.y === 1 && r.td === 1 && r.c === 730), 'a play the feed never had is written', plan.insert);
ok(plan.insert.some((r) => r.pid === 2886 && r.player_slug === 'dj-moore' && r.k === 'rec' && r.td === 1 && r.c === 100 && r.t === 7) && removed.includes('2886:tyler-bass:rec'),
  'a catch on the wrong man moves to the right one, keeping the feed\'s clock', { insert: plan.insert, removed });
ok(plan.update.some((u) => byId.get(u.id).pid === 2886 && u.y === 45 && u.td === 1), 'wrong yards are set to the books\'', plan.update);
ok(plan.update.some((u) => byId.get(u.id).pid === 3324 && u.to === 1), 'an interception the feed missed becomes a turnover', plan.update);
ok(removed.includes('1861:geno-smith:pass') && removed.includes('1861:isaiah-williams:rec'), 'a play the books call "No Play" is removed', removed);
ok(!plan.remove.some((i) => byId.get(i).pid === 7777 || byId.get(i).k === 'tp_rush'), 'a row on an id the books do not have, and a two-point row, are left alone', removed);
ok(plan.insert.length === 2 && plan.update.length === 2 && plan.remove.length === 3, 'nothing else changes', { i: plan.insert.length, u: plan.update.length, r: plan.remove.length });

// Twice is once: a second pass over the corrected rows plans nothing.
const after = feed.filter((r) => !plan.remove.includes(r.id)).map((r) => { const u = plan.update.find((x) => x.id === r.id); return u ? { ...r, ...u } : r; })
  .concat(plan.insert.map((r) => ({ id: id++, ...r })));
const again = planOffense(plays, after, resolve);
ok(!again.insert.length && !again.update.length && !again.remove.length, 'a second pass over the corrected feed changes nothing', again);

// The same play filed under an id the books do not use is corrected in place, never written twice.
const aliased = planOffense(plays, [row(99999, 'josh-allen', 'rush', 0, 0, { c: 732 })], (g) => slug[g] ?? null);
ok(!aliased.insert.some((r) => r.pid === 737) && aliased.update.some((u) => u.y === 1 && u.td === 1), 'a play under another id is matched by man, kind and clock — not written again', aliased);

// A man the directory cannot resolve: the live feed's answer stands.
const blind = planOffense(plays, feed, (g) => (g === 'WR2' ? null : slug[g] ?? null));
ok(blind.unresolved === 1 && !blind.remove.some((i) => byId.get(i).player_slug === 'tyler-bass') && !blind.insert.some((r) => r.pid === 2886 && r.k === 'rec'),
  'an unresolved man: his play is left exactly as the live feed had it', { unresolved: blind.unresolved });

console.log(fails ? `\n${fails} FAILED` : '\nall offense true-up checks passed');
process.exit(fails ? 1 : 0);
